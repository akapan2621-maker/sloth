/**
 * Workspace mirror on Vercel Blob.
 *
 * The IndexedDB workspace is bound to one browser. This layer keeps a JSON
 * snapshot (Spaces, documents, chunks, chats — not settings, which hold the
 * API key) on Vercel Blob so a fresh browser or a different machine can pull
 * the same workspace back after signing in.
 *
 * The snapshot is keyed by a hash of the account's email, which is stable
 * across devices — unlike the local account id, which is generated per
 * browser. Guest has no email and deliberately never syncs.
 *
 * Convenience-level storage, not a vault: the key is derivable from an email.
 * Nobody stores credentials or API keys in there, so mirror leakage only
 * reveals workspace content similar to a shared notebook.
 */

import type { ChatSession, DocumentChunk, DocumentMeta, Space } from "./types";

export interface WorkspaceSnapshot {
  spaces: Space[];
  documents: DocumentMeta[];
  chunks: DocumentChunk[];
  chats: ChatSession[];
  savedAt: number;
}

export interface CloudSaveResult {
  savedAt: number;
  url: string;
  size: number;
}

/** Single-file JSON cap. Larger snapshots skip chats, then refuse entirely. */
const MAX_BYTES = 48 * 1024 * 1024;

const DEBOUNCE_MS = 3_000;

/** Stable cross-device key for an account: lowercase email → sha-256 hex. */
export async function cloudKeyFor(email: string): Promise<string | null> {
  if (!email?.trim()) return null;
  const normalized = email.trim().toLowerCase();
  try {
    const buffer = new TextEncoder().encode(`sloth-workspace:${normalized}`);
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40);
  } catch {
    return null;
  }
}

type SnapshotInput = Omit<WorkspaceSnapshot, "savedAt">;

/** Serializes within the size cap, dropping chats first when oversized. */
function serialize(payload: SnapshotInput): string | null {
  const full = JSON.stringify({ ...payload, savedAt: Date.now() });
  if (full.length <= MAX_BYTES) return full;
  const withoutChats = JSON.stringify({
    ...payload,
    chats: [],
    savedAt: Date.now(),
  });
  if (withoutChats.length <= MAX_BYTES) return withoutChats;
  return null;
}

/** Pushes the current workspace to the mirror (server route → Vercel Blob). */
export async function saveWorkspaceSnapshot(
  key: string,
  payload: SnapshotInput,
  options?: { preferKeepalive?: boolean },
): Promise<CloudSaveResult | null> {
  const body = serialize(payload);
  if (!body) return null;
  try {
    const response = await fetch("/api/cloud/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, data: body }),
      // keepalive lets a small snapshot finish after the tab is hidden or
      // closed; browsers cap keepalive bodies around 64 KB, so only use it
      // when the payload comfortably fits.
      keepalive: Boolean(options?.preferKeepalive) && body.length < 60_000,
    });
    if (!response.ok) return null;
    const result = (await response.json()) as Partial<CloudSaveResult>;
    if (typeof result.url !== "string") return null;
    return {
      savedAt: Number(result.savedAt ?? Date.now()),
      url: result.url,
      size: Number(result.size ?? body.length),
    };
  } catch {
    return null;
  }
}

/** Pulls the mirror back; null when nothing has been saved (or unreachable). */
export async function loadWorkspaceSnapshot(
  key: string,
): Promise<WorkspaceSnapshot | null> {
  try {
    const response = await fetch(
      `/api/cloud/snapshot?key=${encodeURIComponent(key)}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<WorkspaceSnapshot>;
    return {
      spaces: Array.isArray(data.spaces) ? data.spaces : [],
      documents: Array.isArray(data.documents) ? data.documents : [],
      chunks: Array.isArray(data.chunks) ? data.chunks : [],
      chats: Array.isArray(data.chats) ? data.chats : [],
      savedAt: Number(data.savedAt ?? 0),
    };
  } catch {
    return null;
  }
}

export const CLOUD_SYNC_DEBOUNCE_MS = DEBOUNCE_MS;

/**
 * Runs `task` when the browser has spare time. Background tabs throttle
 * `setTimeout` (down to once a minute after a while); `requestIdleCallback`
 * with a timeout keeps the mirror timely without stealing frames from the UI.
 */
export function runInBackground(task: () => void): void {
  const idle = (
    window as unknown as {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (idle) {
    idle(task, { timeout: 2_000 });
    return;
  }
  setTimeout(task, 0);
}
