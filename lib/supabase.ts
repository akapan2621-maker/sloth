/**
 * Optional Supabase integration.
 *
 * The app is fully functional without Supabase. When the public URL + anon
 * key are present we mirror Spaces / Documents / Chunks / Chats to Postgres
 * and use `pgvector` for vector retrieval (Mode 2). Everything degrades
 * gracefully when the project is not configured or the network is unavailable.
 *
 * Note: the original uploaded files no longer live here — archival uploads go
 * to Vercel Blob through `/api/upload` (see `lib/blobStorage.ts`).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { remoteSyncActive } from "./authBackend";
import type { ChatSession, DocumentChunk, DocumentMeta, Space } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;

/** Returns the shared Supabase client, or null when not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { headers: { "x-application-name": "amazon-quick-workspace" } },
  });
  return client;
}

/**
 * Remote mirroring is only allowed for a signed-in Supabase identity: RLS
 * (`supabase/auth-migration.sql`) then scopes every row to `auth.uid()`.
 * Local accounts and guests stay browser-local so two logins on one machine
 * can never mix their workspaces. Every mirror call no-ops when this is off.
 */
function mirror(): boolean {
  return remoteSyncActive();
}

/* -------------------------------------------------------------------------- */
/* Spaces                                                                     */
/* -------------------------------------------------------------------------- */

export async function upsertSpace(space: Space): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("spaces").upsert({
    id: space.id,
    name: space.name,
    description: space.description,
    color: space.color,
    emoji: space.emoji,
    created_at: new Date(space.createdAt).toISOString(),
    updated_at: new Date(space.updatedAt).toISOString(),
  });
  if (error) {
    console.warn("[supabase] upsertSpace failed:", error.message);
    return false;
  }
  return true;
}

export async function deleteSpaceRemote(id: string): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("spaces").delete().eq("id", id);
  if (error) {
    console.warn("[supabase] deleteSpace failed:", error.message);
    return false;
  }
  return true;
}

export async function fetchSpaces(): Promise<Space[] | null> {
  if (!remoteSyncActive()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("spaces")
    .select("id,name,description,color,emoji,created_at,updated_at")
    .order("created_at", { ascending: true });
  if (error || !data) return null;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    color: row.color ?? "from-purple-600 via-pink-500 to-indigo-600",
    emoji: row.emoji ?? "📁",
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at ?? row.created_at).getTime(),
  }));
}

/* -------------------------------------------------------------------------- */
/* Documents & chunks                                                         */
/* -------------------------------------------------------------------------- */

export async function upsertDocument(
  document: DocumentMeta,
  fullText: string,
): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("documents").upsert({
    id: document.id,
    space_id: document.spaceId,
    name: document.name,
    file_name: document.fileName,
    mime_type: document.mimeType,
    size: document.size,
    chunk_count: document.chunkCount,
    char_count: document.charCount,
    content: fullText,
    embedded: document.embedded,
    created_at: new Date(document.createdAt).toISOString(),
  });
  if (error) {
    console.warn("[supabase] upsertDocument failed:", error.message);
    return false;
  }
  return true;
}

export async function upsertChunks(chunks: DocumentChunk[]): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase || chunks.length === 0) return false;

  const rows = chunks.map((chunk) => ({
    id: chunk.id,
    document_id: chunk.documentId,
    space_id: chunk.spaceId,
    chunk_index: chunk.index,
    content: chunk.content,
    start_offset: chunk.start,
    end_offset: chunk.end,
    embedding: chunk.embedding ?? null,
  }));

  const { error } = await supabase
    .from("document_chunks")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    console.warn("[supabase] upsertChunks failed:", error.message);
    return false;
  }
  return true;
}

export async function deleteDocumentRemote(id: string): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) {
    console.warn("[supabase] deleteDocument failed:", error.message);
    return false;
  }
  return true;
}

