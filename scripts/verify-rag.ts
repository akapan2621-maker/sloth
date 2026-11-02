/**
 * Offline verification of the retrieval stack.
 *
 *   npm run verify
 *
 * Exercises the chunker (size + overlap invariants) and the BM25 / TF-IDF
 * hybrid retriever against a labelled fixture. No network or API key needed.
 */
import { chunkText } from "../lib/chunking";
import { EMBED_BATCH_SIZE, splitIntoBatches } from "../lib/embeddings";
import { parseCsvRows } from "../lib/fileParser";
import { buildContextBlock, searchLexical, stemTokens, tokenize } from "../lib/rag";
import { isSafeExternalLink } from "../lib/utils";
import type { DocumentChunk, DocumentMeta, Space } from "../lib/types";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SECTIONS: Record<string, string> = {
  "Gold price action framework":
    "Support and resistance are defined by swing highs and lows. A breakout is confirmed when price closes above the prior swing high on the H1 timeframe. Invalidation sits below the last higher low. Trending markets produce shallow pullbacks while ranging markets produce deep ones.",
  "Risk management rules":
    "Position sizing must never exceed 1% of equity per trade. Stop losses are placed beyond structure, never at round numbers. The maximum drawdown tolerated before strategy review is 8% over a rolling quarter. A journal entry is mandatory for every closed trade.",
  "ISO 27001 access control":
    "Access control requires unique user identification and multi-factor authentication for administrative accounts. Evidence is retained for a minimum of 12 months. A named owner must be assigned to every control. Quarterly access reviews are performed by the security lead.",
  "Backup and continuity":
    "Daily backups run at 02:00 UTC with a 35 day retention window. Restore drills happen twice per year. The recovery time objective is 4 hours and the recovery point objective is 15 minutes. Backup failures are escalated to the on-call engineer immediately.",
  "Supplier management":
    "Third party suppliers are assessed annually against a security questionnaire. Suppliers processing customer data must sign the data processing agreement. A right to audit clause is retained in every contract. Offboarding evidence confirms access revocation within 24 hours.",
  "Incident response":
    "Sev1 incidents page the on-call engineer within 15 minutes. A written post mortem is produced within five business days. The incident commander maintains the running log. Lessons learned are tracked as corrective actions with named owners.",
  "Network segmentation":
    "Production workloads sit in a segmented VLAN separated from corporate offices. Egress is filtered through a proxy. Firewalls are reviewed quarterly. Unauthorised scanning from internal ranges raises a high severity alert automatically.",
  "Vulnerability management":
    "Critical vulnerabilities are patched within 72 hours of disclosure. High severity issues are remediated within 14 days. Scans run weekly against all internet facing hosts. A false positive rate above 10 percent triggers a tuning review.",
  "Asset inventory":
    "Every asset is registered with an owner, business purpose and last review date. Unmanaged devices are blocked from the corporate network. Software licences are reconciled against the inventory every quarter. Decommissioned equipment is securely wiped before disposal.",
  "Change management":
    "Production changes require a ticket, a peer review and a rollback plan. Emergency changes are retrospectively reviewed within one business day. A separation of duties rule prevents the author of a change from approving it.",
};

const fullText = Object.entries(SECTIONS)
  .map(([title, body]) => `${title}\n\n${body}`)
  .join("\n\n");

/* -------------------------------------------------------------------------- */

console.log("\nChunking");
const chunks = chunkText(fullText);

check("produces multiple chunks", chunks.length > 1, `got ${chunks.length}`);
check(
  "every chunk stays within the 800 character window",
  chunks.every((chunk) => chunk.content.length <= 800),
  `max ${Math.max(...chunks.map((c) => c.content.length))}`,
);
check(
  "consecutive chunks overlap by roughly 150 characters",
  chunks.slice(1).every((chunk, index) => {
    const previous = chunks[index];
    const overlap = previous.end - chunk.start;
    return overlap > 0 && overlap <= 220;
  }),
  chunks
    .slice(1)
    .map((chunk, index) => chunks[index].end - chunk.start)
    .join(", "),
);
check(
  "headings stay attached to their body",
  chunks.every(
    (chunk) =>
      !chunk.content.startsWith("ISO 27001 access control\n\n") ||
      chunk.content.includes("multi-factor authentication"),
  ),
);
check(
  "offsets stay inside the source document",
  chunks.every(
    (chunk) => chunk.start >= 0 && chunk.end <= fullText.length && chunk.start < chunk.end,
  ),
);

/* -------------------------------------------------------------------------- */
/*
 * Regression: the overlap-tail stall that crashed the tab on upload.
 *
 * A paragraph that nearly fills the window leaves no room for the full
 * 150 character overlap seed (150 + 714 + 2 > 800). The packer used to
 * reject its very first candidate in that situation, leave `cursor` sitting
 * on `blockIndex`, and let the outer loop repack the same block forever,
 * pushing a chunk on every pass until the browser ran out of memory
 * ("Aw, Snap!" when uploading a ~46 KB EA39 signal-file).
 *
 * The input below is the synthetic equivalent: paragraphs long enough to
 * stall the old code, short enough to stay on the packing path.
 */
