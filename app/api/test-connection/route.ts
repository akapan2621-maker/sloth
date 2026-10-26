import { KILO_DEFAULT_BASE_URL } from "@/lib/constants";
import { normaliseBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TestRequestBody {
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
 * Validates the gateway credentials by calling the OpenAI-compatible
 * `GET /models` endpoint. Falls back to a minimal chat completion when the
 * gateway does not implement `/models`.
 */
export async function POST(request: Request): Promise<Response> {
  let body: TestRequestBody;
  try {
    body = (await request.json()) as TestRequestBody;
  } catch {
    return json({ ok: false, message: "Invalid JSON body." }, 400);
  }

  const baseUrl = normaliseBaseUrl(
    body.baseUrl?.trim() || process.env.KILO_BASE_URL?.trim() || KILO_DEFAULT_BASE_URL,
  );
  const apiKey = body.apiKey?.trim() || process.env.KILO_API_KEY?.trim() || "";

  if (!apiKey) {
    return json(
      { ok: false, message: "Enter an API key before testing the connection." },
      400,
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const latencyMs = Date.now() - startedAt;

    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        data?: Array<{ id?: string }>;
      } | null;
      const models = (payload?.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string");

      return json({
        ok: true,
        message: `Connected to ${baseUrl}`,
        latencyMs,
        models: models.slice(0, 200),
      });
    }

    const detail = await response.text().catch(() => "");
    return json({
      ok: false,
      message: `Gateway responded with ${response.status} ${response.statusText}. ${
        detail ? detail.slice(0, 240) : ""
      }`.trim(),
      latencyMs,
    });
  } catch (error) {
    return json({
      ok: false,
      message:
        error instanceof Error
          ? `Could not reach ${baseUrl}: ${error.message}`
          : "Could not reach the gateway.",
      latencyMs: Date.now() - startedAt,
    });
  }
}