/** Pulls the document metadata list for the signed-in user (mirror restore). */
export async function fetchDocuments(): Promise<DocumentMeta[] | null> {
  if (!remoteSyncActive()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id,space_id,name,file_name,mime_type,size,chunk_count,char_count,embedded,created_at",
    )
    .order("created_at", { ascending: true });
  if (error || !data) {
    if (error) console.warn("[supabase] fetchDocuments failed:", error.message);
    return null;
  }
  return data.map((row) => ({
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    fileName: row.file_name ?? row.name,
    mimeType: row.mime_type ?? "text/plain",
    size: Number(row.size ?? 0),
    chunkCount: row.chunk_count ?? 0,
    charCount: row.char_count ?? 0,
    createdAt: new Date(row.created_at).getTime(),
    embedded: Boolean(row.embedded),
  }));
}

export async function fetchChunks(spaceIds?: string[]): Promise<DocumentChunk[] | null> {
  if (!remoteSyncActive()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;

  // Embeddings are deliberately excluded: a full archive could be tens of
  // megabytes of floats on the free tier. Restored documents fall back to
  // lexical retrieval until they are re-embedded locally.
  let query = supabase
    .from("document_chunks")
    .select(
      "id,document_id,space_id,chunk_index,content,start_offset,end_offset,embedding_model",
    );
  if (spaceIds && spaceIds.length > 0) {
    query = query.in("space_id", spaceIds);
  }
  const { data, error } = await query;
  if (error || !data) return null;

  return data.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    spaceId: row.space_id,
    index: row.chunk_index ?? 0,
    content: row.content ?? "",
    start: row.start_offset ?? 0,
    end: row.end_offset ?? 0,
    embeddingModel: row.embedding_model ?? undefined,
  }));
}

/* -------------------------------------------------------------------------- */
/* Vector search (pgvector)                                                   */
/* -------------------------------------------------------------------------- */

export interface VectorMatch {
  id: string;
  document_id: string;
  space_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

export async function matchChunksByVector(
  queryEmbedding: number[],
  options: { topK?: number; spaceIds?: string[] } = {},
): Promise<VectorMatch[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_count: options.topK ?? 6,
    filter_space_ids: options.spaceIds && options.spaceIds.length > 0 ? options.spaceIds : null,
  });

  if (error) {
    console.warn("[supabase] match_document_chunks failed:", error.message);
    return null;
  }
  return (data as VectorMatch[]) ?? [];
}

/* -------------------------------------------------------------------------- */
/* Chats                                                                      */
/* -------------------------------------------------------------------------- */

export async function upsertChat(session: ChatSession): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("chats").upsert({
    id: session.id,
    title: session.title,
    messages: session.messages,
    space_selection: session.spaceSelection,
    model_id: session.modelId,
    pinned: session.pinned ?? false,
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
  });
  if (error) {
    console.warn("[supabase] upsertChat failed:", error.message);
    return false;
  }
  return true;
}

export async function deleteChatRemote(id: string): Promise<boolean> {
  if (!mirror()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("chats").delete().eq("id", id);
  if (error) {
    console.warn("[supabase] deleteChat failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Pulls chat history for the signed-in user. This is the piece that makes
 * chats survive a logout: on the next sign-in they are merged back into the
 * local namespace (newest-`updatedAt` wins).
 */
export async function fetchChats(): Promise<ChatSession[] | null> {
  if (!remoteSyncActive()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("chats")
    .select(
      "id,title,messages,space_selection,model_id,pinned,created_at,updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !data) {
    if (error) console.warn("[supabase] fetchChats failed:", error.message);
    return null;
  }
  return data.map((row) => ({
    id: row.id,
    title: row.title ?? "New chat",
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at ?? row.created_at).getTime(),
    messages: Array.isArray(row.messages) ? row.messages : [],
    spaceSelection:
      row.space_selection && row.space_selection.kind
        ? row.space_selection
        : { kind: "none" },
    modelId: row.model_id ?? "",
    pinned: Boolean(row.pinned),
  }));
}
