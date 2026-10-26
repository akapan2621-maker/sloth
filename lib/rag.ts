/**
 * Zero-dependency retrieval engine.
 *
 * Mode 1 (default, no extra API key required):
 *   BM25 lexical scoring over the selected Space's chunks, combined with a
 *   TF-IDF cosine similarity pass and a light semantic (synonym) expansion,
 *   giving a hybrid lexical/semantic ranking.
 *
 * Mode 2 (optional): cosine similarity over embedding vectors, computed
 * locally or delegated to Supabase `pgvector` when the project is connected.
 */

import type { DocumentChunk, RetrievedChunk, Space, DocumentMeta } from "./types";

/* -------------------------------------------------------------------------- */
/* Tokenisation                                                               */
/* -------------------------------------------------------------------------- */

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between",
  "both", "but", "by", "can", "did", "do", "does", "doing", "don", "down",
  "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "he", "her", "here", "hers", "herself", "him", "himself", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on",
  "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over",
  "own", "s", "same", "she", "should", "so", "some", "such", "t", "than",
  "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "we", "were", "what", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "you", "your", "yours", "yourself",
  "yourselves",
]);

/** Lightweight semantic bridge: query term -> related domain terms. */
const SYNONYM_GROUPS: string[][] = [
  ["buy", "sell", "trade", "trading", "order", "position"],
  ["profit", "loss", "pnl", "equity", "roi", "margin"],
  ["risk", "hazard", "exposure", "volatility", "drawdown"],
  ["gold", "xauusd", "xau", "bullion", "metal"],
  ["forex", "currency", "pair", "pip", "fx"],
  ["audit", "compliance", "control", "iso", "controlset", "evidence"],
  ["security", "vulnerability", "cve", "threat", "hardening"],
  ["policy", "procedure", "guideline", "standard", "sop"],
  ["customer", "client", "user", "account", "subscriber"],
  ["revenue", "sales", "income", "turnover", "mrr"],
  ["cost", "expense", "spend", "budget", "opex"],
  ["deploy", "release", "rollout", "ship", "ci", "cd"],
  ["machine", "learning", "model", "inference", "training"],
  ["server", "backend", "api", "endpoint", "service"],
  ["database", "sql", "postgres", "supabase", "schema"],
  ["payment", "billing", "invoice", "subscription", "charge"],
  ["hiring", "candidate", "recruit", "interview", "talent"],
  ["roadmap", "milestone", "sprint", "backlog", "quarter"],
  ["report", "summary", "analysis", "finding", "insight"],
  ["password", "secret", "credential", "token", "key"],
];

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_INDEX.set(term, group.filter((t) => t !== term));
  }
}

const LATIN_RUN = /[a-z0-9À-ɏ]+/g;
/** Thai block (U+0E00-U+0E7F), including vowel and tone marks. */
const THAI_RUN = /[ก-๿]+/g;

/**
 * Thai writes whole phrases without spaces, so a dictionary-free tokenizer
 * falls back to character bigrams ("เอกสาร" -> "เอก", "กา", "าร์"…). Bigrams
 * give BM25 enough granularity to match Thai queries against Thai documents
 * without a full morphological analyser.
 */
function thaiBigrams(run: string): string[] {
  if (run.length < 2) return [run];
  const grams: string[] = [];
  for (let i = 0; i < run.length - 1; i += 1) {
    grams.push(run.slice(i, i + 2));
  }
  return grams;
}

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];

  for (const token of lowered.match(LATIN_RUN) ?? []) {
    if (token.length > 1 && !STOP_WORDS.has(token)) tokens.push(token);
  }
  // Thai never matches LATIN_RUN, so the two passes cannot collide.
  for (const run of lowered.match(THAI_RUN) ?? []) {
    tokens.push(...thaiBigrams(run));
  }

  return tokens;
}

/** Stems a token lightly so "trading"/"trades"/"trader" collapse together. */
function stem(token: string): string {
  return token
    .replace(/(ization|ational|fulness|ousness|iveness)$/i, "")
    .replace(/(ing|ers|ies|ied|ed|es|s)$/i, "")
    .replace(/^(.{3,})$/i, "$1");
}

export function stemTokens(tokens: string[]): string[] {
  return tokens.map(stem);
}

/** Expands a query with semantically related terms (weight-tagged). */
export function expandQuery(tokens: string[]): Map<string, number> {
  const expanded = new Map<string, number>();
  for (const token of tokens) {
    expanded.set(token, Math.max(expanded.get(token) ?? 0, 1));
    const related = SYNONYM_INDEX.get(token);
    if (related) {
      for (const alt of related) {
        expanded.set(alt, Math.max(expanded.get(alt) ?? 0, 0.45));
      }
    }
  }
  return expanded;
}

/* -------------------------------------------------------------------------- */
/* BM25                                                                       */
/* -------------------------------------------------------------------------- */

export interface ChunkIndexEntry {
  chunk: DocumentChunk;
  tokens: string[];
  frequencies: Map<string, number>;
  length: number;
}

export interface BuiltIndex {
  entries: ChunkIndexEntry[];
  documentFrequency: Map<string, number>;
  averageLength: number;
  totalChunks: number;
}

/** Builds a BM25 index over a set of chunks. */
export function buildIndex(chunks: DocumentChunk[]): BuiltIndex {
  const entries: ChunkIndexEntry[] = [];
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = stemTokens(tokenize(chunk.content));
    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    for (const token of frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    totalLength += tokens.length;
    entries.push({
      chunk,
      tokens,
      frequencies,
      length: tokens.length,
    });
  }

  return {
    entries,
    documentFrequency,
    averageLength: entries.length > 0 ? totalLength / entries.length : 0,
    totalChunks: entries.length,
  };
}

