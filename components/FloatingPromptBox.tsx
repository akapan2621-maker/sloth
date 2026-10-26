"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Plus, RotateCcw, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import AdvancedPopover from "@/components/prompt/AdvancedPopover";
import ModelSwitcher from "@/components/prompt/ModelSwitcher";
import SpacePicker from "@/components/prompt/SpacePicker";
import { useWorkspace } from "@/context/WorkspaceContext";
import { QUICK_MODES } from "@/lib/constants";
import type { SpaceSelection } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FloatingPromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  spaceSelection: SpaceSelection;
  onSpaceSelectionChange: (selection: SpaceSelection) => void;
  onUploadFiles: (files: File[]) => void;
  quickMode: string | null;
  onQuickModeChange: (mode: string | null, prompt: string) => void;
  onReset: () => void;
}

export function FloatingPromptBox({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming = false,
  disabled = false,
  spaceSelection,
  onSpaceSelectionChange,
  onUploadFiles,
  quickMode,
  onQuickModeChange,
  onReset,
}: FloatingPromptBoxProps) {
  const { spaces } = useWorkspace();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!streaming && value.trim() && !disabled) onSubmit();
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onUploadFiles(Array.from(files));
  };

  const targetSpaceId =
    spaceSelection.kind === "space"
      ? spaceSelection.spaceId
      : spaceSelection.kind === "all"
        ? spaces[0]?.id
        : undefined;

  return (
    <div className="w-full">
      {/* Outer container ---------------------------------------------- */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-2xl border bg-slate-100/80 p-1.5 shadow-lg transition",
          dragging
            ? "border-purple-300 ring-4 ring-purple-100"
            : "border-slate-200/80",
        )}
      >
        {/* Top bar ---------------------------------------------------- */}
        <div className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-0.5">
          <ModelSwitcher />
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            {dragging ? (
              <span className="px-1.5 font-medium text-purple-600">
                Drop to add to Space
              </span>
            ) : null}
          </div>
        </div>

        {/* Inner card ------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
            placeholder="Ask a question..."
            className="max-h-[260px] w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400 scrollbar-slim"
          />

          {/* Bottom control bar ---------------------------------------- */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <SpacePicker
                value={spaceSelection}
                onChange={onSpaceSelectionChange}
                onUpload={() => fileRef.current?.click()}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!targetSpaceId}
                title={
                  targetSpaceId
                    ? "Add a document to the selected Space"
                    : "Select a Space first"
                }
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Add document"
              >
                <Plus className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.markdown,.csv,.json"
                className="hidden"
                onChange={(event) => {
                  handleFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <AdvancedPopover />
              {streaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  aria-label="Stop generating"
                >
                  <Square className="h-3.5 w-3.5 fill-slate-600" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={disabled || !value.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-4.5 w-4.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick mode pills --------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false}>
          {QUICK_MODES.map((mode) => {
            const active = quickMode === mode.id;
            return (
              <motion.button
                key={mode.id}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.16 }}
                onClick={() => {
                  if (active) {
                    onQuickModeChange(null, "");
                  } else {
                    onQuickModeChange(mode.id, mode.prompt);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
                  active
                    ? "border-purple-200 bg-purple-50 text-purple-700 shadow-soft"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                <span>{mode.icon}</span>
                {mode.label}
                {active ? (
                  <X
                    className="h-3 w-3 text-purple-400"
                    onClick={(event) => {
                      event.stopPropagation();
                      onQuickModeChange(null, "");
                    }}
                  />
                ) : null}
              </motion.button>
            );
          })}
        </AnimatePresence>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-500 transition hover:text-slate-900"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
}

export default FloatingPromptBox;
