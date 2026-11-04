"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { chunkText } from "@/lib/chunking";
import {
  DEFAULT_SAVED_MODEL_IDS,
  DEFAULT_SYSTEM_PROMPT,
  KILO_DEFAULT_BASE_URL,
} from "@/lib/constants";
import { parseFile } from "@/lib/fileParser";
import { embedTexts, resetEmbeddingCapability } from "@/lib/embeddings";
import {
  getNamespace,
  localStore,
  migrateLegacyToNamespace,
  setNamespace,
  storageBackend,
} from "@/lib/localDb";
import {
  buildIndex,
  searchLexicalWithIndex,
  searchVectors,
  type BuiltIndex,
} from "@/lib/rag";
import { readUiState, writeUiState } from "@/lib/uiState";
import {
  deleteChatRemote,
  deleteSpaceRemote,
  deleteDocumentRemote,
  fetchChats,
  fetchChunks,
  fetchDocuments,
  fetchSpaces,
  getSupabase,
  isSupabaseConfigured,
  upsertChat,
  upsertChunks,
  upsertDocument,
  upsertSpace,
} from "@/lib/supabase";
import { uploadFileToBlob } from "@/lib/blobStorage";
import { setRemoteSyncUser } from "@/lib/authBackend";
import type {
  ChatMessage,
  ChatSession,
  DocumentChunk,
  DocumentMeta,
  IngestProgress,
  LlmSettings,
  RetrievedChunk,
  Space,
  SpaceSelection,
} from "@/lib/types";
import { normaliseBaseUrl, titleFromMessage, uid } from "@/lib/utils";
import { useAuth } from "./AuthContext";

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_SETTINGS: LlmSettings = {
  providerId: "kilo",
  baseUrl: KILO_DEFAULT_BASE_URL,
  apiKey: "",
  modelId: DEFAULT_SAVED_MODEL_IDS[0],
  savedModelIds: [...DEFAULT_SAVED_MODEL_IDS],
  temperature: 0.7,
  topK: 6,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  privateMode: false,
};

const SPACE_ACCENTS = [
  "from-purple-600 via-pink-500 to-indigo-600",
  "from-amber-500 via-orange-500 to-rose-500",
  "from-emerald-500 via-teal-500 to-cyan-600",
  "from-sky-500 via-blue-600 to-indigo-600",
  "from-fuchsia-500 via-purple-600 to-violet-700",
];

