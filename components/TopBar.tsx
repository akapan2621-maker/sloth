"use client";

import { Eye, EyeOff, PanelLeft, ShieldCheck } from "lucide-react";

import { useWorkspace } from "@/context/WorkspaceContext";
import { getProviderPreset } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface TopBarProps {
  title: string;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({ title, onOpenSettings, onToggleSidebar }: TopBarProps) {
  const { settings, updateSettings } = useWorkspace();
  const provider = getProviderPreset(settings.providerId);
  const hasKey = settings.apiKey.trim().length > 0;

  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4.5 w-4.5" />
        </button>
        <h2 className="truncate text-[13.5px] font-medium tracking-tight text-slate-700">
          {title}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => updateSettings({ privateMode: !settings.privateMode })}
          title={
            settings.privateMode
              ? "Private mode on — requests go straight to the gateway"
              : "Private mode off — requests are proxied by the app server"
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
            settings.privateMode
              ? "border-purple-200 bg-purple-50 text-purple-700"
              : "border-slate-200 bg-white text-slate-500 hover:text-slate-800",
          )}
        >
          {settings.privateMode ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Private mode</span>
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              settings.privateMode ? "bg-purple-500" : "bg-slate-300",
            )}
          />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          title="Open LLM & Kilo API settings"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              hasKey ? "bg-emerald-500" : "bg-amber-400",
            )}
          />
          <span className="hidden sm:inline">
            {provider.id === "kilo" ? "Kilo Code" : provider.label}
          </span>
          <span className="max-w-[150px] truncate font-mono text-[11.5px] text-slate-800">
            {settings.modelId || "no model"}
          </span>
          {settings.privateMode ? (
            <ShieldCheck className="h-3.5 w-3.5 text-purple-500" />
          ) : null}
        </button>
      </div>
    </header>
  );
}

export default TopBar;
