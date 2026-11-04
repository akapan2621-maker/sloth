"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AuthScreen from "@/components/AuthScreen";
import ChatView from "@/components/ChatView";
import LLMSettingsModal from "@/components/LLMSettingsModal";
import SearchModal from "@/components/SearchModal";
import {
  AgentsView,
  AppsView,
  ResearchView,
} from "@/components/SecondaryViews";
import Sidebar, { type SidebarView } from "@/components/Sidebar";
import SpacePanel from "@/components/SpacePanel";
import SpacesManager from "@/components/SpacesManager";
import TopBar from "@/components/TopBar";
import { StorageBanner } from "@/components/StorageBanner";
import { useAuth } from "@/context/AuthContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { readUiState, writeUiState } from "@/lib/uiState";
import { cn } from "@/lib/utils";

const VIEW_TITLES: Record<SidebarView, string> = {
  chat: "New chat",
  spaces: "Spaces · Knowledge Base",
  research: "Research",
  agents: "Chat agents",
  apps: "Apps",
  settings: "LLM & Kilo API Settings",
};

/** Split-view constraints: the Spaces console keeps a 20–50% share. */
const MIN_RIGHT = 0.2;
const MAX_RIGHT = 0.5;
const DEFAULT_RIGHT = 0.38;

export function Workspace() {
  const { hydrated, selectChat } = useWorkspace();
  const { status: authStatus, user } = useAuth();

  const [view, setView] = useState<SidebarView>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  /* Split state, remembered per account. ---------------------------------- */
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRight, setSplitRight] = useState(DEFAULT_RIGHT);
  const shellRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const userId = user?.id;

  useEffect(() => {
    if (authStatus !== "ready" || !userId) return;
    const remembered = readUiState(userId);
    setSplitOpen(remembered.splitOpen ?? false);
    setSplitRight(rememberSplit(remembered.splitRight) ?? DEFAULT_RIGHT);
  }, [authStatus, userId]);

  useEffect(() => {
    if (!userId) return;
    writeUiState(userId, { splitOpen, splitRight });
  }, [userId, splitOpen, splitRight]);

  const toggleSplit = useCallback(() => {
    setView("chat");
    setSplitOpen((value) => !value);
  }, []);

  const splitOn = splitOpen && view === "chat";

  /* Divider drag --------------------------------------------------------- */
  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const next = (rect.right - event.clientX) / rect.width;
    setSplitRight(clampSplit(next));
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  /* Cmd/Ctrl + K opens the search palette. ----------------------------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const goToChat = useCallback(() => setView("chat"), []);

  const handleOpenChat = useCallback(
    (chatId: string) => {
      selectChat(chatId);
      setView("chat");
    },
    [selectChat],
  );

  /* Auth gate ------------------------------------------------------------- */
  if (authStatus === "restoring") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-alabaster">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-purple-600" />
          <p className="text-[13px] text-slate-400">Loading your session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  /* Logged-in shell -------------------------------------------------------- */
  return (
    <div className="flex h-screen w-full overflow-hidden bg-alabaster">
      <div className="hidden lg:flex">
        <Sidebar
          view={view}
          onViewChange={setView}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={openSettings}
          splitActive={splitOn}
          onToggleSplit={toggleSplit}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={splitOn ? "Chat + Spaces (split)" : VIEW_TITLES[view]}
          onOpenSettings={openSettings}
          onToggleSidebar={() => setCollapsed((value) => !value)}
          splitActive={splitOn}
          onToggleSplit={toggleSplit}
        />

        <StorageBanner />

        <main
          ref={shellRef}
          className={cn(
            "scrollbar-slim",
            splitOn ? "flex min-h-0 flex-1 items-stretch" : "min-h-0 flex-1 overflow-y-auto",
          )}
        >
          {!hydrated ? (
            <div className="flex h-full flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-purple-600" />
                <p className="text-[13px] text-slate-400">
                  Loading your workspace…
                </p>
              </div>
            </div>
          ) : splitOn ? (
            <>
              {/* Chat column */}
              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChatView />
              </section>

              {/* Divider */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize split view"
                onPointerDown={startDrag}
                onPointerMove={onDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="group hidden w-1.5 shrink-0 cursor-col-resize touch-none flex-col items-center justify-center bg-transparent lg:flex"
                title="Drag to resize"
              >
                <span className="h-10 w-1 rounded-full bg-slate-200 transition group-hover:bg-purple-400" />
              </div>

              {/* Spaces console column */}
              <section
                className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-slate-200/80 lg:flex"
                style={{ width: `${Math.round(splitRight * 100)}%` }}
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <SpacePanel onClose={toggleSplit} />
                </div>
              </section>
            </>
          ) : view === "chat" ? (
            <ChatView />
          ) : view === "spaces" ? (
            <SpacesManager onClose={goToChat} />
          ) : view === "research" ? (
            <ResearchView onGoToChat={goToChat} />
          ) : view === "agents" ? (
            <AgentsView onGoToChat={goToChat} />
          ) : view === "apps" ? (
            <AppsView onGoToChat={goToChat} />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-6 py-10">
              <p className="text-[13px] text-slate-500">
                Use the LLM settings panel to configure the gateway.
              </p>
              <button
                type="button"
                onClick={openSettings}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-soft"
              >
                Open settings
              </button>
            </div>
          )}
        </main>
      </div>

      <LLMSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenChat={handleOpenChat}
        onOpenSpace={() => setView("spaces")}
      />
    </div>
  );
}

function clampSplit(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_RIGHT;
  return Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, value));
}

function rememberSplit(value?: number): number | undefined {
  return typeof value === "number" && !Number.isNaN(value)
    ? clampSplit(value)
    : undefined;
}

export default Workspace;
