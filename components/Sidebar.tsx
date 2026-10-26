"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Blocks,
  Bot,
  ChevronLeft,
  ChevronRight,
  Compass,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { useWorkspace } from "@/context/WorkspaceContext";
import { cn, formatRelativeTime } from "@/lib/utils";

export type SidebarView =
  | "chat"
  | "spaces"
  | "research"
  | "agents"
  | "apps"
  | "settings";

interface SidebarProps {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

const PRIMARY_NAV: {
  id: SidebarView;
  label: string;
  icon: typeof Search;
  badge?: "spaces";
}[] = [
  { id: "chat", label: "New chat", icon: MessageSquarePlus },
  { id: "spaces", label: "Spaces", icon: FolderOpen, badge: "spaces" },
];

const SECONDARY_NAV: { id: SidebarView; label: string; icon: typeof Search }[] = [
  { id: "research", label: "Research", icon: Compass },
  { id: "agents", label: "Chat agents", icon: Bot },
  { id: "apps", label: "Apps", icon: Blocks },
];

export function Sidebar({
  view,
  onViewChange,
  collapsed,
  onToggleCollapsed,
  onOpenSearch,
  onOpenSettings,
}: SidebarProps) {
  const { chats, selectChat, renameChat, deleteChat, spaces, newChat, activeChatId } =
    useWorkspace();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const handleNewChat = () => {
    newChat();
    onViewChange("chat");
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="z-30 flex h-full shrink-0 flex-col border-r border-slate-200 bg-white"
    >
      {/* Brand header -------------------------------------------------- */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
          <Sparkles className="h-4.5 w-4.5" />
        </span>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.18 }}
              className="min-w-0 flex-1"
            >
              <p className="truncate text-[14px] font-semibold leading-tight tracking-tight text-slate-900">
                Sloth
              </p>
              <p className="truncate text-[11px] leading-tight text-slate-400">
                AI Workspace
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation ---------------------------------------------------- */}
      <nav className="space-y-0.5 px-3">
        <button
          type="button"
          onClick={handleNewChat}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition",
            view === "chat" && activeChatId === null
              ? "bg-purple-50 text-purple-800 ring-1 ring-purple-100"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          )}
          title="New chat"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          {!collapsed ? <span>New chat</span> : null}
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          title="Search (⌘K)"
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed ? (
            <>
              <span>Search</span>
              <kbd className="ml-auto rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </>
          ) : null}
        </button>

        {PRIMARY_NAV.filter((item) => item.id === "spaces").map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition",
              view === item.id
                ? "bg-purple-50 text-purple-800 ring-1 ring-purple-100"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
            title={item.label}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            {!collapsed ? (
              <>
                <span>{item.label}</span>
                <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
                  {spaces.length}
                </span>
              </>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mx-3 my-3 border-t border-slate-100" />

      <nav className="space-y-0.5 px-3">
        {SECONDARY_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition",
              view === item.id
                ? "bg-purple-50 text-purple-800 ring-1 ring-purple-100"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
            title={item.label}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>{item.label}</span> : null}
          </button>
        ))}

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          title="LLM & Kilo API Settings"
        >
          <Settings2 className="h-4 w-4 shrink-0" />
          {!collapsed ? <span className="truncate">LLM &amp; Kilo API</span> : null}
        </button>
      </nav>

      {/* Recents -------------------------------------------------------- */}
      {!collapsed ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
          <p className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
            Recents
          </p>
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto pb-2">
            {chats.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-slate-400">
                No conversations yet.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {chats.map((chat) => {
                  const active = chat.id === activeChatId && view === "chat";
                  return (
                    <li key={chat.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          selectChat(chat.id);
                          onViewChange("chat");
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-left text-[12.5px] transition",
                          active
                            ? "bg-purple-50 font-medium text-purple-800"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {chat.title}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-slate-400 opacity-0 transition group-hover:opacity-100">
                          {formatRelativeTime(chat.updatedAt)}
                        </span>
                      </button>

                      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="Rename chat"
                          onClick={() => {
                            const next = window.prompt("Rename chat", chat.title);
                            if (next && next.trim()) renameChat(chat.id, next.trim());
                          }}
                          className="rounded p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete chat"
                          onClick={() => {
                            if (window.confirm(`Delete "${chat.title}"?`)) {
                              deleteChat(chat.id);
                            }
                          }}
                          className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Profile card --------------------------------------------------- */}
      <div className="border-t border-slate-100 p-3">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl p-2 transition hover:bg-slate-50",
            !collapsed && "bg-slate-50/60",
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-[11px] font-bold text-white shadow-soft">
            AP
          </span>
          {!collapsed ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold leading-[1.25] text-slate-800">
                  Akapan Rattanadilok Na Phuket
                </p>
                <p className="truncate text-[11px] leading-tight text-slate-400">
                  akapan2621
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Settings"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </motion.aside>
  );
}

export default Sidebar;
