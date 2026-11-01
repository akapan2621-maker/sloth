/**
 * Browser persistence layer, namespaced per account.
 *
 * Every login (local account, Supabase user, guest) gets its own isolated
 * workspace: a dedicated IndexedDB database and prefixed `localStorage` keys.
 * That is what makes "sign out then sign back in" restore the original
 * chats/spaces/documents — nothing is shared between accounts.
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

/* -------------------------------------------------------------------------- */
/* Account namespace                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Active account namespace. "" is the legacy / guest scope: it maps to the
 * original `amazon-quick-workspace` database and unprefixed `aqw:` keys, so
 * old data and the e2e scripts keep working.
 */
let namespace = "";

const dbPromises = new Map<string, Promise<IDBDatabase | null>>();
const brokenDbs = new Set<string>();

/** Lowers the active namespace (clears cached db handles). */
export function setNamespace(ns: string): void {
  const next = ns || "";
  if (next === namespace) return;
  namespace = next;
}

/** The namespace the store currently reads/writes. */
export function getNamespace(): string {
  return namespace;
}

export function currentDbName(ns: string = namespace): string {
  return ns ? `${DB_NAME}-${sanitizeNamespace(ns)}` : DB_NAME;
}

function sanitizeNamespace(ns: string): string {
  return ns.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 40);
}

export { DB_NAME, DB_VERSION };

/* -------------------------------------------------------------------------- */
/* Opening                                                                    */
/* -------------------------------------------------------------------------- */

function openRawDatabase(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (brokenDbs.has(name)) return Promise.resolve(null);

  const existing = dbPromises.get(name);
  if (existing) return existing;

  const promise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, DB_VERSION);
    } catch {
      brokenDbs.add(name);
      dbPromises.set(name, Promise.resolve(null));
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

    request.onsuccess = () => {
      dbPromises.set(name, promise);
      resolve(request.result);
    };
    request.onerror = () => {
      brokenDbs.add(name);
      dbPromises.set(name, Promise.resolve(null));
      resolve(null);
    };
    request.onblocked = () => {
      brokenDbs.add(name);
      dbPromises.set(name, Promise.resolve(null));
      resolve(null);
    };
  });

  dbPromises.set(name, promise);
  return promise;
}

