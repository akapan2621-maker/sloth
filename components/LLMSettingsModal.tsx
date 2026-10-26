"use client";

import {
  Check,
  CircleAlert,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import ModelCombobox from "@/components/ui/ModelCombobox";
import { getProviderPreset, PROVIDER_PRESETS } from "@/lib/constants";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { ConnectionTestState } from "@/lib/types";
import { cn, normaliseBaseUrl } from "@/lib/utils";

interface LLMSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-slate-800">{label}</label>
        {hint ? (
          <span className="text-[11px] text-slate-400">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-100";

export function LLMSettingsModal({ open, onClose }: LLMSettingsModalProps) {
  const {
    settings,
    updateSettings,
    setModelId,
    addModelId,
    removeModelId,
  } = useWorkspace();

  const [apiKeyDraft, setApiKeyDraft] = useState(settings.apiKey);
  const [baseUrlDraft, setBaseUrlDraft] = useState(settings.baseUrl);
  const [modelDraft, setModelDraft] = useState(settings.modelId);
  const [test, setTest] = useState<ConnectionTestState>({ status: "idle" });

  // Model catalogue served by the connected gateway (GET /models).
  const [gatewayModels, setGatewayModels] = useState<string[]>([]);
  const [modelsState, setModelsState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "ok" } | { status: "error"; message: string }
  >({ status: "idle" });

  const loadGatewayModels = useCallback(async (baseUrl: string, apiKey: string) => {
    const normalised = normaliseBaseUrl(baseUrl);
    if (!normalised) return;
    setModelsState({ status: "loading" });
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: normalised, apiKey }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        models?: string[];
      };
      if (payload.ok && payload.models) {
        setGatewayModels(payload.models);
        setModelsState({ status: "ok" });
      } else {
        setModelsState({
          status: "error",
          message: payload.message ?? "Could not load the model list.",
        });
      }
    } catch (error) {
      setModelsState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Could not load the model list.",
      });
    }
  }, []);

  // On open: reset the drafts from what is actually saved (so a Cancelled
  // edit never lingers), then pull the gateway's catalogue so the dropdown
  // reflects what the provider really serves. Without a key we skip the
  // fetch - the Test button and the refresh icon populate the list instead.
  useEffect(() => {
    if (!open) return;
    setApiKeyDraft(settings.apiKey);
    setBaseUrlDraft(settings.baseUrl);
    setModelDraft(settings.modelId);
    setTest({ status: "idle" });
    if (!settings.apiKey.trim()) return;
    if (!normaliseBaseUrl(settings.baseUrl)) return;
    void loadGatewayModels(settings.baseUrl, settings.apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const provider = useMemo(
    () => getProviderPreset(settings.providerId),
    [settings.providerId],
  );

  // What the dropdown offers: the live gateway catalogue when we have it,
  // otherwise the preset's suggestions, always topped up with the ids the
  // user pinned (so a saved id never disappears from the list).
  const modelOptions = useMemo(() => {
    const base = gatewayModels.length > 0 ? gatewayModels : provider.models;
    return Array.from(
      new Set([...settings.savedModelIds, ...base, settings.modelId].filter(Boolean)),
    );
  }, [gatewayModels, provider.models, settings.savedModelIds, settings.modelId]);

  const dirty =
    apiKeyDraft !== settings.apiKey ||
    normaliseBaseUrl(baseUrlDraft) !== settings.baseUrl ||
    modelDraft !== settings.modelId;

  const selectProvider = (id: string) => {
    const preset = getProviderPreset(id);
    updateSettings({
      providerId: preset.id,
      baseUrl: preset.baseUrl,
      modelId: settings.savedModelIds.includes(preset.defaultModelId)
        ? settings.modelId
        : preset.defaultModelId,
    });
    setBaseUrlDraft(preset.baseUrl);
    setTest({ status: "idle" });
    // The new endpoint serves a different catalogue - refresh the dropdown.
    void loadGatewayModels(preset.baseUrl, apiKeyDraft);
  };

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      const response = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: normaliseBaseUrl(baseUrlDraft),
          apiKey: apiKeyDraft,
          modelId: modelDraft,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message: string;
        latencyMs?: number;
        models?: string[];
      };
      if (payload.ok) {
        setTest({
          status: "ok",
          message: `${payload.message} · ${payload.latencyMs ?? 0}ms`,
          latencyMs: payload.latencyMs,
        });
        // The test round-trip already returns the catalogue - reuse it so the
        // dropdown is fresh right after a successful connection test.
        if (payload.models && payload.models.length > 0) {
          setGatewayModels(payload.models);
          setModelsState({ status: "ok" });
        }
      } else {
        setTest({ status: "error", message: payload.message });
      }
    } catch (error) {
      setTest({
        status: "error",
        message:
          error instanceof Error ? error.message : "Connection test failed.",
      });
    }
  };

  const saveAll = () => {
    updateSettings({
      apiKey: apiKeyDraft.trim(),
      baseUrl: normaliseBaseUrl(baseUrlDraft),
    });
    if (modelDraft.trim()) setModelId(modelDraft.trim());
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="LLM & Kilo API Settings"
      subtitle="Point the workspace at any OpenAI-compatible gateway. Changes are stored in this browser."
      icon={<Settings2 className="h-4.5 w-4.5" />}
      width="max-w-3xl"
    >
      <div className="space-y-7">
        {/* Provider presets --------------------------------------------- */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Provider
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDER_PRESETS.map((preset) => {
              const active = preset.id === settings.providerId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectProvider(preset.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition",
                    active
                      ? "border-purple-300 bg-purple-50/60 ring-4 ring-purple-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
                      active
                        ? "border-purple-600 bg-purple-600"
                        : "border-slate-300 bg-white",
                    )}
                  >
                    {active ? (
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-900">
                      {preset.label}
                      {preset.id === "kilo" ? (
                        <span className="ml-2 rounded-full bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-2 py-0.5 align-middle text-[10px] font-semibold text-white">
                          Default
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {preset.baseUrl}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Endpoint + key ----------------------------------------------- */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Endpoint
          </h3>

          <Field
            label="Base URL"
            hint="OpenAI-compatible, ends with /v1"
          >
            <input
              className={inputClass}
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              placeholder={provider.baseUrl}
              aria-label="Base URL"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <Field label="API Key" hint={provider.keyHint}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  className={`${inputClass} pl-10`}
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  placeholder="sk-…"
                  aria-label="API Key"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                onClick={runTest}
                disabled={test.status === "testing"}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                {test.status === "testing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Test
              </button>
            </div>
          </Field>

          {test.status === "ok" ? (
            <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">
              <Check className="h-4 w-4 shrink-0" />
              {test.message}
            </p>
          ) : null}
          {test.status === "error" ? (
            <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{test.message}</span>
            </p>
          ) : null}

          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-5 text-slate-500">
            The key is stored in this browser only (<code>localStorage</code>) and
            sent with each request. If the server has{" "}
            <code>KILO_API_KEY</code> set, that is used as a fallback.
          </p>
        </section>

        {/* Model manager ------------------------------------------------ */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Model
          </h3>

          <Field
            label="Model ID"
            hint={
              gatewayModels.length > 0
                ? `${gatewayModels.length} models from ${provider.label}`
                : "Any id your gateway supports"
            }
          >
            <div className="flex gap-2">
              <ModelCombobox
                className="min-w-0 flex-1"
                value={modelDraft}
                onChange={setModelDraft}
                onSelect={(id) => {
                  setModelId(id);
                }}
                options={modelOptions}
                loading={modelsState.status === "loading"}
                error={modelsState.status === "error" ? modelsState.message : null}
                onRefresh={() => loadGatewayModels(baseUrlDraft, apiKeyDraft)}
                sourceLabel={provider.label}
                placeholder="Type to search models…"
              />
              <button
                type="button"
                onClick={() => {
                  if (!modelDraft.trim()) return;
                  addModelId(modelDraft.trim());
                  setModelId(modelDraft.trim());
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2.5 text-[13px] font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Save
              </button>
            </div>
          </Field>

          <div>
            <p className="mb-2 text-[12px] font-medium text-slate-500">
              Quick-switch list ({settings.savedModelIds.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {settings.savedModelIds.map((id) => {
                const active = id === settings.modelId;
                return (
                  <span
                    key={id}
                    className={cn(
                      "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
                      active
                        ? "border-transparent bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setModelId(id);
                        setModelDraft(id);
                      }}
                      className="flex items-center gap-1.5"
                    >
                      {active ? <Zap className="h-3 w-3" /> : null}
                      {id}
                    </button>
                    {settings.savedModelIds.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove ${id}`}
                        onClick={() => removeModelId(id)}
                        className={cn(
                          "rounded-full p-0.5 transition",
                          active
                            ? "text-white/70 hover:bg-white/20 hover:text-white"
                            : "text-slate-300 hover:bg-slate-100 hover:text-rose-500",
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                );
              })}
              {settings.savedModelIds.length === 0 ? (
                <span className="text-[12px] text-slate-400">
                  Save a model id above to pin it here.
                </span>
              ) : null}
            </div>
          </div>

          {/* Offline fallback only - once the live catalogue is loaded the
              dropdown above already lists everything the gateway serves. */}
          {gatewayModels.length === 0 ? (
            <div>
              <p className="mb-2 text-[12px] font-medium text-slate-500">
                Suggested by {provider.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {provider.models.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setModelDraft(id);
                      addModelId(id);
                      setModelId(id);
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-600 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Generation defaults ------------------------------------------ */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Generation
          </h3>

          <Field
            label="Temperature"
            hint={`${settings.temperature.toFixed(2)}`}
          >
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.temperature}
              onChange={(event) =>
                updateSettings({ temperature: Number(event.target.value) })
              }
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-purple-600"
            />
          </Field>

          <Field label="Top-K chunks retrieved" hint={`${settings.topK}`}>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={settings.topK}
              onChange={(event) =>
                updateSettings({ topK: Number(event.target.value) })
              }
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-purple-600"
            />
          </Field>

          <Field label="System prompt override" hint="Optional">
            <textarea
              className={`${inputClass} min-h-[120px] resize-y font-mono text-[12px] leading-5`}
              value={settings.systemPrompt}
              onChange={(event) =>
                updateSettings({ systemPrompt: event.target.value })
              }
              placeholder="Leave blank to use the default workspace prompt."
              spellCheck={false}
            />
          </Field>
        </section>

        {/* Footer ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <p className="flex items-center gap-2 text-[12px] text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
            Changes apply to the next message.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAll}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-soft transition hover:opacity-95"
            >
              {dirty ? "Save changes" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default LLMSettingsModal;
