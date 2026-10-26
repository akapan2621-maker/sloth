"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FloatingPromptBox from "@/components/FloatingPromptBox";
import MessageBubble from "@/components/MessageBubble";
import RecommendationsGrid from "@/components/RecommendationsGrid";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  DirectTransportUnavailable,
  streamDirect,
  streamViaServer,
  type ChatRequestMessage,
  type RagChunkPayload,
} from "@/lib/chatClient";
import type { ChatMessage, DocumentMeta, StarterPrompt } from "@/lib/types";
import { formatBytes, uid } from "@/lib/utils";

/** Abort a response that has produced no bytes for this long. */
const STREAM_STALL_MS = 60_000;

function stallMessage(): string {
  return `โมเดลไม่ตอบสนองภายใน ${Math.round(
    STREAM_STALL_MS / 1000,
  )} วินาที — หยุดคำขอแล้ว ลองส่งอีกครั้ง หรือเปลี่ยนโมเดลในการตั้งค่า`;
}

/**
 * A compact inventory of the in-scope files, sent alongside the retrieved
 * excerpts. It lets the assistant name and describe files ("what documents are
 * in this Space?") even when no chunk matches the query lexically - which is
 * always the case for numeric datasets and for languages the keyword index
 * cannot bridge.
 */
function buildInventoryChunk(
  docs: DocumentMeta[],
  spaceName: string,
): RagChunkPayload | null {
  if (docs.length === 0) return null;
  const lines = docs.map((doc) => {
    const indexed = doc.embedded ? "vector-indexed" : "keyword-indexed";
    const date = new Date(doc.createdAt).toISOString().slice(0, 10);
    return `- ${doc.fileName} — ${doc.chunkCount} chunks, ${formatBytes(
      doc.size,
    )}, uploaded ${date}, ${indexed}`;
  });
  return {
    documentName: "Space inventory",
    spaceName,
    score: 0,
    content: [
      "Inventory of the files currently in scope (metadata only, not a document excerpt).",
      "Use it to name, list or describe files; never cite it as a source.",
      ...lines,
    ].join("\n"),
  };
}