/** Opens the database for the currently active namespace. */
function openDatabase(): Promise<IDBDatabase | null> {
  return openRawDatabase(currentDbName());
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
/* Generic operations (namespace-scoped)                                      */
/* -------------------------------------------------------------------------- */

function lsScope(): string {
  return namespace ? `${namespace}:` : "";
}

function localKey(store: StoreName, id: string): string {
  return `${LS_PREFIX}${lsScope()}${store}:${id}`;
}

function localAll<T>(store: StoreName): T[] {
  if (!isLocalStorageAvailable()) return [];
  const out: T[] = [];
  const prefix = `${LS_PREFIX}${lsScope()}${store}:`;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
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
  const prefix = `${LS_PREFIX}${lsScope()}${store}:`;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
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
      localStorage.setItem(`${LS_PREFIX}${lsScope()}kv:${key}`, JSON.stringify(value));
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
    const raw = localStorage.getItem(`${LS_PREFIX}${lsScope()}kv:${key}`);
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

/** Approximate on-disk footprint of the local workspace (active namespace). */
export async function localUsageBytes(): Promise<number> {
  const scope = lsScope();
  if (!isLocalStorageAvailable()) return 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(`${LS_PREFIX}${scope}`)) continue;
    total += (localStorage.getItem(key) ?? "").length * 2;
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Legacy adoption                                                            */
/* -------------------------------------------------------------------------- */

const LEGACY_ADOPTED_KEY = "legacy-adopted";

function readAllRaw<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  return new Promise<T[]>((resolve) => {
    try {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function putManyRaw(
  db: IDBDatabase,
  store: StoreName,
  values: unknown[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (values.length === 0) {
      resolve();
      return;
    }
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
}

function collectLegacyLocalStorage(): { spaces: Space[]; documents: DocumentMeta[]; chunks: DocumentChunk[]; chats: ChatSession[]; kv: KvEntry[] } {
  const pick = <T,>(store: StoreName): T[] => {
    if (!isLocalStorageAvailable()) return [];
    const out: T[] = [];
    const prefix = `${LS_PREFIX}${store}:`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (raw) out.push(JSON.parse(raw) as T);
      } catch {
        /* skip */
      }
    }
    return out;
  };

  // kv fallback records store the bare value, not a {key, value} entry —
  // rebuild the entry from the localStorage key itself.
  const kv: KvEntry[] = [];
  if (isLocalStorageAvailable()) {
    const prefix = `${LS_PREFIX}kv:`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const storedKey = localStorage.key(i);
      if (!storedKey || !storedKey.startsWith(prefix)) continue;
      try {
        const raw = localStorage.getItem(storedKey);
        if (!raw) continue;
        kv.push({ key: storedKey.slice(prefix.length), value: JSON.parse(raw) });
      } catch {
        /* skip */
      }
    }
  }

  return {
    spaces: pick<Space>("spaces"),
    documents: pick<DocumentMeta>("documents"),
    chunks: pick<DocumentChunk>("chunks"),
    chats: pick<ChatSession>("chats"),
    kv,
  };
}

/**
 * Copies anything living in the pre-login workspace (the default namespace
 * database + its `localStorage` fallback records) into the freshly created
 * account namespace, once. New accounts therefore "inherit" the data that the
 * browser already holds, and existing users lose nothing when the login
 * system ships.
 *
 * Returns the number of records adopted. Never copies when the target
 * namespace already holds records.
 */
export async function migrateLegacyToNamespace(ns: string): Promise<number> {
  if (!ns || ns === "guest") return 0;

  const targetDb = await openRawDatabase(currentDbName(ns));
  if (!targetDb) return 0;

  const targetSpaces = await readAllRaw<Space>(targetDb, STORES.spaces);
  const targetChats = await readAllRaw<ChatSession>(targetDb, STORES.chats);
  if (targetSpaces.length > 0 || targetChats.length > 0) return 0;

  const legacyDb = await openRawDatabase(DB_NAME);
  let adapted = collectLegacyLocalStorage();

  if (legacyDb) {
    const [spaces, documents, chunks, chats, kvEntries] = await Promise.all([
      readAllRaw<Space>(legacyDb, STORES.spaces),
      readAllRaw<DocumentMeta>(legacyDb, STORES.documents),
      readAllRaw<DocumentChunk>(legacyDb, STORES.chunks),
      readAllRaw<ChatSession>(legacyDb, STORES.chats),
      readAllRaw<KvEntry>(legacyDb, STORES.kv),
    ]);
    if (kvEntries.length > 0) {
      // Prefer IndexedDB kv entries; merge by key with LS fallback first.
      const map = new Map<string, KvEntry>();
      for (const entry of adapted.kv) map.set(String(entry.key), entry);
      for (const entry of kvEntries) map.set(String(entry.key), entry);
      adapted = { ...adapted, kv: [...map.values()] };
    }
    adapted = {
      spaces,
      documents,
      chunks,
      chats,
      kv: adapted.kv,
    };
  }

  const total =
    adapted.spaces.length +
    adapted.documents.length +
    adapted.chunks.length +
    adapted.chats.length;

  if (total === 0) {
    void putManyRaw(targetDb, STORES.kv, [
      { key: LEGACY_ADOPTED_KEY, value: "adopted-empty" } satisfies KvEntry,
    ]);
    return 0;
  }

  await putManyRaw(targetDb, STORES.spaces, adapted.spaces);
  await putManyRaw(targetDb, STORES.documents, adapted.documents);
  await putManyRaw(targetDb, STORES.chunks, adapted.chunks);
  await putManyRaw(targetDb, STORES.chats, adapted.chats);

  const settings = adapted.kv.filter((entry) => entry.key === "llm-settings");
  if (settings.length > 0) await putManyRaw(targetDb, STORES.kv, settings);
  await putManyRaw(targetDb, STORES.kv, [
    { key: LEGACY_ADOPTED_KEY, value: "done" } satisfies KvEntry,
  ]);

  return total;
}
