"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspace } from "@/context/WorkspaceContext";
import { ACCEPTED_FILE_EXTENSIONS } from "@/lib/constants";
import { isSupportedFile } from "@/lib/fileParser";
import { localUsageBytes } from "@/lib/localDb";
import { StorageStatusChip } from "@/components/StorageBanner";
import type { IngestProgress, Space } from "@/lib/types";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

interface SpacesManagerProps {
  onClose?: () => void;
}

const STAGE_LABELS: Record<IngestProgress["stage"], string> = {
  queued: "Queued",
  extracting: "Extracting Text",
  chunking: "Chunking",
  indexing: "Indexing to Space",
  done: "Indexed",
  error: "Failed",
};

export function SpacesManager({ onClose }: SpacesManagerProps) {
  const {
    spaces,
    documents,
    chunks,
    createSpace,
    updateSpace,
    deleteSpace,
    deleteDocument,
    ingestFiles,
    ingestProgress,
    clearIngestProgress,
    backend,
    supabaseEnabled,
    cloudSyncedAt,
  } = useWorkspace();

  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(
    spaces[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceDescription, setNewSpaceDescription] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void localUsageBytes().then((bytes) => {
      if (!cancelled) setUsageBytes(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [documents.length, chunks.length]);

  const effectiveSpaceId =
    activeSpaceId && spaces.some((space) => space.id === activeSpaceId)
      ? activeSpaceId
      : spaces[0]?.id ?? null;

  const spaceDocs = useMemo(
    () => documents.filter((doc) => doc.spaceId === effectiveSpaceId),
    [documents, effectiveSpaceId],
  );

  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return spaceDocs;
    return spaceDocs.filter((doc) => doc.fileName.toLowerCase().includes(needle));
  }, [query, spaceDocs]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      if (!effectiveSpaceId) return;
      await ingestFiles(files, effectiveSpaceId);
    },
    [effectiveSpaceId, ingestFiles],
  );

  const handleCreate = () => {
    const name = newSpaceName.trim();
    if (!name) return;
    const space = createSpace(name, newSpaceDescription.trim());
    setActiveSpaceId(space.id);
    setNewSpaceName("");
    setNewSpaceDescription("");
    setCreating(false);
  };

  const chunkCountFor = (spaceId: string) =>
    chunks.filter((chunk) => chunk.spaceId === spaceId).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* Header ------------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
              <FolderOpen className="h-4.5 w-4.5" />
            </span>
            <h1 className="text-2xl font-light tracking-tight text-slate-800">
              Spaces
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
              {spaces.length}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-slate-500">
            Isolated knowledge bases. Documents are parsed and chunked in your
            browser, then indexed for retrieval.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500"
            title={
              backend === "indexeddb"
                ? "Documents are stored in IndexedDB"
                : backend === "localstorage"
                  ? "IndexedDB unavailable - using localStorage"
                  : "No persistent storage available"
            }
          >
            {backend === "indexeddb" ? (
              <HardDrive className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Database className="h-3.5 w-3.5 text-amber-500" />
            )}
            {backend === "indexeddb"
              ? "IndexedDB"
              : backend === "localstorage"
                ? "localStorage"
                : "Memory only"}
          </span>
          {supabaseEnabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700">
              <Cloud className="h-3.5 w-3.5" />
              Supabase
            </span>
          ) : null}
          {usageBytes !== null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500">
              {formatBytes(usageBytes)} stored locally
            </span>
          ) : null}
          <StorageStatusChip />
          {cloudSyncedAt ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-700"
              title={`Workspace mirrored to Vercel Blob at ${new Date(
                cloudSyncedAt,
              ).toLocaleString()}`}
            >
              <Cloud className="h-3.5 w-3.5" />
              Vercel cloud · {formatRelativeTime(cloudSyncedAt)}
            </span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Back to chat
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Space list ------------------------------------------------- */}
        <aside className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Your Spaces
              </span>
              <button
                type="button"
                onClick={() => setCreating((value) => !value)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-purple-600"
                aria-label="Create space"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {creating ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2 space-y-2 overflow-hidden rounded-xl bg-slate-50 p-2.5"
                >
                  <input
                    autoFocus
                    value={newSpaceName}
                    onChange={(event) => setNewSpaceName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleCreate();
                    }}
                    placeholder="Space name"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-purple-400"
                  />
                  <input
                    value={newSpaceDescription}
                    onChange={(event) =>
                      setNewSpaceDescription(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleCreate();
                    }}
                    placeholder="Description (optional)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-purple-400"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleCreate}
                      className="flex-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <ul className="space-y-1">
              {spaces.map((space) => {
                const active = space.id === effectiveSpaceId;
                const docCount = documents.filter(
                  (doc) => doc.spaceId === space.id,
                ).length;
                return (
                  <li key={space.id}>
                    <button
                      type="button"
                      onClick={() => setActiveSpaceId(space.id)}
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition",
                        active
                          ? "bg-purple-50 ring-1 ring-purple-200"
                          : "hover:bg-slate-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] text-white shadow-sm",
                          space.color.startsWith("from-")
                            ? `bg-gradient-to-tr ${space.color}`
                            : "bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600",
                        )}
                      >
                        {space.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block break-words text-[13px] font-medium leading-snug",
                            active ? "text-purple-900" : "text-slate-700",
                          )}
                        >
                          {space.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {docCount} doc{docCount === 1 ? "" : "s"} ·{" "}
                          {chunkCountFor(space.id)} chunk
                          {chunkCountFor(space.id) === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            const next = window.prompt(
                              "Rename space",
                              space.name,
                            );
                            if (next && next.trim()) {
                              updateSpace(space.id, { name: next.trim() });
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.stopPropagation();
                          }}
                          className="rounded p-1 text-slate-400 transition hover:bg-white hover:text-slate-700"
                          aria-label="Rename space"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              window.confirm(
                                `Delete "${space.name}" and all of its documents?`,
                              )
                            ) {
                              deleteSpace(space.id);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.stopPropagation();
                          }}
                          className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                          aria-label="Delete space"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[12px] leading-5 text-slate-500 shadow-soft">
            <p className="mb-1 font-semibold text-slate-700">How retrieval works</p>
            <p>
              Chunks are scored with BM25 + TF-IDF cosine on the server-free
              path. When your gateway exposes <code>/embeddings</code>, vector
              similarity is blended in automatically.
            </p>
          </div>
        </aside>

        {/* Documents --------------------------------------------------- */}
        <section className="space-y-4">
          {effectiveSpaceId ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                    {spaces.find((space) => space.id === effectiveSpaceId)?.name}
                  </h2>
                  <p className="text-[12px] text-slate-500">
                    {spaceDocs.length} document
                    {spaceDocs.length === 1 ? "" : "s"} ·{" "}
                    {chunkCountFor(effectiveSpaceId)} chunk
                    {chunkCountFor(effectiveSpaceId) === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter documents"
                      className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-8.5 pr-3 text-[13px] outline-none transition focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
                      style={{ paddingLeft: "2.125rem" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-soft transition hover:opacity-95"
                  >
                    <Upload className="h-4 w-4" />
                    Upload
                  </button>
                </div>
              </div>

              {/* Drop zone --------------------------------------------- */}
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void handleFiles(event.dataTransfer.files);
                }}
                className={cn(
                  "rounded-2xl border-2 border-dashed p-6 text-center transition",
                  dragActive
                    ? "border-purple-400 bg-purple-50/70"
                    : "border-slate-200 bg-white/60 hover:border-slate-300",
                )}
              >
                <Upload
                  className={cn(
                    "mx-auto h-6 w-6 transition",
                    dragActive ? "text-purple-500" : "text-slate-300",
                  )}
                />
                <p className="mt-2 text-[13px] font-medium text-slate-700">
                  Drop files to index into this Space
                </p>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  {ACCEPTED_FILE_EXTENSIONS.join(" · ")} — parsed locally, never
                  uploaded to our servers.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void handleFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>

              {/* Progress -------------------------------------------- */}
              <AnimatePresence>
                {ingestProgress.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-slate-700">
                        Ingestion
                      </span>
                      <button
                        type="button"
                        onClick={clearIngestProgress}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Clear progress"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {ingestProgress.map((progress) => (
                      <div
                        key={progress.fileName}
                        className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-[12px] font-medium text-slate-700">
                            {progress.fileName}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-[11px] font-semibold",
                              progress.stage === "error"
                                ? "text-rose-500"
                                : progress.stage === "done"
                                  ? "text-emerald-600"
                                  : "text-purple-600",
                            )}
                          >
                            {STAGE_LABELS[progress.stage]}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <motion.div
                            className={cn(
                              "h-full rounded-full",
                              progress.stage === "error"
                                ? "bg-rose-400"
                                : progress.stage === "done"
                                  ? "bg-emerald-500"
                                  : "bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600",
                            )}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round(progress.percent * 100)}%` }}
                            transition={{ duration: 0.35, ease: "easeOut" }}
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          {progress.error ?? progress.message}
                        </p>
                      </div>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Document list ---------------------------------------- */}
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
                {filteredDocs.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <FileText className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-3 text-[13px] font-medium text-slate-600">
                      No documents yet
                    </p>
                    <p className="mt-1 text-[12px] text-slate-400">
                      Drop a file above to start building this Space.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50/80"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-slate-800">
                            {doc.fileName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {doc.chunkCount} chunk
                            {doc.chunkCount === 1 ? "" : "s"} ·{" "}
                            {formatBytes(doc.size)} · {doc.charCount.toLocaleString()}{" "}
                            chars · {formatRelativeTime(doc.createdAt)}
                            {doc.embedded ? (
                              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" /> embedded
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${doc.fileName}" and its chunks?`,
                              )
                            ) {
                              deleteDocument(doc.id);
                            }
                          }}
                          className="rounded-lg p-2 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                          aria-label="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-20 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
              <p className="mt-3 text-[13px] text-slate-500">
                Preparing your Spaces…
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SpacesManager;
