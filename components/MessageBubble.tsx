"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  RefreshCcw,
  Send,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import Markdown from "@/components/Markdown";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatMessage;
  onRegenerate?: () => void;
  /** Retry without duplicating the user turn (used for interrupted answers). */
  onRetry?: () => void;
  /**
   * Edit a user turn: `resend` drops the later turns and answers again,
   * otherwise the text is saved in place only.
   */
  onEdit?: (messageId: string, text: string, resend: boolean) => void;
  /** True while this bubble is the live streaming target. */
  streaming?: boolean;
}

export function MessageBubble({
  message,
  onRegenerate,
  onRetry,
  onEdit,
  streaming,
}: MessageBubbleProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";

  const copyMessage = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
    // Focus after the textarea mounts.
    window.setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    }, 0);
  };

  const finishEdit = (resend: boolean) => {
    const text = draft.trim();
    if (!text) return;
    onEdit?.(message.id, text, resend);
    setEditing(false);
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn("group flex w-full gap-3", isUser && "justify-end")}
    >
      {!isUser ? (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
          <SparkIcon />
        </span>
      ) : null}

      <div
        className={cn(
          "min-w-0 max-w-[min(760px,92%)]",
          isUser && "flex flex-col items-end",
        )}
      >
        {isUser ? (
          editing ? (
            /* Edit mode: rewrite the question, resend or just save. --- */
            <div className="w-full rounded-2xl border border-purple-300 bg-white p-3 shadow-lift">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    finishEdit(true);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                  }
                }}
                rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[14px] leading-6 text-slate-800 outline-none transition focus:border-purple-400 focus:bg-white focus:ring-4 focus:ring-purple-100"
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-[10.5px] text-slate-400">
                  Enter = ส่งใหม่ · Shift+Enter = ขึ้นบรรทัด · Esc = ยกเลิก
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <X className="h-3 w-3" />
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => finishEdit(false)}
                  disabled={!draft.trim()}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  บันทึกข้อความ
                </button>
                <button
                  type="button"
                  onClick={() => finishEdit(true)}
                  disabled={!draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-soft transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-3 w-3" />
                  ส่งใหม่
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl rounded-tr-sm border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="whitespace-pre-wrap text-[14.5px] leading-6 text-slate-800">
                  {message.content}
                </p>
              </div>
              {/* Hover actions: copy the question, or edit it. -------- */}
              <div className="mt-1.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => copyMessage(message.content)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Copy message"
                  title="คัดลอกข้อความ"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                {onEdit ? (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-purple-700"
                    aria-label="Edit message"
                    title="แก้ไขข้อความแล้วส่งใหม่"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </>
          )
        ) : (
          <div className="w-full">
            {message.content ? (
              <Markdown className="prose-luxury">{message.content}</Markdown>
            ) : message.error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
                {message.content || "The request failed."}
              </p>
            ) : streaming ? (
              <ThinkingDots />
            ) : (
              // An empty assistant turn that is no longer streaming was cut off
              // (page reload, tab closed, gateway stall). Show a notice instead
              // of an endless "thinking" animation.
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                <p>
                  การตอบกลับถูกขัดจังหวะก่อนที่จะมีข้อความ — อาจเกิดจากเครือข่ายหลุด
                  หรือโหลดหน้าใหม่ระหว่างรอคำตอบ
                </p>
                {onRetry ?? onRegenerate ? (
                  <button
                    type="button"
                    onClick={onRetry ?? onRegenerate}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] font-medium text-amber-800 transition hover:bg-amber-100"
                  >
                    <RefreshCcw className="h-3 w-3" />
                    ลองอีกครั้ง
                  </button>
                ) : null}
              </div>
            )}

            {/* Actions ------------------------------------------------ */}
            {!message.error && message.content ? (
              <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => copyMessage(message.content)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Copy answer"
                  title="คัดลอกข้อความ"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                {onRegenerate ? (
                  <button
                    type="button"
                    onClick={onRegenerate}
                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Regenerate answer"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {message.modelId ? (
                  <span className="ml-1 font-mono text-[10.5px] text-slate-400">
                    {message.modelId}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* Sources drawer ----------------------------------------- */}
            {message.sources && message.sources.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setSourcesOpen((value) => !value)}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-slate-50"
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                  <span className="text-[12.5px] font-medium text-slate-700">
                    📚 Sources Used from Space
                  </span>
                  <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-purple-700">
                    {message.sources.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-3.5 w-3.5 text-slate-400 transition-transform",
                      sourcesOpen && "rotate-180",
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {sourcesOpen ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <ul className="divide-y divide-slate-100 border-t border-slate-100">
                        {message.sources.map((source, index) => (
                          <li key={source.chunkId} className="px-3.5 py-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-purple-50 text-[10px] font-bold text-purple-700">
                                {index + 1}
                              </span>
                              <span className="truncate text-[12.5px] font-semibold text-slate-800">
                                {source.documentName}
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">
                                {source.spaceName}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-slate-400">
                                {source.strategy === "head"
                                  ? "—"
                                  : `${Math.round(source.score * 100)}%`}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-slate-500">
                              {source.content}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {isUser ? (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm">
          <User className="h-4 w-4" />
        </span>
      ) : null}
    </motion.article>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 2.5c.5 3.4 1.6 5.2 4.4 6.4-2.8 1.2-3.9 3-4.4 6.4-.5-3.4-1.6-5.2-4.4-6.4 2.8-1.2 3.9-3 4.4-6.4Zm6.6 7.4c.28 1.9.9 2.9 2.4 3.6-1.5.7-2.1 1.7-2.4 3.6-.3-1.9-.9-2.9-2.4-3.6 1.5-.7 2.1-1.7 2.4-3.6ZM5.4 9.9c.28 1.9.9 2.9 2.4 3.6-1.5.7-2.1 1.7-2.4 3.6-.3-1.9-.9-2.9-2.4-3.6 1.5-.7 2.1-1.7 2.4-3.6Z" />
    </svg>
  );
}

function ThinkingDots() {
  // Free-tier models sometimes take 20-60s before the first token. A silent
  // spinner reads as "stuck", so surface how long the wait already is.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="flex items-center py-1">
      <span className="flex items-center gap-1.5">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-slate-300"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: index * 0.16,
            }}
          />
        ))}
      </span>
      {elapsed >= 3 ? (
        <span className="ml-2 text-[11px] leading-5 text-slate-400 tabular-nums">
          กำลังรอโมเดล · {elapsed}s
        </span>
      ) : null}
    </span>
  );
}

export default MessageBubble;
