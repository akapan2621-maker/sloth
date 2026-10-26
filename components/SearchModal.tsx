"use client";

import { motion } from "framer-motion";
import { FileText, MessageSquare, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import { useWorkspace } from "@/context/WorkspaceContext";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
  onOpenSpace: (spaceId: string) => void;
}

export function SearchModal({
  open,
  onClose,
  onOpenChat,
  onOpenSpace,
}: SearchModalProps) {
  const { chats, documents, spaces } = useWorkspace();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return {
        chats: chats.slice(0, 6),
        documents: documents.slice(0, 6),
      };
    }

    const matchedChats = chats.filter((chat) => {
      if (chat.title.toLowerCase().includes(needle)) return true;
      return chat.messages.some((message) =>
        message.content.toLowerCase().includes(needle),
      );
    });

    const matchedDocs = documents.filter((doc) => {
      if (doc.fileName.toLowerCase().includes(needle)) return true;
      const space = spaces.find((item) => item.id === doc.spaceId);
      return space?.name.toLowerCase().includes(needle) ?? false;
    });

    return {
      chats: matchedChats.slice(0, 8),
      documents: matchedDocs.slice(0, 8),
    };
  }, [chats, documents, query, spaces]);

  const total = results.chats.length + results.documents.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search"
      subtitle="Chats and Space documents"
      icon={<Search className="h-4.5 w-4.5" />}
      width="max-w-xl"
    >
      <div className="space-y-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations and documents…"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
          />
        </div>

        {total === 0 ? (
          <p className="py-8 text-center text-[13px] text-slate-400">
            No matches for “{query}”.
          </p>
        ) : null}

        {results.chats.length > 0 ? (
          <section className="space-y-1.5">
            <p className="px-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
              Chats
            </p>
            <ul className="space-y-1">
              {results.chats.map((chat) => {
                const hit = chat.messages.find((message) =>
                  query.trim()
                    ? message.content.toLowerCase().includes(query.toLowerCase())
                    : false,
                );
                return (
                  <li key={chat.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChat(chat.id);
                        onClose();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50"
                    >
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-800">
                          {chat.title}
                        </span>
                        {hit ? (
                          <span className="mt-0.5 block text-[11.5px] text-slate-400">
                            {truncate(hit.content, 90)}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-slate-400">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {results.documents.length > 0 ? (
          <section className="space-y-1.5">
            <p className="px-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
              Space documents
            </p>
            <ul className="space-y-1">
              {results.documents.map((doc) => {
                const space = spaces.find((item) => item.id === doc.spaceId);
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (doc.spaceId) onOpenSpace(doc.spaceId);
                        onClose();
                      }}
                      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50"
                    >
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-800">
                          {doc.fileName}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-slate-400">
                          {space?.name ?? "Space"} · {doc.chunkCount} chunk
                          {doc.chunkCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          <Sparkles className="h-3 w-3" />
          Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px]">esc</kbd> to close
        </p>
      </div>
    </Modal>
  );
}

export default SearchModal;
