"use client";

import { ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface ModelComboboxProps {
  /** Current draft value (free text is always allowed). */
  value: string;
  onChange: (value: string) => void;
  /** Called when the user explicitly picks an option. */
  onSelect: (id: string) => void;
  /** Candidate ids fetched from the connected gateway. */
  options: string[];
  loading?: boolean;
  /** Shown when the gateway list could not be loaded. */
  error?: string | null;
  onRefresh?: () => void;
  placeholder?: string;
  /** The label of the provider the list came from. */
  sourceLabel: string;
  className?: string;
  "aria-label"?: string;
}

const MAX_VISIBLE = 80;

/**
 * Searchable combobox for picking a model id from the list the connected
 * gateway actually serves. Typing filters the list; free text stays valid so
 * any id the gateway accepts can still be typed by hand.
 */
export function ModelCombobox({
  value,
  onChange,
  onSelect,
  options,
  loading = false,
  error = null,
  onRefresh,
  placeholder = "Type to search models…",
  sourceLabel,
  className,
  "aria-label": ariaLabel = "Model ID",
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const query = value.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return options;
    return options.filter((id) => id.toLowerCase().includes(query));
  }, [options, query]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const hiddenCount = matches.length - visible.length;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[cursor] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const pick = (id: string) => {
    onSelect(id);
    onChange(id);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Only swallow Escape while the list is open so it closes the dropdown
      // instead of the whole settings modal.
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setCursor(0);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setCursor((current) =>
        matches.length === 0
          ? 0
          : (current + delta + matches.length) % matches.length,
      );
      return;
    }
    if (event.key === "Enter" && open && visible[cursor]) {
      event.preventDefault();
      pick(visible[cursor]);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm transition focus-within:border-purple-400 focus-within:ring-4 focus-within:ring-purple-100">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          role="combobox"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm text-slate-900 outline-none placeholder:font-sans placeholder:text-slate-400"
        />
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-purple-500" />
        ) : onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh model list"
            title={`Reload the model list from ${sourceLabel}`}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition",
            open && "rotate-180",
          )}
        />
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-medium text-slate-500">
              {loading
                ? `Loading models from ${sourceLabel}…`
                : `${matches.length} of ${options.length} models · ${sourceLabel}`}
            </span>
            {hiddenCount > 0 ? (
              <span className="text-[10px] text-slate-400">
                showing {MAX_VISIBLE}
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="px-3 py-3 text-[12px] leading-5 text-rose-600">
              {error}
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="ml-1.5 font-medium underline underline-offset-2 hover:text-rose-800"
                >
                  Retry
                </button>
              ) : null}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-slate-400">
              No model matches &ldquo;{value.trim()}&rdquo; — press Enter on the
              input to use it as a custom id.
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Available models"
              className="max-h-64 overflow-y-auto py-1"
            >
              {visible.map((id, index) => {
                const active = index === cursor;
                const selected = id === value;
                return (
                  <li key={id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      // mousedown would close the list via the outside-click
                      // handler before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[12.5px] transition",
                        active ? "bg-purple-50 text-purple-800" : "text-slate-600",
                        selected && "font-semibold text-purple-700",
                      )}
                    >
                      <span className="truncate">{id}</span>
                      {selected ? (
                        <span className="ml-auto shrink-0 font-sans text-[10px] font-semibold uppercase tracking-wide text-purple-500">
                          current
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {hiddenCount > 0 ? (
                <li className="px-3 py-1.5 text-[11px] text-slate-400">
                  …and {hiddenCount} more — keep typing to narrow down
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ModelCombobox;
