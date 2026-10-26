import { KILO_DEFAULT_BASE_URL } from "@/lib/constants";
import { normaliseBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ModelsRequestBody {
  baseUrl?: string;
  apiKey?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Lists the model ids exposed by an OpenAI-compatible gateway by calling
 * `GET /models`. Used to populate the searchable model dropdown in the
 * settings modal. The API key is optional here - some gateways (e.g. Kilo)
 * serve the catalogue without authentication.
 */
export async function POST(request: Request): Promise<Response> {
  let body: ModelsRequestBody;
  try {
    body = (await request.json()) as ModelsRequestBody;
  } catch {
    return json({ ok: false, message: "Invalid JSON body." }, 400);
  }

  const baseUrl = normaliseBaseUrl(
    body.baseUrl?.trim() || process.env.KILO_BASE_URL?.trim() || KILO_DEFAULT_BASE_URL,
  );
  const apiKey = body.apiKey?.trim() || process.env.KILO_API_KEY?.trim() || "";

  if (!baseUrl) {
    return json({ ok: false, message: "A base URL is required." }, 400);
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return json({
        ok: false,
        message: `Gateway responded with ${response.status} ${response.statusText}. ${
          detail ? detail.slice(0, 240) : ""
        }`.trim(),
        latencyMs: Date.now() - startedAt,
      });
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ id?: unknown }>;
    } | null;

    const models = (payload?.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

    // Large gateways (Kilo lists 400+) would bloat the dropdown for no benefit.
    return json({
      ok: true,
      models: models.slice(0, 500),
      total: models.length,
      latencyMs: Date.now() - startedAt,
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
