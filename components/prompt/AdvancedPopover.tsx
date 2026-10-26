"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";

import Dropdown from "@/components/ui/Dropdown";
import { useWorkspace } from "@/context/WorkspaceContext";
import { areEmbeddingsUnavailable } from "@/lib/embeddings";

export function AdvancedPopover() {
  const { settings, updateSettings } = useWorkspace();
  const vectorMode = !areEmbeddingsUnavailable();

  return (
    <Dropdown
      align="right"
      width="w-80"
      trigger={
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
          <span>Advanced</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </div>
      }
    >
      {() => (
        <div className="space-y-4 p-1.5">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-medium text-slate-700">
                Temperature
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {settings.temperature.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.temperature}
              onChange={(event) =>
                updateSettings({ temperature: Number(event.target.value) })
              }
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-purple-600"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Lower is more precise, higher is more creative.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-medium text-slate-700">
                Top-K chunks to retrieve
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {settings.topK}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={settings.topK}
              onChange={(event) =>
                updateSettings({ topK: Number(event.target.value) })
              }
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-purple-600"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              How many Space excerpts are injected into the prompt.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="text-[12px] font-medium text-slate-700">
              System prompt override
            </label>
            <textarea
              value={settings.systemPrompt}
              onChange={(event) =>
                updateSettings({ systemPrompt: event.target.value })
              }
              placeholder="Leave blank to use the default workspace prompt."
              className="mt-1.5 min-h-[90px] w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[11.5px] leading-4 text-slate-700 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
              spellCheck={false}
            />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-slate-700">
                Retrieval mode
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
                {vectorMode ? "Hybrid" : "Keyword"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {vectorMode
                ? "BM25 + TF-IDF cosine, blended with vector similarity."
                : "BM25 + TF-IDF cosine. Add an /embeddings endpoint on your gateway to enable vector retrieval."}
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-slate-700">
                Private mode
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.privateMode}
                onClick={() =>
                  updateSettings({ privateMode: !settings.privateMode })
                }
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                  settings.privateMode ? "bg-purple-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                    settings.privateMode ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              Streams straight from the gateway. Your key never touches our
              server; falls back to the server if CORS blocks it.
            </p>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

export default AdvancedPopover;