const K1 = 1.5;
const B = 0.75;

/** BM25 score of a single chunk against an expanded query. */
export function bm25Score(
  entry: ChunkIndexEntry,
  query: Map<string, number>,
  index: BuiltIndex,
): number {
  if (entry.length === 0) return 0;
  let score = 0;

  for (const [term, weight] of query) {
    const tf = entry.frequencies.get(term);
    if (!tf) continue;
    const df = index.documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (index.totalChunks - df + 0.5) / (df + 0.5));
    const denominator =
      tf + K1 * (1 - B + (B * entry.length) / (index.averageLength || 1));
    score += weight * idf * ((tf * (K1 + 1)) / denominator);
  }

  return score;
}

/* -------------------------------------------------------------------------- */
/* TF-IDF cosine                                                              */
/* -------------------------------------------------------------------------- */

export function tfidfVector(
  entry: ChunkIndexEntry,
  index: BuiltIndex,
): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [term, tf] of entry.frequencies) {
    const df = index.documentFrequency.get(term) ?? 0;
    const idf = Math.log(1 + index.totalChunks / (1 + df));
    vector.set(term, (1 + Math.log(tf)) * idf);
  }
  return vector;
}

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, value] of small) {
    const other = large.get(term);
    if (other) dot += value * other;
  }
  if (dot === 0) return 0;
  return dot / (norm(a) * norm(b));
}

function norm(vector: Map<string, number>): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum) || 1;
}

/* -------------------------------------------------------------------------- */
/* Vector similarity                                                          */
/* -------------------------------------------------------------------------- */

export function vectorCosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* -------------------------------------------------------------------------- */
/* Public retrieval API                                                       */
/* -------------------------------------------------------------------------- */

export interface LexicalSearchOptions {
  topK?: number;
  /** Minimum normalised score required to keep a hit. */
  threshold?: number;
}

export interface LexicalHit {
  chunk: DocumentChunk;
  score: number;
  strategy: "bm25";
}

/**
 * Hybrid lexical search: BM25 (primary) blended with TF-IDF cosine.
 * Returns at most `topK` hits ordered by blended score.
 */
export function searchLexical(
  chunks: DocumentChunk[],
  query: string,
  options: LexicalSearchOptions = {},
): LexicalHit[] {
  if (chunks.length === 0) return [];
  return searchLexicalWithIndex(buildIndex(chunks), query, options);
}

/**
 * Same ranking as `searchLexical`, but reuses a prebuilt index. Large Spaces
 * (tens of thousands of chunks) would otherwise re-tokenise every chunk on
 * every message, freezing the main thread for seconds.
 */
export function searchLexicalWithIndex(
  index: BuiltIndex,
  query: string,
  options: LexicalSearchOptions = {},
): LexicalHit[] {
  const topK = options.topK ?? 6;
  const threshold = options.threshold ?? 0;

  const queryTokens = stemTokens(tokenize(query));
  if (queryTokens.length === 0 || index.entries.length === 0) return [];

  const expanded = expandQuery(queryTokens);

  const queryVector = new Map<string, number>();
  for (const [term, weight] of expanded) {
    const df = index.documentFrequency.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + index.totalChunks / (1 + df));
    queryVector.set(term, weight * idf);
  }

  const scored = index.entries.map((entry) => {
    const bm25 = bm25Score(entry, expanded, index);
    const cosine = cosineSimilarity(queryVector, tfidfVector(entry, index));
    return { chunk: entry.chunk, score: bm25 * 0.65 + cosine * 4 * 0.35 };
  });

  const maxScore = scored.reduce((max, hit) => Math.max(max, hit.score), 0);
  if (maxScore <= 0) return [];

  return scored
    .map((hit) => ({
      ...hit,
      strategy: "bm25" as const,
      score: maxScore > 0 ? hit.score / maxScore : 0,
    }))
    .filter((hit) => hit.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Ranks a set of already-embedded chunks by cosine similarity to `queryVector`. */
export function searchVectors(
  chunks: DocumentChunk[],
  queryVector: number[],
  topK = 6,
): { chunk: DocumentChunk; score: number }[] {
  const hits = chunks
    .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0)
    .map((chunk) => ({
      chunk,
      score: vectorCosine(queryVector, chunk.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return hits;
}

/* -------------------------------------------------------------------------- */
/* Context assembly                                                           */
/* -------------------------------------------------------------------------- */

export interface ContextAssembly {
  text: string;
  sources: RetrievedChunk[];
}

/**
 * Turns retrieved chunks into the `<context>` block that is injected into the
 * system prompt, together with the source records used for citations.
 */
export function buildContextBlock(
  hits: RetrievedChunk[],
  spaces: Space[],
  documents: DocumentMeta[],
): ContextAssembly {
  if (hits.length === 0) {
    return { text: "", sources: [] };
  }

  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "Space";
  const docName = (id: string) =>
    documents.find((d) => d.id === id)?.fileName ?? "document";

  const blocks = hits.map((hit, position) => {
    const label = `[${position + 1}] ${docName(hit.documentId)} - ${
      spaceName(hit.spaceId)
    } (match ${(hit.score * 100).toFixed(0)}%)`;
    return `<source id="${position + 1}" document="${docName(
      hit.documentId,
    )}" space="${spaceName(hit.spaceId)}">\n${label}\n${hit.content}\n</source>`;
  });

  const text = [
    "<knowledge_base>",
    "The following excerpts were retrieved from the user's Space. Use them to answer,",
    "and cite the source document by name in square brackets.",
    "",
    blocks.join("\n\n"),
    "</knowledge_base>",
  ].join("\n");

  return { text, sources: hits };
}