function defaultSpace(
  name: string,
  description: string,
  emoji: string,
  index: number,
  timestamp: number,
): Space {
  return {
    id: uid("space"),
    name,
    description,
    emoji,
    color: SPACE_ACCENTS[index % SPACE_ACCENTS.length],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Seed spaces are given explicit, increasing timestamps so their order is
 * deterministic (most recently created first) instead of depending on how
 * fast `Date.now()` advances between calls.
 */
const SEED_TIMESTAMP = Date.now();
const SEED_SPACES: Space[] = [
  defaultSpace(
    "XAUUSD & MT5 Research",
    "Gold price action, MT5 automation and broker notes.",
    "📈",
    0,
    SEED_TIMESTAMP + 2,
  ),
  defaultSpace(
    "IT Audit & ISO 27001",
    "Controls, policies and evidence.",
    "🛡️",
    1,
    SEED_TIMESTAMP + 1,
  ),
  defaultSpace("General Docs", "Everything else.", "📁", 2, SEED_TIMESTAMP),
];

/* -------------------------------------------------------------------------- */
/* Context shape                                                              */
/* -------------------------------------------------------------------------- */

export interface RetrieveOptions {
  query: string;
  selection: SpaceSelection;
  topK?: number;
  useVectors?: boolean;
}

export interface WorkspaceContextValue {
  /* settings */
  settings: LlmSettings;
  updateSettings: (partial: Partial<LlmSettings>) => void;
  setModelId: (modelId: string) => void;
  addModelId: (modelId: string) => void;
  removeModelId: (modelId: string) => void;
  resetSettings: () => void;

  /* spaces */
  spaces: Space[];
  createSpace: (name: string, description?: string) => Space;
  updateSpace: (id: string, partial: Partial<Space>) => void;
  deleteSpace: (id: string) => void;
  documents: DocumentMeta[];
  deleteDocument: (id: string) => void;
  chunks: DocumentChunk[];
  ingestFiles: (
    files: File[],
    spaceId: string,
    onProgress?: (progress: IngestProgress) => void,
  ) => Promise<DocumentMeta[]>;

  /* chats */
  chats: ChatSession[];
  activeChatId: string | null;
  activeChat: ChatSession | null;
  newChat: () => ChatSession;
  selectChat: (id: string | null) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  saveChat: (session: ChatSession) => void;
  appendMessage: (chatId: string, message: ChatMessage) => void;
  updateMessage: (chatId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  /**
   * Keep `messageId` and everything before it, drop everything after.
   * Used by message edit: editing an earlier question re-answers from there.
   */
  truncateAfterMessage: (chatId: string, messageId: string) => void;

  /* retrieval */
  spaceSelection: SpaceSelection;
  setSpaceSelection: (selection: SpaceSelection) => void;
  retrieve: (options: RetrieveOptions) => Promise<RetrievedChunk[]>;

  /* cross-view hand-off */
  pendingPrompt: string | null;
  setPendingPrompt: (prompt: string | null) => void;

  /* status */
  hydrated: boolean;
  backend: "indexeddb" | "localstorage" | "memory";
  supabaseEnabled: boolean;
  ingestProgress: IngestProgress[];
  clearIngestProgress: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<LlmSettings>(DEFAULT_SETTINGS);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [spaceSelection, setSpaceSelection] = useState<SpaceSelection>({
    kind: "none",
  });
  const [hydrated, setHydrated] = useState(false);
  const [backend, setBackend] = useState<"indexeddb" | "localstorage" | "memory">(
    "memory",
  );
  const [ingestProgress, setIngestProgress] = useState<IngestProgress[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  /* ------------------------------------------------------------------ */
  /* Account                                                            */
  /* ------------------------------------------------------------------ */

  const { status: authStatus, user: authUser } = useAuth();

  /**
   * Hydration is keyed on the signed-in account: every login owns an isolated
   * namespace, so switching accounts (or signing back in after a logout)
   * restores exactly that account's chats, spaces, documents and settings.
   */
  const accountKey = authStatus === "ready" && authUser ? authUser.id : null;
  const isRemoteUser = authUser?.kind === "supabase";

  /**
   * The account whose data is fully live in state. Kept apart from
   * `hydrated` because sign-out sets `hydrated` to true (nothing to load)
   * while in-memory state still belongs to the previous login — a window a
   * stale persistence write could slip through. The gate closes it: state
   * may only be persisted for the account that finished hydrating last,
   * so a re-login can never trash its own restored pointer with leftovers.
   */
  const hydratedAccountRef = useRef<string | null>(null);

  /**
   * BM25 index cache. Rebuilding it over a large Space (tens of thousands of
   * chunks) on every message blocks the UI, so keep one index per scope until
   * the underlying chunk list changes.
   */
  const indexCacheRef = useRef<{
    chunks: DocumentChunk[] | null;
    byScope: Map<string, BuiltIndex>;
  }>({ chunks: null, byScope: new Map() });

  /* ------------------------------------------------------------------ */
  /* Hydration                                                           */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (authStatus !== "ready") return; // wait for the session pointer to resolve
    let cancelled = false;

    if (!accountKey) {
      // Signed out — the login screen shows instead of the workspace. The
      // session-pointer gate closes here so nothing writes while the state
      // still holds the previous account's leftovers.
      hydratedAccountRef.current = null;
      setHydrated(true);
      return;
    }

    (async () => {
      setHydrated(false);

      // Drop the previous account's in-memory state so nothing bleeds over.
      setSettings(DEFAULT_SETTINGS);
      setSpaces([]);
      setDocuments([]);
      setChunks([]);
      setChats([]);
      setActiveChatId(null);
      setSpaceSelection({ kind: "none" });
      setIngestProgress([]);
      indexCacheRef.current = { chunks: null, byScope: new Map() };

      // Swap the persistence layer to this account's namespace first.
      // Guests deliberately stay on the legacy (pre-login) scope — that is
      // what makes "Continue as guest" reuse the browser's original data —
      // while every other login gets an isolated namespace.
      const storageKey = accountKey === "guest" ? "" : accountKey;
      setNamespace(storageKey);
      // Only a signed-in Supabase identity may mirror data to the cloud.
      setRemoteSyncUser(isRemoteUser ? accountKey : null);

      // One-time adoption: accounts created after the login system shipped
      // inherit whatever this browser had before (guest workspace), so
      // signing in with a name does not look like losing your files.
      if (storageKey) {
        try {
          const adopted = await migrateLegacyToNamespace(storageKey);
          if (adopted > 0) {
            console.info(
              `[workspace] adopted ${adopted} legacy record(s) into account scope`,
            );
          }
        } catch {
          /* best effort — hydration continues with whatever the namespace has */
        }
      }

      const [storedSettings, storedSpaces, storedDocuments, storedChunks, storedChats] =
        await Promise.all([
          localStore.settings.get(),
          localStore.spaces.all(),
          localStore.documents.all(),
          localStore.chunks.all(),
          localStore.chats.all(),
        ]);

      if (cancelled) return;

      // Brand + prompt migration (self-healing): the saved system prompt is
      // sent to the model on every request, so a pre-rename copy would make new
      // answers introduce the app as "Amazon Quick" again. Stock prompts saved
      // by older builds are also upgraded so they gain newer rules (e.g. never
      // fabricate download links).
      let migratedSettings = storedSettings;
      if (storedSettings) {
        let prompt = storedSettings.systemPrompt ?? "";
        if (/Amazon Quick/.test(prompt)) {
          prompt = prompt.replace(/Amazon Quick/g, "Sloth");
        }
        if (
          prompt.startsWith(
            "You are Sloth, a precise and discreet AI workspace assistant.",
          ) &&
          !prompt.includes("You cannot create, attach or send files")
        ) {
          prompt = DEFAULT_SYSTEM_PROMPT;
        }
        if (prompt !== (storedSettings.systemPrompt ?? "")) {
          migratedSettings = { ...storedSettings, systemPrompt: prompt };
          void localStore.settings.set(migratedSettings);
        }
      }

      if (migratedSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...migratedSettings });
      }

      let spaceList = storedSpaces;
      if (spaceList.length === 0) {
        spaceList = SEED_SPACES;
        for (const space of SEED_SPACES) {
          await localStore.spaces.put(space);
          void upsertSpace(space);
        }
      }

      let documentList = sortByCreatedDesc(storedDocuments);
      let chunkList = storedChunks;

      // Same rewrite for assistant messages generated before the rename. This
      // runs on every hydration and only persists chats that actually
      // changed, so it is cheap and self-healing.
      let chatList = storedChats;
      try {
        let changed = false;
        chatList = chatList.map((chat) => {
          if (
            !chat.messages.some((message) =>
              message.content.includes("Amazon Quick"),
            )
          ) {
            return chat;
          }
          changed = true;
          return {
            ...chat,
            messages: chat.messages.map((message) =>
              message.content.includes("Amazon Quick")
                ? {
                    ...message,
                    content: message.content.replace(/Amazon Quick/g, "Sloth"),
                  }
                : message,
            ),
          };
        });
        if (changed) {
          for (const chat of chatList) await localStore.chats.put(chat);
        }
      } catch {
        /* migration is best-effort - never block hydration on it */
      }

      // Remember where this account left off: the open chat and Space scope.
      const ui = readUiState(accountKey);

      // Cloud restore: a signed-in Supabase identity pulls its rows back
      // (RLS scopes everything to auth.uid()), which is what makes chats,
      // Spaces and documents survive a logout on another browser or device.
      if (isRemoteUser) {
        try {
          const [remoteSpaces, remoteDocs, remoteChunks, remoteChats] =
            await Promise.all([
              fetchSpaces(),
              fetchDocuments(),
              fetchChunks(),
              fetchChats(),
            ]);

          if (remoteSpaces && remoteSpaces.length > 0) {
            const known = new Set(spaceList.map((space) => space.id));
            for (const space of remoteSpaces) {
              void localStore.spaces.put(space);
              if (!known.has(space.id)) spaceList = [...spaceList, space];
            }
            spaceList = sortByUpdated(spaceList);
          }

          if (remoteDocs && remoteDocs.length > 0) {
            const known = new Set(documentList.map((doc) => doc.id));
            for (const doc of remoteDocs) {
              void localStore.documents.put(doc);
              if (!known.has(doc.id)) documentList = [doc, ...documentList];
            }
          }

          if (remoteChunks && remoteChunks.length > 0) {
            const known = new Set(chunkList.map((chunk) => chunk.id));
            const missing = remoteChunks.filter(
              (chunk) => !known.has(chunk.id),
            );
            if (missing.length > 0) {
              await localStore.chunks.putMany(missing);
              chunkList = [...chunkList, ...missing];
            }
          }

          if (remoteChats && remoteChats.length > 0) {
            const map = new Map(chatList.map((chat) => [chat.id, chat]));
            for (const remote of remoteChats) {
              void localStore.chats.put(remote);
              const localChat = map.get(remote.id);
              if (!localChat || remote.updatedAt > localChat.updatedAt) {
                map.set(remote.id, remote);
              }
            }
            chatList = [...map.values()];
          }
        } catch (error) {
          console.warn("[workspace] cloud restore skipped:", error);
        }
      }

      if (cancelled) return;
      setSpaces(sortByUpdated(spaceList));
      setDocuments(sortByCreatedDesc(documentList));
      setChunks(chunkList);
      setChats(sortChats(chatList));

      const rememberedSelection = ui.spaceSelection;
      if (
        rememberedSelection &&
        (rememberedSelection.kind !== "space" ||
          spaceList.some(
            (space) => space.id === rememberedSelection.spaceId,
          ))
      ) {
        setSpaceSelection(rememberedSelection);
      }

      // Reopen the chat this login was working in — restoring the pointer
      // makes a reload or re-login look exactly like it never happened.
      if (ui.activeChatId && chatList.some((chat) => chat.id === ui.activeChatId)) {
        setActiveChatId(ui.activeChatId);
      }

      const activeBackend = await storageBackend();
      if (!cancelled) setBackend(activeBackend);

      if (!cancelled) {
        // Only now is this account's data live in state — open the
        // persistence gate (the write guard) for exactly this account.
        hydratedAccountRef.current = accountKey;
        setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, accountKey, isRemoteUser]);

  /* Persist the working session for this account (chat + scope). ---------- */
  useEffect(() => {
    // The gate (hydratedAccountRef) closes during sign-out and between the
    // sign-in commit and the new account's finished hydration: without it, a
    // commit that flips accountKey would persist the PREVIOUS login's
    // in-memory leftovers and overwrite this account's restored pointer.
    if (
      !accountKey ||
      !hydrated ||
      hydratedAccountRef.current !== accountKey
    ) {
      return;
    }
    writeUiState(accountKey, { activeChatId, spaceSelection });
  }, [accountKey, hydrated, activeChatId, spaceSelection]);

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  const updateSettings = useCallback((partial: Partial<LlmSettings>) => {
    // Fresh credentials may restore an embedding endpoint the app previously
    // gave up on - re-arm vector mode before the next attempt.
    if ("apiKey" in partial || "baseUrl" in partial) {
      resetEmbeddingCapability();
    }
    setSettings((current) => {
      const next: LlmSettings = {
        ...current,
        ...partial,
        baseUrl: partial.baseUrl
          ? normaliseBaseUrl(partial.baseUrl)
          : current.baseUrl,
      };
      void localStore.settings.set(next);
      // The API key is mirrored to localStorage so it survives IndexedDB clears.
      // It is namespaced like every other per-account record.
      try {
        localStorage.setItem(
          `aqw:${getNamespace()}llm-api-key`,
          JSON.stringify({ value: next.apiKey, at: Date.now() }),
        );
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const setModelId = useCallback(
    (modelId: string) => {
      const trimmed = modelId.trim();
      if (!trimmed) return;
      updateSettings({
        modelId: trimmed,
        savedModelIds: settings.savedModelIds.includes(trimmed)
          ? settings.savedModelIds
          : [trimmed, ...settings.savedModelIds].slice(0, 24),
      });
    },
    [settings.savedModelIds, updateSettings],
  );

  const addModelId = useCallback(
    (modelId: string) => {
      const trimmed = modelId.trim();
      if (!trimmed) return;
      updateSettings({
        savedModelIds: settings.savedModelIds.includes(trimmed)
          ? settings.savedModelIds
          : [trimmed, ...settings.savedModelIds].slice(0, 24),
      });
    },
    [settings.savedModelIds, updateSettings],
  );

  const removeModelId = useCallback(
    (modelId: string) => {
      const next = settings.savedModelIds.filter((id) => id !== modelId);
      updateSettings({
        savedModelIds: next,
        modelId: settings.modelId === modelId ? next[0] ?? "" : settings.modelId,
      });
    },
    [settings.modelId, settings.savedModelIds, updateSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    void localStore.settings.set(DEFAULT_SETTINGS);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Spaces                                                              */
  /* ------------------------------------------------------------------ */

  const createSpace = useCallback(
    (name: string, description = "") => {
      const trimmed = name.trim() || "Untitled Space";
      const now = Date.now();
      const space: Space = {
        id: uid("space"),
        name: trimmed,
        description,
        emoji: "🗂️",
        color: SPACE_ACCENTS[spaces.length % SPACE_ACCENTS.length],
        createdAt: now,
        updatedAt: now,
      };
      setSpaces((current) => [space, ...current]);
      void localStore.spaces.put(space);
      void upsertSpace(space);
      return space;
    },
    [spaces.length],
  );

  const updateSpace = useCallback((id: string, partial: Partial<Space>) => {
    setSpaces((current) =>
      current.map((space) => {
        if (space.id !== id) return space;
        const next = { ...space, ...partial, updatedAt: Date.now() };
        void localStore.spaces.put(next);
        void upsertSpace(next);
        return next;
      }),
    );
  }, []);

  const deleteSpace = useCallback((id: string) => {
    setSpaces((current) => current.filter((space) => space.id !== id));
    setDocuments((current) => {
      const removed = current.filter((doc) => doc.spaceId === id);
      for (const doc of removed) {
        void localStore.documents.remove(doc.id);
        void deleteDocumentRemote(doc.id);
      }
      return current.filter((doc) => doc.spaceId !== id);
    });
    setChunks((current) => {
      const removed = current.filter((chunk) => chunk.spaceId === id);
      for (const chunk of removed) void localStore.chunks.remove(chunk.id);
      return current.filter((chunk) => chunk.spaceId !== id);
    });
    void localStore.spaces.remove(id);
    void deleteSpaceRemote(id);
  }, []);

  const deleteDocument = useCallback((id: string) => {
    setDocuments((current) => current.filter((doc) => doc.id !== id));
    setChunks((current) => {
      const removed = current.filter((chunk) => chunk.documentId === id);
      for (const chunk of removed) void localStore.chunks.remove(chunk.id);
      return current.filter((chunk) => chunk.documentId !== id);
    });
    void localStore.documents.remove(id);
    void deleteDocumentRemote(id);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Ingestion                                                           */
  /* ------------------------------------------------------------------ */

  const ingestFiles = useCallback(
    async (
      files: File[],
      spaceId: string,
      onProgress?: (progress: IngestProgress) => void,
    ): Promise<DocumentMeta[]> => {
      const created: DocumentMeta[] = [];

      for (const file of files) {
        const report = (progress: IngestProgress) => {
          setIngestProgress((current) => [
            ...current.filter((entry) => entry.fileName !== progress.fileName),
            progress,
          ]);
          onProgress?.(progress);
        };

        report({
          fileName: file.name,
          stage: "extracting",
          percent: 0.1,
          message: "Extracting text…",
        });

        try {
          const parsed = await parseFile(file);
          const documentId = uid("doc");
          const rawChunks = chunkText(parsed.text);

          report({
            fileName: file.name,
            stage: "chunking",
            percent: 0.55,
            message: `Chunking into ${rawChunks.length} segments…`,
          });

          const documentChunks: DocumentChunk[] = rawChunks.map((chunk) => ({
            id: `${documentId}_c${chunk.index}`,
            documentId,
            spaceId,
            index: chunk.index,
            content: chunk.content,
            start: chunk.start,
            end: chunk.end,
          }));

          const meta: DocumentMeta = {
            id: documentId,
            spaceId,
            name: parsed.fileName,
            fileName: parsed.fileName,
            mimeType: parsed.mimeType,
            size: parsed.size,
            chunkCount: documentChunks.length,
            charCount: parsed.text.length,
            createdAt: Date.now(),
            embedded: false,
          };

          report({
            fileName: file.name,
            stage: "indexing",
            percent: 0.8,
            message: `Indexing to Space…`,
            documentId,
          });

          // Mode 2: attach embeddings when the gateway exposes /embeddings.
          // embedTexts batches the work internally and reports per-batch
          // progress so big files show a live counter instead of one long wait.
          const embeddingResult = await embedTexts(
            documentChunks.map((chunk) => chunk.content),
            { baseUrl: settings.baseUrl, apiKey: settings.apiKey },
            undefined,
            {
              onProgress: ({ done, total }) => {
                report({
                  fileName: file.name,
                  stage: "indexing",
                  percent: 0.55 + 0.4 * (done / total),
                  message: `Embedding ${done}/${total} chunks…`,
                  documentId,
                });
              },
            },
          );
          if (embeddingResult) {
            embeddingResult.embeddings.forEach((vector, index) => {
              const chunk = documentChunks[index];
              if (chunk) {
                chunk.embedding = vector;
                chunk.embeddingModel = embeddingResult.modelId;
              }
            });
            meta.embedded = true;
          }

          await localStore.documents.put(meta);
          await localStore.chunks.putMany(documentChunks);
          void upsertDocument(meta, parsed.text);
          void upsertChunks(documentChunks);
          void uploadFileToBlob(spaceId, file);

          setDocuments((current) => [meta, ...current]);
          setChunks((current) => [...current, ...documentChunks]);
          created.push(meta);

          report({
            fileName: file.name,
            stage: "done",
            percent: 1,
            message: `Indexed ${documentChunks.length} chunk${
              documentChunks.length === 1 ? "" : "s"
            }`,
            documentId,
          });
        } catch (error) {
          report({
            fileName: file.name,
            stage: "error",
            percent: 1,
            message: "Could not index this file",
            error:
              error instanceof Error ? error.message : "Unknown parsing error",
          });
        }
      }

      return created;
    },
    [settings.baseUrl, settings.apiKey],
  );

  const clearIngestProgress = useCallback(() => setIngestProgress([]), []);

  /* ------------------------------------------------------------------ */
  /* Chats                                                               */
  /* ------------------------------------------------------------------ */

  const newChat = useCallback((): ChatSession => {
    const now = Date.now();
    const session: ChatSession = {
      id: uid("chat"),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
      spaceSelection,
      modelId: settings.modelId,
    };
    setChats((current) => [session, ...current]);
    void localStore.chats.put(session);
    void upsertChat(session);
    setActiveChatId(session.id);
    return session;
  }, [settings.modelId, spaceSelection]);

  const selectChat = useCallback((id: string | null) => {
    setActiveChatId(id);
  }, []);

  const renameChat = useCallback((id: string, title: string) => {
    setChats((current) =>
      current.map((chat) => {
        if (chat.id !== id) return chat;
        const next = { ...chat, title, updatedAt: Date.now() };
        void localStore.chats.put(next);
        void upsertChat(next);
        return next;
      }),
    );
  }, []);

  const deleteChat = useCallback((id: string) => {
    setChats((current) => current.filter((chat) => chat.id !== id));
    void localStore.chats.remove(id);
    void deleteChatRemote(id);
    setActiveChatId((current) => (current === id ? null : current));
  }, []);

  const saveChat = useCallback((session: ChatSession) => {
    setChats((current) => {
      const exists = current.some((chat) => chat.id === session.id);
      const next = exists
        ? current.map((chat) => (chat.id === session.id ? session : chat))
        : [session, ...current];
      void localStore.chats.put(session);
      void upsertChat(session);
      return next;
    });
  }, []);

  const appendMessage = useCallback(
    (chatId: string, message: ChatMessage) => {
      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const messages = [...chat.messages, message];
          const next: ChatSession = {
            ...chat,
            messages,
            title:
              chat.title === "New chat" && message.role === "user"
                ? titleFromMessage(message.content)
                : chat.title,
            updatedAt: Date.now(),
          };
          void localStore.chats.put(next);
          void upsertChat(next);
          return next;
        }),
      );
    },
    [],
  );

  const updateMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const messages = chat.messages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message,
          );
          const next = { ...chat, messages, updatedAt: Date.now() };
          void localStore.chats.put(next);
          void upsertChat(next);
          return next;
        }),
      );
    },
    [],
  );

  const truncateAfterMessage = useCallback(
    (chatId: string, messageId: string) => {
      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== chatId) return chat;
          const index = chat.messages.findIndex((message) => message.id === messageId);
          if (index < 0) return chat;
          const next: ChatSession = {
            ...chat,
            messages: chat.messages.slice(0, index + 1),
            updatedAt: Date.now(),
          };
          void localStore.chats.put(next);
          void upsertChat(next);
          return next;
        }),
      );
    },
    [],
  );

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  /* ------------------------------------------------------------------ */
  /* Retrieval                                                           */
  /* ------------------------------------------------------------------ */

  const retrieve = useCallback(
    async (options: RetrieveOptions): Promise<RetrievedChunk[]> => {
      const { query, selection, topK = settings.topK } = options;
      if (!query.trim() || selection.kind === "none") return [];

      const scope =
        selection.kind === "all"
          ? spaces.map((space) => space.id)
          : [selection.spaceId];
      const scopedChunks = chunks.filter((chunk) => scope.includes(chunk.spaceId));
      if (scopedChunks.length === 0) return [];

      // Reuse the per-scope BM25 index until the chunk list itself changes.
      const cache = indexCacheRef.current;
      if (cache.chunks !== chunks) {
        indexCacheRef.current = { chunks, byScope: new Map() };
      }
      const scopeKey = selection.kind === "all" ? "__all__" : selection.spaceId;
      let index = indexCacheRef.current.byScope.get(scopeKey);
      if (!index) {
        index = buildIndex(scopedChunks);
        indexCacheRef.current.byScope.set(scopeKey, index);
      }

      const lexical = searchLexicalWithIndex(index, query, { topK });

      let vectorHits: { chunk: DocumentChunk; score: number }[] = [];
      // Spaces ingested without a working embedding endpoint store no vectors.
      // Calling the gateway anyway costs time and credits for a search that
      // cannot match anything, so only embed when there is something to compare.
      const hasVectors = scopedChunks.some(
        (chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0,
      );
      if (options.useVectors && hasVectors) {
        const result = await embedTexts([query], {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
        });
        if (result) {
          vectorHits = searchVectors(scopedChunks, result.embeddings[0], topK);
        }
      }

      let merged = mergeHits(lexical, vectorHits, topK);
      if (merged.length === 0) merged = headHits(scopedChunks, topK);

      return merged.map((hit) => {
        const document = documents.find((doc) => doc.id === hit.chunk.documentId);
        const space = spaces.find((item) => item.id === hit.chunk.spaceId);
        return {
          chunkId: hit.chunk.id,
          documentId: hit.chunk.documentId,
          documentName: document?.fileName ?? "document",
          spaceId: hit.chunk.spaceId,
          spaceName: space?.name ?? "Space",
          content: hit.chunk.content,
          score: hit.score,
          strategy: hit.strategy,
        };
      });
    },
    [chunks, documents, settings.baseUrl, settings.apiKey, settings.topK, spaces],
  );

  /* ------------------------------------------------------------------ */
  /* Value                                                               */
  /* ------------------------------------------------------------------ */

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      settings,
      updateSettings,
      setModelId,
      addModelId,
      removeModelId,
      resetSettings,
      spaces,
      createSpace,
      updateSpace,
      deleteSpace,
      documents,
      deleteDocument,
      chunks,
      ingestFiles,
      chats,
      activeChatId,
      activeChat,
      newChat,
      selectChat,
      renameChat,
      deleteChat,
      saveChat,
      appendMessage,
      updateMessage,
      truncateAfterMessage,
      spaceSelection,
      setSpaceSelection,
      retrieve,
      pendingPrompt,
      setPendingPrompt,
      hydrated,
      backend,
      supabaseEnabled: isSupabaseConfigured && Boolean(getSupabase()),
      ingestProgress,
      clearIngestProgress,
    }),
    [
      settings,
      updateSettings,
      setModelId,
      addModelId,
      removeModelId,
      resetSettings,
      spaces,
      createSpace,
      updateSpace,
      deleteSpace,
      documents,
      deleteDocument,
      chunks,
      ingestFiles,
      chats,
      activeChatId,
      activeChat,
      newChat,
      selectChat,
      renameChat,
      deleteChat,
      saveChat,
      appendMessage,
      updateMessage,
      truncateAfterMessage,
      spaceSelection,
      retrieve,
      pendingPrompt,
      setPendingPrompt,
      hydrated,
      backend,
      ingestProgress,
      clearIngestProgress,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sortByUpdated(spaces: Space[]): Space[] {
  return [...spaces].sort(
    (a, b) =>
      b.updatedAt - a.updatedAt ||
      a.createdAt - b.createdAt ||
      a.name.localeCompare(b.name),
  );
}

function sortByCreatedDesc(docs: DocumentMeta[]): DocumentMeta[] {
  return [...docs].sort((a, b) => b.createdAt - a.createdAt);
}

function sortChats(chats: ChatSession[]): ChatSession[] {
  return [...chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/** Merges lexical + vector hits using reciprocal rank fusion. */
type RankedHit = {
  chunk: DocumentChunk;
  score: number;
  strategy: "bm25" | "vector" | "hybrid" | "head";
};

function mergeHits(
  lexical: { chunk: DocumentChunk; score: number }[],
  vector: { chunk: DocumentChunk; score: number }[],
  topK: number,
): RankedHit[] {
  const rank = new Map<
    string,
    { chunk: DocumentChunk; score: number; strategy: "bm25" | "vector" | "hybrid"; lexical?: number; vector?: number }
  >();

  lexical.forEach((hit, index) => {
    rank.set(hit.chunk.id, {
      chunk: hit.chunk,
      score: 1 / (60 + index + 1),
      strategy: "bm25",
      lexical: hit.score,
    });
  });

  vector.forEach((hit, index) => {
    const existing = rank.get(hit.chunk.id);
    if (existing) {
      existing.score += 1 / (60 + index + 1);
      existing.strategy = "hybrid";
      existing.vector = hit.score;
    } else {
      rank.set(hit.chunk.id, {
        chunk: hit.chunk,
        score: 1 / (60 + index + 1),
        strategy: "vector",
        vector: hit.score,
      });
    }
  });

  const entries = [...rank.values()].sort((a, b) => b.score - a.score);
  const max = entries[0]?.score ?? 1;

  return entries.slice(0, topK).map((entry) => ({
    chunk: entry.chunk,
    score: Math.min(1, entry.score / max),
    strategy: entry.strategy,
  }));
}

/**
 * Fallback ranking when no lexical or vector hit matched at all — commonly a
 * Thai-only question about English content, or "summarise this file". Returns
 * the opening chunk of each in-scope document so the model can still ground
 * its answer in real content instead of only knowing the file names.
 */
function headHits(chunks: DocumentChunk[], topK: number): RankedHit[] {
  const seen = new Set<string>();
  const heads: DocumentChunk[] = [];
  for (const chunk of [...chunks].sort((a, b) =>
    a.documentId === b.documentId ? a.index - b.index : a.documentId < b.documentId ? -1 : 1,
  )) {
    if (seen.has(chunk.documentId)) continue;
    seen.add(chunk.documentId);
    heads.push(chunk);
    if (heads.length >= topK) break;
  }
  return heads.map((chunk) => ({ chunk, score: 0, strategy: "head" as const }));
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  }
  return context;
}
