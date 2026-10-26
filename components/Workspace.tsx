"use client";

import { useCallback, useEffect, useState } from "react";

import ChatView from "@/components/ChatView";
import LLMSettingsModal from "@/components/LLMSettingsModal";
import SearchModal from "@/components/SearchModal";
import {
  AgentsView,
  AppsView,
  ResearchView,
} from "@/components/SecondaryViews";
import Sidebar, { type SidebarView } from "@/components/Sidebar";
import SpacesManager from "@/components/SpacesManager";
import TopBar from "@/components/TopBar";
import { useWorkspace } from "@/context/WorkspaceContext";

const VIEW_TITLES: Record<SidebarView, string> = {
  chat: "New chat",
  spaces: "Spaces · Knowledge Base",
  research: "Research",
  agents: "Chat agents",
  apps: "Apps",
  settings: "LLM & Kilo API Settings",
};

export function Workspace() {
  const { hydrated, selectChat } = useWorkspace();
  const [view, setView] = useState<SidebarView>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={VIEW_TITLES[view]}
          onOpenSettings={openSettings}
          onToggleSidebar={() => setCollapsed((value) => !value)}
        />

        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
          {!hydrated ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-purple-600" />
                <p className="text-[13px] text-slate-400">
                  Loading your workspace…
                </p>
              </div>
            </div>
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

export default Workspace;
