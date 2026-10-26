import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

import { EMBEDDING_MODEL_CANDIDATES, KILO_DEFAULT_BASE_URL } from "@/lib/constants";
import { normaliseBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EmbeddingsRequestBody {
  values?: string[];
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Embeds text using the configured OpenAI-compatible gateway.
 *
 * The Kilo Code gateway exposes an OpenAI-compatible `/v1/embeddings`
 * endpoint. When it does not support embeddings we transparently try the
 * free Google `text-embedding-004` model when a Gemini key is present.
 */
export async function POST(request: Request): Promise<Response> {
  let body: EmbeddingsRequestBody;
  try {
    body = (await request.json()) as EmbeddingsRequestBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  // Keep the vector count identical to the input count - the client aligns
  // vectors to chunks by index, so silently dropping values would corrupt it.
  const values = (body.values ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, 8000));

  if (values.length === 0) {
    return json({ available: false, embeddings: [], error: "No values supplied." }, 400);
  }

  const baseUrl = normaliseBaseUrl(
    body.baseUrl?.trim() || process.env.KILO_BASE_URL?.trim() || KILO_DEFAULT_BASE_URL,
  );
  const apiKey = body.apiKey?.trim() || process.env.KILO_API_KEY?.trim() || "";
  const requestedModel = body.modelId?.trim() || "";

  const attempts: { baseUrl: string; apiKey: string; modelId: string }[] = [];

  if (requestedModel) {
    attempts.push({ baseUrl, apiKey, modelId: requestedModel });
  }
  for (const candidate of EMBEDDING_MODEL_CANDIDATES) {
    if (candidate === requestedModel) continue;
    if (attempts.some((a) => a.modelId === candidate && a.baseUrl === baseUrl)) continue;
    attempts.push({ baseUrl, apiKey, modelId: candidate });
  }

  if (process.env.GEMINI_API_KEY) {
    attempts.push({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY.trim(),
      modelId: "text-embedding-004",
    });
  }

  const errors: string[] = [];
  /**
   * Failures that will never succeed no matter how often we retry (no such
   * endpoint, bad credentials, unknown model, out of credit). Anything else -
   * timeouts, 5xx, rate limits - is transient and must not disable vector
   * mode.
   */
  const DEFINITIVE_FAILURE =
    /\b(404|401|403|400|402|422)\b|not\s*found|does\s*not\s*support|unknown\s*(model|endpoint)|invalid\s*(api[_ ]?key|model|request)|add\s*credits|payment|billing|insufficient\s*credit/i;
  let definitiveFailures = 0;
  let transientFailures = 0;

  for (const attempt of attempts) {
    if (!attempt.apiKey) continue;
    try {
      const openai = createOpenAI({
        baseURL: attempt.baseUrl,
        apiKey: attempt.apiKey,
      });
      const result = await embedMany({
        model: openai.embedding(attempt.modelId),
        values,
      });
      return json({
        available: true,
        embeddings: result.embeddings,
        modelId: attempt.modelId,
        dimensions: result.embeddings[0]?.length ?? 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`${attempt.modelId} @ ${attempt.baseUrl}: ${message}`);
      if (DEFINITIVE_FAILURE.test(message)) definitiveFailures += 1;
      else transientFailures += 1;
    }
  }

  // Every attempt failed transiently (timeout / rate limit / 5xx). Report a
  // retryable error so the client keeps vector mode armed and retries later
  // instead of treating the gateway as permanently without embeddings.
  if (transientFailures > 0) {
    return json(
      {
        available: false,
        retryable: true,
        embeddings: [],
        modelId: null,
        dimensions: 0,
        error: "The embedding endpoint failed transiently. Retrying may succeed.",
        details: errors,
      },
      502,
    );
  }

  // The gateway has no embedding endpoint. This is a normal outcome (Mode 1
  // lexical retrieval is used instead), so it is reported with a 200 status
  // rather than an error status the browser would log as a failed request.
  return json({
    available: false,
    embeddings: [],
    modelId: null,
    dimensions: 0,
    error:
      "No embedding endpoint is available on the configured gateway. Falling back to keyword retrieval.",
    details: errors,
  });
}
