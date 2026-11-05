/**
 * Storage health diagnostics.
 *
 * Everything the workspace saves lives in the browser origin (localStorage +
 * IndexedDB), so persisted data is bound to the *exact* URL the app is opened
 * from. That is the usual reason "closing the browser lost my data":
 *
 *  1. The app was opened from a per-deployment Vercel subdomain
 *     (`sloth-ai-workspace-<hash>-akapans-projects.vercel.app`) instead of the
 *     stable alias (`sloth-ai-workspace.vercel.app`). Each subdomain is its own
 *     origin with completely separate storage.
 *  2. The browser is set to clear site data when it closes, or a cleaner tool
 *     wipes it.
 *  3. The browser is private/incognito.
 *
 * Note that the *login* is sessionStorage-only by design: every fresh browser
 * session shows the login screen, while reloading a tab stays signed in. The
 * workspace data itself is durable and rehydrates from Vercel Blob after the
 * user signs in.
 *
 * `readStorageHealth()` surfaces all of these so the UI can show it instead of
 * the user having to guess.
 */

import { SESSION_KEY } from "./authBackend";

/** The stable production alias safe to bookmark. */
export const CANONICAL_HOST = "sloth-ai-workspace.vercel.app";

export interface StorageHealth {
  host: string;
  origin: string;
  /** Opened from the stable alias or localhost (both fine). */
  isCanonical: boolean;
  /** Local development host — expected, never warn. */
  isLocal: boolean;
  /** A session pointer exists in sessionStorage (this tab is signed in). */
  sessionActive: boolean;
  /** navigator.storage.persisted() — granted durable-storage exemption. */
  persistent: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  indexedDbAvailable: boolean;
}

function safeGet(storage: "local" | "session", key: string): boolean {
  try {
    const bag = storage === "local" ? window.localStorage : window.sessionStorage;
    return Boolean(bag.getItem(key));
  } catch {
    return false;
  }
}

/** Ask the browser for durable storage (best effort, silent when refused). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      return null;
    }
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function readStorageHealth(): Promise<StorageHealth> {
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  const isCanonical = host === CANONICAL_HOST || isLocal;

  const sessionActive = safeGet("session", SESSION_KEY);

  let persistent: boolean | null = null;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    if (navigator.storage?.persisted) {
      persistent = await navigator.storage.persisted();
    }
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    }
  } catch {
    /* diagnostics only */
  }

  let indexedDbAvailable = false;
  try {
    indexedDbAvailable = typeof indexedDB !== "undefined";
  } catch {
    /* diagnostics only */
  }

  return {
    host,
    origin,
    isCanonical,
    isLocal,
    sessionActive,
    persistent,
    usageBytes,
    quotaBytes,
    indexedDbAvailable,
  };
}
