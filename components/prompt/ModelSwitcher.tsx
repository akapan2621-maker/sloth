"use client";

import { Check, ChevronDown, Cpu, Plus, Zap } from "lucide-react";
import { useState } from "react";

import Dropdown from "@/components/ui/Dropdown";
import { useWorkspace } from "@/context/WorkspaceContext";
import { cn } from "@/lib/utils";

interface ModelSwitcherProps {
  compact?: boolean;
}

export function ModelSwitcher({ compact = false }: ModelSwitcherProps) {
  const { settings, setModelId, addModelId } = useWorkspace();
  const [draft, setDraft] = useState("");

  const models = settings.savedModelIds.length
    ? settings.savedModelIds
    : [settings.modelId].filter(Boolean);

  const commit = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    addModelId(trimmed);
    setModelId(trimmed);
    setDraft("");
  };

  return (
    <Dropdown
      width="w-72"
      trigger={
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-white/70 hover:text-slate-900",
            compact && "px-2 py-1",
          )}
        >
          <Zap className="h-3.5 w-3.5 text-purple-500" />
          <span className="text-slate-400">Quick</span>
          <span className="max-w-[190px] truncate font-mono text-[11.5px]">
            {settings.modelId || "Select model"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </div>
      }
    >
      {(close) => (
        <div className="space-y-1.5">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Quick switch
          </p>
          {models.map((id) => {
            const active = id === settings.modelId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setModelId(id);
                  close();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
                  active
                    ? "bg-purple-50 text-purple-800"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {active ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                ) : (
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                )}
                <span className="truncate font-mono text-[11.5px]">{id}</span>
              </button>
            );
          })}

          <div className="mt-1 border-t border-slate-100 pt-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit(draft);
                    close();
                  }
                }}
                placeholder="Custom model id…"
                className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-slate-700 outline-none placeholder:text-slate-400"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => {
                  commit(draft);
                  close();
                }}
                className="rounded-md p-1 text-slate-400 transition hover:bg-purple-50 hover:text-purple-600"
                aria-label="Use custom model"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

export default ModelSwitcher;