console.log("\nChunking regression (overlap-tail stall)");
const stallParagraphs = Array.from(
  { length: 12 },
  (_, i) =>
    `Paragraph ${i} ` +
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. "
      .repeat(10)
      .trim(),
);
const stallText = stallParagraphs.join("\n\n");
const stallChunks = chunkText(stallText);

check(
  "terminates with one chunk per paragraph instead of repacking forever",
  stallChunks.length === stallParagraphs.length,
  `got ${stallChunks.length} chunks for ${stallParagraphs.length} paragraphs`,
);
check(
  "stalled-input chunks stay within the 800 character window",
  stallChunks.every((chunk) => chunk.content.length <= 800),
  `max ${Math.max(...stallChunks.map((c) => c.content.length))}`,
);
check(
  "every stalled paragraph survives into a chunk whole",
  stallParagraphs.every((paragraph) =>
    stallChunks.some((chunk) => chunk.content.includes(paragraph)),
  ),
);
check(
  "stalled-input chunks keep a positive, bounded overlap",
  stallChunks
    .slice(1)
    .every((chunk, index) => {
      const overlap = stallChunks[index].end - chunk.start;
      return overlap > 0 && overlap <= 220;
    }),
  stallChunks
    .slice(1)
    .map((chunk, index) => stallChunks[index].end - chunk.start)
    .join(", "),
);
check(
  "stalled-input offsets stay inside the source document",
  stallChunks.every(
    (chunk) =>
      chunk.start >= 0 && chunk.end <= stallText.length && chunk.start < chunk.end,
  ),
);

/* A paragraph past the window goes through hardSplit: its slices must carry
 * their own offsets, otherwise every slice reports the block's start and the
 * persisted start/end offsets drift thousands of characters from the truth. */
const giantParagraph = Array.from(
  { length: 40 },
  (_, i) => `line ${i} of the very long paragraph with some words in it`,
).join("\n");
const giantText = ["Short intro paragraph.", giantParagraph, "Short outro paragraph."].join(
  "\n\n",
);
const giantChunks = chunkText(giantText);

check(
  "an oversized paragraph is split, not dropped",
  giantChunks.some((chunk) => chunk.content.includes("line 0 ")) &&
    giantChunks.some((chunk) => chunk.content.includes("line 39 ")),
  `${giantChunks.length} chunks`,
);
check(
  "hard-split slices point at their real position in the source",
  giantChunks.every((chunk) => giantText.slice(chunk.start, chunk.end) === chunk.content),
  giantChunks
    .filter((chunk) => giantText.slice(chunk.start, chunk.end) !== chunk.content)
    .map((c) => `${c.start}-${c.end}`)
    .join(", "),
);
check(
  "hard-split chunks stay within the 800 character window",
  giantChunks.every((chunk) => chunk.content.length <= 800),
  `max ${Math.max(...giantChunks.map((c) => c.content.length))}`,
);

/* -------------------------------------------------------------------------- */

console.log("\nCSV parsing");
const rows = parseCsvRows(
  'a,b,c\n1,"two, and a half",3\n"multi\nline",x,y\n',
);
check("parses quoted commas", rows[1]?.[1] === "two, and a half");
check("parses embedded newlines", rows[2]?.[0] === "multi\nline");
check("drops empty rows", rows.length === 3);

/* -------------------------------------------------------------------------- */

console.log("\nRetrieval");
const docChunks: DocumentChunk[] = chunks.map((chunk) => ({
  id: `c${chunk.index}`,
  documentId: "doc1",
  spaceId: "space1",
  index: chunk.index,
  content: chunk.content,
  start: chunk.start,
  end: chunk.end,
}));

const queries: Array<[string, string | null]> = [
  ["What is the maximum position size per trade?", "Position sizing must never exceed"],
  ["How long do we retain audit evidence?", "Evidence is retained"],
  ["What invalidates a breakout setup?", "Invalidation sits below"],
  ["How often do we run restore drills?", "Restore drills happen"],
  ["What is the RTO for disaster recovery?", "recovery time objective is 4 hours"],
  ["How quickly must critical CVEs be patched?", "patched within 72 hours"],
  ["Who can approve a production change?", "separation of duties"],
  ["How long must suppliers keep audit rights?", "right to audit clause"],
  ["quantum entanglement photonic computing", null],
];

for (const [query, expected] of queries) {
  const hits = searchLexical(docChunks, query, { topK: 2 });
  if (expected === null) {
    check(`"${query}" returns nothing`, hits.length === 0);
  } else {
    // A passage can straddle a chunk boundary, so the phrase may appear in
    // either of the top hits.
    const found = hits.some((hit) => hit.chunk.content.includes(expected));
    check(
      `"${query}" surfaces "${expected}"`,
      found,
      hits.length
        ? `top hits: ${hits.map((h) => h.chunk.content.slice(0, 50).replace(/\n/g, " ")).join(" // ")}`
        : "no hits",
    );
  }
}