export function ChatView() {
  const {
    settings,
    activeChat,
    newChat,
    appendMessage,
    updateMessage,
    spaceSelection,
    setSpaceSelection,
    retrieve,
    ingestFiles,
    spaces,
    documents,
    pendingPrompt,
    setPendingPrompt,
  } = useWorkspace();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [quickMode, setQuickMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef("");
  const messagesRef = useRef<ChatMessage[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  messagesRef.current = activeChat?.messages ?? [];
  chatIdRef.current = activeChat?.id ?? null;

  const messages = useMemo(() => activeChat?.messages ?? [], [activeChat]);
  const hasMessages = messages.length > 0;

  /* Auto-scroll ------------------------------------------------------ */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText]);

  /* Stop on unmount --------------------------------------------------- */
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  /* Hand-off from Agents / Apps / Research views ----------------------- */
  useEffect(() => {
    if (!pendingPrompt) return;
    setInput(pendingPrompt);
    setPendingPrompt(null);
  }, [pendingPrompt, setPendingPrompt]);

  /* Submit ------------------------------------------------------------ */
  const submit = useCallback(
    async (
      rawText?: string,
      retryOf?: { userId: string; assistantId: string },
    ) => {
      const text = (rawText ?? input).trim();
      if (!text || streaming) return;

      setError(null);
      setInput("");

      let chatId = chatIdRef.current;
      if (!chatId) {
        chatId = newChat().id;
        chatIdRef.current = chatId;
      }

      // A retry replaces an interrupted assistant turn in place: it reuses the
      // previous user question instead of appending a duplicate bubble.
      const retryIds = retryOf ?? null;
      const retryWorks =
        retryIds !== null &&
        messagesRef.current.some((message) => message.id === retryIds.userId);

      let history: ChatRequestMessage[];
      if (retryWorks && retryIds) {
        history = messagesRef.current
          .slice(
            0,
            messagesRef.current.findIndex((m) => m.id === retryIds.userId) + 1,
          )
          .map((message) => ({
            id: message.id,
            role:
              message.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            content: message.content,
          }));
      } else {
        const userMessage: ChatMessage = {
          id: uid("msg"),
          role: "user",
          content: text,
          createdAt: Date.now(),
        };
        appendMessage(chatId, userMessage);

        history = [
          ...messagesRef.current.map((message) => ({
            id: message.id,
            role:
              message.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            content: message.content,
          })),
          { id: userMessage.id, role: "user", content: text },
        ];
      }

      // Retrieval against the selected Space(s).
      const sources = await retrieve({
        query: text,
        selection: spaceSelection,
        topK: settings.topK,
        useVectors: true,
      });

      let assistantId: string;
      if (retryWorks && retryIds) {
        // Reset the existing (interrupted) assistant bubble in place.
        assistantId = retryIds.assistantId;
        updateMessage(chatId, assistantId, {
          content: "",
          sources,
          modelId: settings.modelId,
          error: false,
        });
      } else {
        assistantId = uid("msg");
        appendMessage(chatId, {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          sources,
          modelId: settings.modelId,
        });
      }

      streamingTextRef.current = "";
      setStreamingText("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Watchdog: gateways sometimes accept a request and then go silent. Abort
      // after a period without any bytes so the chat surfaces an error instead
      // of showing a spinner forever (a stalled request once ran for 9 minutes).
      let stalled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          stalled = true;
          controller.abort();
        }, STREAM_STALL_MS);
      };
      armWatchdog();

      // Keep any text that already streamed in, then explain why it stopped.
      const finishAsStalled = () => {
        const message = stallMessage();
        const partial = streamingTextRef.current;
        setError(message);
        updateMessage(chatId, assistantId, {
          content: partial ? `${partial}\n\n---\n\n_${message}_` : message,
          error: true,
        });
      };

      const ragChunks: RagChunkPayload[] = sources.map((source) => ({
        documentName: source.documentName,
        spaceName: source.spaceName,
        content: source.content,
        score: source.score,
      }));

      // Attach the file inventory so the model knows what exists in scope
      // even when retrieval found nothing (numeric data, other languages…).
      const scopeIds =
        spaceSelection.kind === "all"
          ? spaces.map((space) => space.id)
          : spaceSelection.kind === "space"
            ? [spaceSelection.spaceId]
            : [];
      const scopeName =
        spaceSelection.kind === "all"
          ? "All Spaces"
          : spaceSelection.kind === "space"
            ? (spaces.find(
                (space) => space.id === spaceSelection.spaceId,
              )?.name ?? "Space")
            : "Space";
      const inventoryChunk = buildInventoryChunk(
        documents.filter((doc) => scopeIds.includes(doc.spaceId)),
        scopeName,
      );
      if (inventoryChunk) ragChunks.push(inventoryChunk);

      const params = {
        messages: history,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        modelId: settings.modelId,
        temperature: settings.temperature,
        systemPrompt: settings.systemPrompt,
        ragContextChunks: ragChunks,
        signal: controller.signal,
        onDelta: (delta: string) => {
          streamingTextRef.current += delta;
          setStreamingText(streamingTextRef.current);
          armWatchdog();
        },
      };

      try {
        if (settings.privateMode && settings.apiKey) {
          try {
            await streamDirect(params);
          } catch (error) {
            if (error instanceof DirectTransportUnavailable) {
              await streamViaServer(params);
            } else {
              throw error;
            }
          }
        } else {
          await streamViaServer(params);
        }

        // The transports swallow AbortError so a manual "stop" is not an error.
        // A watchdog abort must still be surfaced, otherwise the turn ends with
        // an empty bubble and no explanation.
        if (stalled) {
          finishAsStalled();
        } else {
          updateMessage(chatId, assistantId, {
            content: streamingTextRef.current,
          });
        }
      } catch (streamError) {
        if (
          streamError instanceof DOMException &&
          streamError.name === "AbortError"
        ) {
          if (stalled) {
            finishAsStalled();
          } else {
            updateMessage(chatId, assistantId, {
              content: streamingTextRef.current || "Generation stopped.",
            });
          }
        } else {
          const message =
            streamError instanceof Error
              ? streamError.message
              : "The request failed unexpectedly.";
          setError(message);
          updateMessage(chatId, assistantId, {
            content: message,
            error: true,
          });
        }
      } finally {
        if (watchdog) clearTimeout(watchdog);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      appendMessage,
      documents,
      input,
      newChat,
      retrieve,
      settings.apiKey,
      settings.baseUrl,
      settings.modelId,
      settings.privateMode,
      settings.systemPrompt,
      settings.temperature,
      settings.topK,
      spaceSelection,
      spaces,
      streaming,
      updateMessage,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* Upload from the prompt box ---------------------------------------- */
  const handleUpload = useCallback(
    async (files: File[]) => {
      const target =
        spaceSelection.kind === "space"
          ? spaceSelection.spaceId
          : spaceSelection.kind === "all"
            ? spaces[0]?.id
            : undefined;
      if (!target) {
        setError("Select a Space before uploading a document.");
        return;
      }
      await ingestFiles(files, target);
    },
    [ingestFiles, spaceSelection, spaces],
  );

  const handleQuickMode = useCallback((mode: string | null, prompt: string) => {
    setQuickMode(mode);
    if (mode) setInput(prompt);
  }, []);

  const handleStarter = useCallback(
    (prompt: StarterPrompt) => {
      setInput(prompt.prompt);
      requestAnimationFrame(() => submit(prompt.prompt));
    },
    [submit],
  );

  const reset = useCallback(() => {
    setInput("");
    setQuickMode(null);
    setError(null);
    streamingTextRef.current = "";
    setStreamingText("");
  }, []);

  const copyAnswer = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text);
  }, []);

  /**
   * While a response streams, the assistant placeholder that already lives in
   * the chat history is rendered with the live text. This keeps a single
   * bubble on screen instead of rendering the turn twice.
   */
  const renderMessages = useMemo(() => {
    if (!streaming || messages.length === 0) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return messages;
    return [...messages.slice(0, -1), { ...last, content: streamingText }];
  }, [messages, streaming, streamingText]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread -------------------------------------------------------- */}
      <div
        ref={scrollRef}
        className="scrollbar-slim min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
          {!hasMessages ? (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center pb-8 pt-16 text-center"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-lift">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M12 2.5c.5 3.4 1.6 5.2 4.4 6.4-2.8 1.2-3.9 3-4.4 6.4-.5-3.4-1.6-5.2-4.4-6.4 2.8-1.2 3.9-3 4.4-6.4Zm6.6 7.4c.28 1.9.9 2.9 2.4 3.6-1.5.7-2.1 1.7-2.4 3.6-.3-1.9-.9-2.9-2.4-3.6 1.5-.7 2.1-1.7 2.4-3.6ZM5.4 9.9c.28 1.9.9 2.9 2.4 3.6-1.5.7-2.1 1.7-2.4 3.6-.3-1.9-.9-2.9-2.4-3.6 1.5-.7 2.1-1.7 2.4-3.6Z" />
                </svg>
              </span>
              <h1 className="mt-6 text-3xl font-light tracking-tight text-slate-800">
                Ready when you are, Akapan.
              </h1>
              <p className="mt-2 max-w-md text-[13.5px] leading-6 text-slate-500">
                Ask anything, or ground your answer in a Space by picking a
                knowledge base above the prompt.
              </p>
            </motion.div>
          ) : null}

          <div className="space-y-7">
            {renderMessages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                streaming={streaming && index === renderMessages.length - 1}
                onCopy={copyAnswer}
                onRetry={
                  message.role === "assistant" &&
                  !message.content &&
                  !message.error &&
                  !streaming
                    ? () => {
                        const index = messages.findIndex(
                          (item) => item.id === message.id,
                        );
                        const previousUser = index > 0 ? messages[index - 1] : null;
                        if (previousUser?.role === "user") {
                          void submit(previousUser.content, {
                            userId: previousUser.id,
                            assistantId: message.id,
                          });
                        }
                      }
                    : undefined
                }
                onRegenerate={
                  message.role === "assistant"
                    ? () => {
                        const previousUser = [...messages]
                          .reverse()
                          .find((item) => item.role === "user");
                        if (previousUser) void submit(previousUser.content);
                      }
                    : undefined
                }
              />
            ))}
          </div>

          {/* Recommendations ---------------------------------------- */}
          <div className="mt-10">
            <RecommendationsGrid
              visible={!hasMessages && !streaming}
              onSelect={handleStarter}
            />
          </div>
        </div>
      </div>

      {/* Prompt box --------------------------------------------------- */}
      <div className="shrink-0 border-t border-slate-200/70 bg-alabaster/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8">
          {error ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-800">
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 rounded px-1.5 py-0.5 text-rose-500 transition hover:bg-rose-100"
              >
                ✕
              </button>
            </div>
          ) : null}

          <FloatingPromptBox
            value={input}
            onChange={setInput}
            onSubmit={() => void submit()}
            onStop={stop}
            streaming={streaming}
            spaceSelection={spaceSelection}
            onSpaceSelectionChange={setSpaceSelection}
            onUploadFiles={(files) => void handleUpload(files)}
            quickMode={quickMode}
            onQuickModeChange={handleQuickMode}
            onReset={reset}
          />
        </div>
      </div>
    </div>
  );
}

export default ChatView;
