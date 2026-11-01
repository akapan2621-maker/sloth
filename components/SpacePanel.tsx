"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  Layers,
  PanelsTopLeft,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useWorkspace } from "@/context/WorkspaceContext";
import { ACCEPTED_FILE_EXTENSIONS } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { IngestProgress, SpaceSelection } from "@/lib/types";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

interface SpacePanelProps {
  onClose: () => void;
}

const MAX_PREVIEW_CHUNKS = 4;

/**
 * The right-hand side of the split view: a compact Spaces console that
 * mirrors the chat's scope selection, lists every file in scope (with a
 * chunk preview) and accepts drag-and-drop uploads — so there is always a
 * visible answer to "which files am I working with?".
 */
export function SpacePanel({ onClose }: SpacePanelProps) {
  const {
    spaces,
    documents,
    chunks,
    spaceSelection,
    setSpaceSelection,
    deleteDocument,
    ingestFiles,
    ingestProgress,
    backend,
  } = useWorkspace();

  const [dragActive, setDragActive] = useState(false);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);

  const scopeSpaceId =
    spaceSelection.kind === "space" ? spaceSelection.spaceId : null;

  const spaceDocs = useMemo(() => {
    if (spaceSelection.kind === "space") {
      return documents.filter((doc) => doc.spaceId === scopeSpaceId);
    }
    if (spaceSelection.kind === "all") {
      return [...documents].sort((a, b) => b.createdAt - a.createdAt);
    }
    return [];
  }, [documents, spaceSelection.kind, scopeSpaceId]);

  const scopeChunkCount = useMemo(
    () => chunks.filter((chunk) => inScope(chunk.spaceId, spaceSelection)).length,
    [chunks, spaceSelection],
  );

  const uploadTargetId =
    spaceSelection.kind === "space"
      ? spaceSelection.spaceId
      : spaceSelection.kind === "all"
        ? spaces[0]?.id
        : undefined;

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0 || !uploadTargetId) return;
      void ingestFiles(files, uploadTargetId);
    },
    [ingestFiles, uploadTargetId],
  );

  const expandedDoc = expandedDocId
    ? spaceDocs.find((doc) => doc.id === expandedDocId)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
            <FolderOpen className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-slate-800">
              Spaces
            </p>
            <p className="truncate text-[10.5px] leading-tight text-slate-400">
              what you are working with
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close split view"
          title="Close split view"
        >
          <PanelsTopLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Scope selector */}
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSpaceSelection({ kind: "none" })}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
              spaceSelection.kind === "none"
                ? "border-slate-300 bg-slate-800 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:text-slate-800",
            )}
          >
            <Database className="h-3 w-3" />
            None
          </button>
          <button
            type="button"
            onClick={() => setSpaceSelection({ kind: "all" })}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
              spaceSelection.kind === "all"
                ? "border-purple-300 bg-purple-600 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:text-slate-800",
            )}
          >
            <Layers className="h-3 w-3" />
            All Spaces
            <span className="text-[10px] opacity-70">{spaces.length}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {spaces.map((space) => {
            const active =
              spaceSelection.kind === "space" &&
              spaceSelection.spaceId === space.id;
            return (
              <button
                key={space.id}
                type="button"
                onClick={() => setSpaceSelection({ kind: "space", spaceId: space.id })}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
                  active
                    ? "border-purple-300 bg-purple-50 text-purple-700 ring-1 ring-purple-200"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
                title={`${space.name} — ${documents.filter((doc) => doc.spaceId === space.id).length} docs`}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[9px] text-white",
                    space.color.startsWith("from-")
                      ? `bg-gradient-to-tr ${space.color}`
                      : "bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600",
                  )}
                >
                  {space.emoji}
                </span>
                <span className="truncate">{space.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scope summary + upload */}
      <div className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">
            {spaceSelection.kind === "none" ? (
              "No scope — chat without knowledge base"
            ) : (
              <>
                <span className="font-semibold text-slate-700">
                  {spaceDocs.length} file{spaceDocs.length === 1 ? "" : "s"}
                </span>{" "}
                · {scopeChunkCount.toLocaleString()} chunks ·{" "}
                {spaceSelection.kind === "all" ? "All Spaces" : "single Space"}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setFilePickerOpen((value) => !value)}
            disabled={!uploadTargetId}
            title={
              uploadTargetId
                ? "Upload into this scope"
                : "Pick a Space to upload into"
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {filePickerOpen ? (
          <input
            type="file"
            multiple
            accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
            className="mt-2 w-full text-[11px] text-slate-500"
            onChange={(event) => {
              if (event.target.files) handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        ) : null}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (uploadTargetId) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (!uploadTargetId) return;
            handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            "mt-2 rounded-lg border border-dashed px-3 py-2 text-center transition",
            dragActive
              ? "border-purple-400 bg-purple-50"
              : uploadTargetId
                ? "cursor-pointer border-slate-200 hover:border-slate-300"
                : "border-slate-100 opacity-50",
          )}
        >
          <p className="text-[11px] text-slate-500">
            {uploadTargetId
              ? `Drop files to add to “${
                  spaceSelection.kind === "space"
                    ? spaces.find((s) => s.id === uploadTargetId)?.name ?? "Space"
                    : spaces[0]?.name ?? "space"
                }”`
              : "Select a scope above, then drop files here"}
          </p>
        </div>
      </div>

      {/* Ingest progress */}
      <AnimatePresence>
        {ingestProgress.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 overflow-hidden border-b border-slate-100 bg-slate-50/60 px-4 py-2"
          >
            {ingestProgress.slice(0, 4).map((progress) => (
              <IngestRow key={progress.fileName} progress={progress} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Document list */}
      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        {spaceSelection.kind === "none" ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Database className="h-6 w-6 text-slate-200" />
            <p className="mt-2 text-[12.5px] text-slate-500">
              No Space selected
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Pick one above or use the selector next to the prompt.
            </p>
          </div>
        ) : spaceDocs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <FileText className="h-6 w-6 text-slate-200" />
            <p className="mt-2 text-[12.5px] text-slate-500">No documents yet</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Drop a file to index it into this scope.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 pb-8">
            {spaceDocs.map((doc) => (
              <li key={doc.id} className="group">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedDocId((current) =>
                      current === doc.id ? null : doc.id,
                    )
                  }
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-50/80"
                >
                  {expandedDocId === doc.id ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  )}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-slate-800">
                      {doc.fileName}
                    </span>
                    <span className="block truncate text-[10.5px] text-slate-400">
                      {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} ·{" "}
                      {formatBytes(doc.size)} ·{" "}
                      {formatRelativeTime(doc.createdAt)}
                      {spaceSelection.kind === "all" ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-slate-400">
                          ·
                          {spaces.find((space) => space.id === doc.spaceId)?.name ??
                            "Space"}
                        </span>
                      ) : null}
                      {doc.embedded ? (
                        <span className="ml-1 text-emerald-600">· embedded</span>
                      ) : null}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(`Delete "${doc.fileName}" and its chunks?`)) {
                        deleteDocument(doc.id);
                        if (expandedDocId === doc.id) setExpandedDocId(null);
                      }
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                    aria-label="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>

                {/* Chunk preview */}
                <AnimatePresence initial={false}>
                  {expandedDocId === doc.id && expandedDoc ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden border-b border-slate-100 bg-slate-50/50"
                    >
                      <div className="mx-4 mb-3 rounded-lg border border-slate-200 bg-white p-2.5">
                        <DocChunks docId={doc.id} />
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-2.5 text-[10.5px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          {backend === "indexeddb" ? (
            <>
              <HardDrive className="h-3 w-3 text-emerald-500" /> IndexedDB
            </>
          ) : backend === "localstorage" ? (
            <>
              <HardDrive className="h-3 w-3 text-amber-500" /> localStorage
            </>
          ) : (
            <>
              <Database className="h-3 w-3 text-amber-500" /> memory
            </>
          )}
        </span>
        {isSupabaseConfigured ? (
          <span className="inline-flex items-center gap-1">
            <Cloud className="h-3 w-3" /> Supabase configured
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DocChunks({ docId }: { docId: string }) {
  const { chunks } = useWorkspace();
  const docChunks = useMemo(
    () =>
      chunks
        .filter((chunk) => chunk.documentId === docId)
        .sort((a, b) => a.index - b.index)
        .slice(0, MAX_PREVIEW_CHUNKS),
    [chunks, docId],
  );

  if (docChunks.length === 0) {
    return (
      <p className="py-2 text-center text-[11px] text-slate-400">
        Chunks of this file are not in this scope preview yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Content preview — chunks 1–{docChunks.length} of the file
      </p>
      {docChunks.map((chunk) => (
        <div
          key={chunk.id}
          className="rounded-md bg-slate-50 p-2 text-[11px] leading-5 text-slate-600"
        >
          <span className="mr-1.5 font-mono text-[10px] text-purple-500">
            #{chunk.index}
          </span>
          <span className="line-clamp-3 whitespace-pre-wrap">{chunk.content}</span>
        </div>
      ))}
    </div>
  );
}

function IngestRow({ progress }: { progress: IngestProgress }) {
  return (
    <div className="rounded-md bg-white px-2 py-1.5 text-[10.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-700">{progress.fileName}</span>
        <span
          className={cn(
            progress.stage === "error"
              ? "text-rose-500"
              : progress.stage === "done"
                ? "text-emerald-600"
                : "text-purple-600",
          )}
        >
          {progress.stage === "error"
            ? "Failed"
            : progress.stage === "done"
              ? "Indexed"
              : `${Math.round(progress.percent * 100)}%`}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            progress.stage === "error"
              ? "bg-rose-400"
              : progress.stage === "done"
                ? "bg-emerald-500"
                : "bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600",
          )}
          style={{ width: `${Math.max(4, Math.round(progress.percent * 100))}%` }}
        />
      </div>
    </div>
  );
}

function inScope(spaceId: string, selection: SpaceSelection): boolean {
  if (selection.kind === "none") return false;
  if (selection.kind === "all") return true;
  return selection.spaceId === spaceId;
}

export default SpacePanel;