/* -------------------------------------------------------------------------- */

console.log("\nThai retrieval (character-bigram tokenizer)");
const thaiChunks: DocumentChunk[] = [
  {
    id: "th1",
    documentId: "doc-th",
    spaceId: "space1",
    index: 0,
    content:
      "คู่มือการตั้งค่า: ผู้ดูแลระบบต้องตั้งค่า API key ในหน้าตั้งค่า LLM ก่อนเริ่มใช้งานทุกครั้ง",
    start: 0,
    end: 90,
  },
  {
    id: "th2",
    documentId: "doc-th",
    spaceId: "space1",
    index: 1,
    content: "รายงานผลการเทรดประจำสัปดาห์ กำไรสุทธิเพิ่มขึ้นร้อยละสิบสอง",
    start: 90,
    end: 150,
  },
];

const thaiTokens = tokenize("การตั้งค่า");
check(
  "tokenize() turns Thai text into character bigrams",
  thaiTokens.length > 0 &&
    thaiTokens.every((token) => /^[\u0E01-\u0E7F]{2}$/.test(token)),
  JSON.stringify(thaiTokens),
);
check(
  "stem() leaves Thai tokens untouched",
  stemTokens(thaiTokens).every((token) =>
    /^[\u0E01-\u0E7F]{2}$/.test(token),
  ),
);
check(
  "English text produces no Thai tokens",
  tokenize("position sizing rules").every(
    (token) => !/[\u0E00-\u0E7F]/.test(token),
  ),
);

const thaiHits = searchLexical(thaiChunks, "ตั้งค่า API key อย่างไร", {
  topK: 2,
});
check(
  "a Thai query surfaces the matching Thai chunk",
  thaiHits[0]?.chunk.id === "th1",
  thaiHits.length ? `top hit: ${thaiHits[0]?.chunk.id}` : "no hits",
);
// Note: character bigrams trade precision for recall - a totally unrelated
// Thai sentence usually shares *some* bigram ("าย", "กา"…) with a fixture,
// especially in a tiny corpus. Common bigrams get a low idf in real corpora,
// which is what keeps noise down in practice, so no negative Thai case is
// asserted here.

/* -------------------------------------------------------------------------- */

console.log("\nEmbedding batching");
const manyValues = Array.from({ length: 250 }, (_, i) => `chunk number ${i}`);
const batches = splitIntoBatches(manyValues);
check(
  `splits ${manyValues.length} texts into batches of <= ${EMBED_BATCH_SIZE}`,
  batches.length === Math.ceil(manyValues.length / EMBED_BATCH_SIZE) &&
    batches.every((batch) => batch.length > 0 && batch.length <= EMBED_BATCH_SIZE),
);
check(
  "batching preserves every value, in order",
  batches.flat().join("|") === manyValues.join("|"),
);
check("an empty input produces no batches", splitIntoBatches([]).length === 0);

/* -------------------------------------------------------------------------- */

console.log("\nMarkdown link safety");
const safeLinks = ["https://kilo.ai", "http://localhost:3000/x", "mailto:a@b.co"];
const unsafeLinks = [
  "sandbox:/mnt/data/report.pptx",
  "files/report.csv",
  "/download/report.pptx",
  "blob:http://localhost:3000/abc",
  "javascript:alert(1)",
  "data:text/html,<h1>x</h1>",
  "",
];
check(
  "web and mail links stay clickable",
  safeLinks.every((url) => isSafeExternalLink(url)),
);
check(
  "fabricated file paths are not rendered as anchors",
  unsafeLinks.every((url) => !isSafeExternalLink(url)),
  unsafeLinks.filter((url) => isSafeExternalLink(url)).join(", "),
);

/* -------------------------------------------------------------------------- */

console.log("\nContext assembly");
const spaces: Space[] = [
  {
    id: "space1",
    name: "XAUUSD & MT5 Research",
    description: "",
    color: "",
    emoji: "📈",
    createdAt: 0,
    updatedAt: 0,
  },
];
const documents: DocumentMeta[] = [
  {
    id: "doc1",
    spaceId: "space1",
    name: "handbook.txt",
    fileName: "handbook.txt",
    mimeType: "text/plain",
    size: 0,
    chunkCount: chunks.length,
    charCount: fullText.length,
    createdAt: 0,
    embedded: false,
  },
];

const hits = searchLexical(docChunks, "position sizing risk", { topK: 2 });
const block = buildContextBlock(
  hits.map((hit) => ({
    chunkId: hit.chunk.id,
    documentId: hit.chunk.documentId,
    documentName: "handbook.txt",
    spaceId: hit.chunk.spaceId,
    spaceName: "XAUUSD & MT5 Research",
    content: hit.chunk.content,
    score: hit.score,
    strategy: "bm25" as const,
  })),
  spaces,
  documents,
);

check("wraps excerpts in a knowledge base block", block.text.includes("<knowledge_base>"));
check("names the source document", block.text.includes('document="handbook.txt"'));
check("carries one source record per excerpt", block.sources.length === hits.length);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
