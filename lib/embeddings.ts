/**
 * Embedding helpers (Mode 2 - vector retrieval).
 *
 * Embeddings are produced by the configured OpenAI-compatible gateway via
 * `/api/embeddings`. When no embedding endpoint is available the callers
 * fall back to the zero-setup lexical retrieval (Mode 1).
 *
 * Large documents are embedded in small batches: a single request holding
 * thousands of chunks exceeds every gateway's payload/time limits, which used
 * to fail the whole ingest and silently disable vector retrieval.
 */

import type { LlmSettings } from "./types";

export interface EmbedResult {
  embeddings: number[][];
  modelId: string;
  dimensions: number;
}

export interface EmbedProgress {
  /** How many texts have been embedded so far. */
  done: number;
  /** Total number of texts supplied to this call. */
  total: number;
}

export interface EmbedOptions {
  /** Called after each batch settles - drives the ingest progress bar. */
  onProgress?: (progress: EmbedProgress) => void;
}

/** Texts per `/api/embeddings` request - keeps every payload comfortably small. */
export const EMBED_BATCH_SIZE = 64;
/** Hard per-request timeout so a hung gateway cannot stall an ingest forever. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Attempts per batch (with backoff) before the batch is halved or given up. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

/**
 * Set once the gateway has told us it has no embedding endpoint. The app then
 * stays in Mode 1 (lexical retrieval) instead of retrying on every query.
 * Transient failures (timeouts, 5xx, oversized payloads) never set this flag -
 * and saving new credentials resets it via `resetEmbeddingCapability()`.
 */
let embeddingsUnavailable = false;

export function areEmbeddingsUnavailable(): boolean {
  return embeddingsUnavailable;
}

export function resetEmbeddingCapability(): void {
  embeddingsUnavailable = false;
}

/** Splits values into batches of at most `size`, preserving order. */
export function splitIntoBatches(
  values: string[],
  size: number = EMBED_BATCH_SIZE,
): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size));
  }
  return batches;
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Raised when the gateway confirms it cannot serve embeddings at all. */
class EmbeddingsUnavailableError extends Error {}

type BatchOutcome =
  | { status: "ok"; result: EmbedResult }
  /** The gateway definitively has no embedding endpoint. */
  | { status: "unavailable" }
  /** Timeout / 5xx / rate limit - worth retrying later. */
  | { status: "transient" };

/** One HTTP round-trip, no retries. */
async function embedBatchOnce(
  values: string[],
  settings: Pick<LlmSettings, "baseUrl" | "apiKey">,
  modelId?: string,
): Promise<BatchOutcome> {
  try {
    const response = await fetch("/api/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        values,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        modelId,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Any non-2xx from the route is treated as retryable: the route returns
    // 502 when the gateway failed transiently and only ever answers 2xx for
    // definitive outcomes.
    if (!response.ok) {
      return { status: "transient" };
    }

    const payload = (await response.json()) as {
      available?: boolean;
      embeddings?: number[][];
      modelId?: string;
      dimensions?: number;
    };

    if (payload.available === false) {
      return { status: "unavailable" };
    }

    if (
      !Array.isArray(payload.embeddings) ||
      payload.embeddings.length !== values.length
    ) {
      return { status: "transient" };
    }

    return {
      status: "ok",
      result: {
        embeddings: payload.embeddings,
        modelId: payload.modelId ?? modelId ?? "unknown",
        dimensions: payload.dimensions ?? payload.embeddings[0]?.length ?? 0,
      },
    };
  } catch {
    // Network error or AbortSignal timeout - always retryable.
    return { status: "transient" };
  }
}

/**
 * Embeds one batch. Retries transient failures with backoff; if the batch
 * keeps failing it is halved (a smaller payload often succeeds where a large
 * one timed out) down to a single text.
 */
async function embedBatch(
  values: string[],
  settings: Pick<LlmSettings, "baseUrl" | "apiKey">,
  modelId?: string,
): Promise<EmbedResult | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const outcome = await embedBatchOnce(values, settings, modelId);
    if (outcome.status === "ok") return outcome.result;
    if (outcome.status === "unavailable") throw new EmbeddingsUnavailableError();
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }

  if (values.length > 1) {
    const half = Math.ceil(values.length / 2);
    const head = await embedBatch(values.slice(0, half), settings, modelId);
    if (!head) return null;
    const tail = await embedBatch(values.slice(half), settings, modelId);
    if (!tail) return null;
    return {
      embeddings: [...head.embeddings, ...tail.embeddings],
      modelId: head.modelId,
      dimensions: head.dimensions,
    };
  }

  // A single text still failed after every retry - give up on this call.
  return null;
}

/**
 * Embeds `values` in batches and returns the vectors in input order, or null
 * when they could not all be produced (callers then keep lexical retrieval).
 * The permanent "no embeddings" flag is only set when the gateway explicitly
 * confirms it has no embedding endpoint.
 */
export async function embedTexts(
  values: string[],
  settings: Pick<LlmSettings, "baseUrl" | "apiKey">,
  modelId?: string,
  options?: EmbedOptions,
): Promise<EmbedResult | null> {
  if (values.length === 0) return null;
  if (embeddingsUnavailable) return null;

  try {
    const batches = splitIntoBatches(values);
    const merged: number[][] = [];
    // The first successful batch tells us which embedding model the gateway
    // picked - reuse it so later batches skip the model probe.
    let resolvedModel = modelId ?? "";
    let dimensions = 0;

    for (const batch of batches) {
      const result = await embedBatch(batch, settings, resolvedModel || modelId);
      // Transient give-up: keep lexical mode, leave the capability flag alone
      // so a later ingest or query can try vectors again.
      if (!result) return null;

      merged.push(...result.embeddings);
      if (!resolvedModel) resolvedModel = result.modelId;
      if (!dimensions) dimensions = result.dimensions;
      options?.onProgress?.({ done: merged.length, total: values.length });
    }

    if (merged.length !== values.length) return null;

    return {
      embeddings: merged,
      modelId: resolvedModel || "unknown",
      dimensions,
    };
  } catch (error) {
    if (error instanceof EmbeddingsUnavailableError) {
      embeddingsUnavailable = true;
    }
    return null;
  }
}
