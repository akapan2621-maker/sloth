/**
 * Browser persistence layer.
 *
 * IndexedDB is the primary store (chunks can be large). If IndexedDB is
 * unavailable - private browsing, disabled storage, SSR - the module
 * transparently falls back to `localStorage` so the workspace still works
 * with zero external setup.
 */

import type {
  ChatSession,
  DocumentChunk,
  DocumentMeta,
  LlmSettings,
  Space,
} from "./types";

const DB_NAME = "amazon-quick-workspace";
const DB_VERSION = 1;

export const STORES = {
  spaces: "spaces",
  documents: "documents",
  chunks: "chunks",
  chats: "chats",
  kv: "kv",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

interface KvEntry<T = unknown> {
  key: string;
  value: T;
}

const LS_PREFIX = "aqw:";

let dbPromise: Promise<IDBDatabase | null> | null = null;
let idbBroken = false;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (idbBroken) return Promise.resolve(null);

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        idbBroken = true;
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.spaces)) {
          db.createObjectStore(STORES.spaces, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORES.documents)) {
          const docs = db.createObjectStore(STORES.documents, { keyPath: "id" });
          docs.createIndex("spaceId", "spaceId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.chunks)) {
          const chunks = db.createObjectStore(STORES.chunks, { keyPath: "id" });
          chunks.createIndex("spaceId", "spaceId", { unique: false });
          chunks.createIndex("documentId", "documentId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.chats)) {
          db.createObjectStore(STORES.chats, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORES.kv)) {
          db.createObjectStore(STORES.kv, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        idbBroken = true;
        resolve(null);
      };
      request.onblocked = () => {
        idbBroken = true;
        resolve(null);
      };
    });
  }

  return dbPromise;
}

function isLocalStorageAvailable(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const probe = "__aqw_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Generic operations                                                         */
/* -------------------------------------------------------------------------- */

function localKey(store: StoreName, id: string): string {
  return `${LS_PREFIX}${store}:${id}`;
}

function localAll<T>(store: StoreName): T[] {
  if (!isLocalStorageAvailable()) return [];
  const out: T[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(`${LS_PREFIX}${store}:`)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      out.push(JSON.parse(raw) as T);
    } catch {
      /* skip corrupt entry */
    }
  }
  return out;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(store, mode);
          const request = run(transaction.objectStore(store));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const result = await tx<T[]>(store, "readonly", (os) => os.getAll() as IDBRequest<T[]>);
  if (result) return result;
  return localAll<T>(store);
}

export async function getById<T>(store: StoreName, id: string): Promise<T | null> {
  const result = await tx<T>(store, "readonly", (os) => os.get(id) as IDBRequest<T>);
  if (result !== null && result !== undefined) return result;
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(localKey(store, id));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function put<T extends { id: string }>(
  store: StoreName,
  value: T,
): Promise<void> {
  const result = await tx(store, "readwrite", (os) => os.put(value) as IDBRequest<IDBValidKey>);
  if (result !== null) return;
  if (isLocalStorageAvailable()) {
    try {
      localStorage.setItem(localKey(store, value.id), JSON.stringify(value));
    } catch {
      /* quota exceeded - ignore */
    }
  }
}

export async function putMany<T extends { id: string }>(
  store: StoreName,
  values: T[],
): Promise<void> {
  if (values.length === 0) return;
  const db = await openDatabase();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(store, "readwrite");
        const objectStore = transaction.objectStore(store);
        for (const value of values) objectStore.put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    return;
  }

  if (isLocalStorageAvailable()) {
    for (const value of values) {
      try {
        localStorage.setItem(localKey(store, value.id), JSON.stringify(value));
      } catch {
        /* ignore */
      }
    }
  }
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const result = await tx(store, "readwrite", (os) => os.delete(id) as IDBRequest<undefined>);
  if (result !== null) return;
  if (isLocalStorageAvailable()) localStorage.removeItem(localKey(store, id));
}

export async function clearStore(store: StoreName): Promise<void> {
  const result = await tx(store, "readwrite", (os) => os.clear() as IDBRequest<undefined>);
  if (result !== null) return;
  if (!isLocalStorageAvailable()) return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(`${LS_PREFIX}${store}:`)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}

/* -------------------------------------------------------------------------- */
/* Key/value helpers                                                          */
/* -------------------------------------------------------------------------- */

export async function setKv<T>(key: string, value: T): Promise<void> {
  const entry: KvEntry<T> = { key, value };
  const result = await tx(
    STORES.kv,
    "readwrite",
    (os) => os.put(entry) as IDBRequest<IDBValidKey>,
  );
  if (result !== null) return;
  if (isLocalStorageAvailable()) {
    try {
      localStorage.setItem(`${LS_PREFIX}kv:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }
}

export async function getKv<T>(key: string): Promise<T | null> {
  const result = await tx<KvEntry<T>>(
    STORES.kv,
    "readonly",
    (os) => os.get(key) as IDBRequest<KvEntry<T>>,
  );
  if (result) return result.value ?? null;
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}kv:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Typed convenience wrappers                                                 */
/* -------------------------------------------------------------------------- */

export const localStore = {
  spaces: {
    all: () => getAll<Space>(STORES.spaces),
    put: (space: Space) => put(STORES.spaces, space),
    remove: (id: string) => remove(STORES.spaces, id),
    clear: () => clearStore(STORES.spaces),
  },
  documents: {
    all: () => getAll<DocumentMeta>(STORES.documents),
    put: (doc: DocumentMeta) => put(STORES.documents, doc),
    remove: (id: string) => remove(STORES.documents, id),
    clear: () => clearStore(STORES.documents),
  },
  chunks: {
    all: () => getAll<DocumentChunk>(STORES.chunks),
    putMany: (chunks: DocumentChunk[]) => putMany(STORES.chunks, chunks),
    remove: (id: string) => remove(STORES.chunks, id),
    clear: () => clearStore(STORES.chunks),
  },
  chats: {
    all: () => getAll<ChatSession>(STORES.chats),
    put: (chat: ChatSession) => put(STORES.chats, chat),
    remove: (id: string) => remove(STORES.chats, id),
    clear: () => clearStore(STORES.chats),
  },
  settings: {
    get: () => getKv<LlmSettings>("llm-settings"),
    set: (settings: LlmSettings) => setKv("llm-settings", settings),
  },
};

/** Reports which backing store is active - surfaced in the Spaces UI. */
export async function storageBackend(): Promise<"indexeddb" | "localstorage" | "memory"> {
  const db = await openDatabase();
  if (db) return "indexeddb";
  if (isLocalStorageAvailable()) return "localstorage";
  return "memory";
}

/** Approximate on-disk footprint of the local workspace. */
export async function localUsageBytes(): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      return usage ?? 0;
    } catch {
      /* ignore */
    }
  }
  if (!isLocalStorageAvailable()) return 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;
    total += (localStorage.getItem(key) ?? "").length * 2;
  }
  return total;
}
