"use client";

import { Check, ChevronDown, Database, FolderOpen, Layers } from "lucide-react";

import Dropdown from "@/components/ui/Dropdown";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { SpaceSelection } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SpacePickerProps {
  value: SpaceSelection;
  onChange: (selection: SpaceSelection) => void;
  onUpload?: () => void;
}

export function SpacePicker({ value, onChange, onUpload }: SpacePickerProps) {
  const { spaces, documents } = useWorkspace();

  const label =
    value.kind === "none"
      ? "No Space"
      : value.kind === "all"
        ? "All Spaces"
        : (spaces.find((space) => space.id === value.spaceId)?.name ??
          "Select Space");

  const docCount = (spaceId: string) =>
    documents.filter((doc) => doc.spaceId === spaceId).length;

  return (
    <Dropdown
      width="w-72"
      trigger={
        <div
          data-testid="space-picker-trigger"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          {value.kind === "none" ? (
            <Database className="h-3.5 w-3.5 text-slate-400" />
          ) : value.kind === "all" ? (
            <Layers className="h-3.5 w-3.5 text-purple-500" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 text-purple-500" />
          )}
          <span className="max-w-[180px] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </div>
      }
    >
      {(close) => (
        <div className="space-y-1">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Specific data
          </p>

          <button
            type="button"
            onClick={() => {
              onChange({ kind: "none" });
              close();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
              value.kind === "none"
                ? "bg-purple-50 text-purple-800"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            {value.kind === "none" ? (
              <Check className="h-3.5 w-3.5 text-purple-600" />
            ) : (
              <Database className="h-3.5 w-3.5 text-slate-300" />
            )}
            <span className="text-[12.5px]">No Space</span>
            <span className="ml-auto text-[10.5px] text-slate-400">
              chat only
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onChange({ kind: "all" });
              close();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
              value.kind === "all"
                ? "bg-purple-50 text-purple-800"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            {value.kind === "all" ? (
              <Check className="h-3.5 w-3.5 text-purple-600" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-slate-300" />
            )}
            <span className="text-[12.5px]">All Spaces</span>
          </button>

          {spaces.length > 0 ? (
            <>
              <div className="my-1 border-t border-slate-100" />
              {spaces.map((space) => {
                const active =
                  value.kind === "space" && value.spaceId === space.id;
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => {
                      onChange({ kind: "space", spaceId: space.id });
                      close();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
                      active
                        ? "bg-purple-50 text-purple-800"
                        : "text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {active ? (
                      <Check className="h-3.5 w-3.5 text-purple-600" />
                    ) : (
                      <span className="w-3.5 text-center text-[12px]">
                        {space.emoji}
                      </span>
                    )}
                    <span className="truncate text-[12.5px]">{space.name}</span>
                    <span className="ml-auto text-[10.5px] text-slate-400">
                      {docCount(space.id)} doc{docCount(space.id) === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}

          {onUpload ? (
            <>
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  onUpload();
                  close();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <FolderOpen className="h-3.5 w-3.5 text-slate-300" />
                <span className="text-[12.5px]">Upload a document…</span>
              </button>
            </>
          ) : null}
        </div>
      )}
    </Dropdown>
  );
}

export default SpacePicker;
