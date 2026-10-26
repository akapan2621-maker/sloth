/**
 * Shared domain types for the AI Workspace.
 */

/* -------------------------------------------------------------------------- */
/* Providers & models                                                         */
/* -------------------------------------------------------------------------- */

export type ProviderId =
  | "kilo"
  | "custom"
  | "gemini"
  | "groq"
  | "openrouter";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** Suggestion for the free-text model id. */
  defaultModelId: string;
  /** Model ids offered as quick-pick chips for this provider. */
  models: string[];
  /** Whether the provider can serve embeddings (Mode 2 vector retrieval). */
  supportsEmbeddings: boolean;
  /** Where the API key is expected to be typed in. */
  keyHint: string;
}

export interface LlmSettings {
  providerId: ProviderId;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Model ids the user pinned to the quick-switch dropdown. */
  savedModelIds: string[];
  temperature: number;
  /** Number of chunks injected into the system prompt. */
  topK: number;
  /** Optional user-supplied system prompt that replaces the default one. */
  systemPrompt: string;
  /** When true the API key is never sent to our server (direct browser calls). */
  privateMode: boolean;
}

export type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string; latencyMs?: number; models?: string[] }
  | { status: "error"; message: string };

/* -------------------------------------------------------------------------- */
/* Spaces & documents                                                         */
/* -------------------------------------------------------------------------- */

export interface Space {
  id: string;
  name: string;
  /** Tailwind-safe accent used for chips and headers. */
  color: string;
  emoji: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentMeta {
  id: string;
  spaceId: string;
  name: string;
  /** Original file name including extension. */
  fileName: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  charCount: number;
  createdAt: number;
  /** True when the document has an embedding vector attached. */
  embedded: boolean;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  spaceId: string;
  /** Index of the chunk inside its document. */
  index: number;
  content: string;
  /** Character offset of the chunk inside the extracted text. */
  start: number;
  end: number;
  /** Optional embedding (dimension depends on the embedding model). */
  embedding?: number[];
  embeddingModel?: string;
}

export type IngestStage =
  | "queued"
  | "extracting"
  | "chunking"
  | "indexing"
  | "done"
  | "error";

export interface IngestProgress {
  fileName: string;
  stage: IngestStage;
  /** 0..1 */
  percent: number;
  message: string;
  documentId?: string;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* RAG                                                                        */
/* -------------------------------------------------------------------------- */

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  spaceId: string;
  spaceName: string;
  content: string;
  score: number;
  /** Which engine produced the hit. "head" = document-opening fallback. */
  strategy: "bm25" | "vector" | "hybrid" | "head";
}

export interface RagResult {
  chunks: RetrievedChunk[];
  strategy: "bm25" | "vector" | "hybrid";
  /** Human readable summary shown in the UI. */
  detail: string;
  /** How long retrieval took in ms. */
  elapsedMs: number;
}

export type SpaceSelection = { kind: "none" } | { kind: "all" } | { kind: "space"; spaceId: string };

/* -------------------------------------------------------------------------- */
/* Chats                                                                      */
/* -------------------------------------------------------------------------- */

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Sources that were used to ground this assistant turn. */
  sources?: RetrievedChunk[];
  /** Model that produced the turn. */
  modelId?: string;
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  spaceSelection: SpaceSelection;
  modelId: string;
  pinned?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export interface QuickMode {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface StarterPrompt {
  id: string;
  title: string;
  description: string;
  icon: string;
  prompt: string;
  category: "research" | "document" | "presentation" | "visual" | "general";
}
