import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { DEFAULT_SYSTEM_PROMPT, KILO_DEFAULT_BASE_URL } from "@/lib/constants";
import { normaliseBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Streaming budgets. Gateways occasionally accept a request and then go silent
 * (observed: a single completion hung for 534 seconds), which left the chat
 * stuck on a spinner forever. These bounds turn a stall into a visible error.
 */
const TOTAL_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS ?? 240_000);
const FIRST_CHUNK_TIMEOUT_MS = Number(process.env.CHAT_FIRST_CHUNK_MS ?? 60_000);
const CHUNK_TIMEOUT_MS = Number(process.env.CHAT_CHUNK_MS ?? 60_000);

interface RagChunkPayload {
  documentName?: string;
  spaceName?: string;
  content?: string;
  score?: number;
}

interface ChatRequestBody {
  id?: string;
  trigger?: string;
  messages?: UIMessage[];
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  ragContextChunks?: RagChunkPayload[];
  temperature?: number;
  systemPrompt?: string;
  topK?: number;
}

export interface SourceMeta {
  documentName: string;
  spaceName: string;
  content: string;
  score: number;
}

/** Models that reject an explicit `temperature` parameter. */
const REASONING_MODEL_PATTERN =
  /(deepseek.*r1|o1|o3|o4|gpt-5|reasoning|thinking)/i;

function buildSystemPrompt(
  override: string | undefined,
  chunks: RagChunkPayload[],
): string {
  const base = (override ?? "").trim() || DEFAULT_SYSTEM_PROMPT;
  if (chunks.length === 0) return base;

  const blocks = chunks
    .map((chunk, index) => {
      const document = chunk.documentName || "document";
      const space = chunk.spaceName || "Space";
      return `<source id="${index + 1}" document="${document}" space="${space}">\n${chunk.content ?? ""}\n</source>`;
    })
    .join("\n\n");

  return [
    base,
    "",
    "<knowledge_base>",
    "Excerpts retrieved from the user's Space. Ground your answer in them and cite the",
    "source document by name in square brackets, e.g. [Brokerage-Handbook.pdf].",
    "If the excerpts do not answer the question, say so and answer from general knowledge.",
    "",
    blocks,
    "</knowledge_base>",
  ].join("\n");
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return errorResponse("No messages supplied.", 400);
  }

  const baseUrl = normaliseBaseUrl(
    body.baseUrl?.trim() || process.env.KILO_BASE_URL?.trim() || KILO_DEFAULT_BASE_URL,
  );
  const apiKey = body.apiKey?.trim() || process.env.KILO_API_KEY?.trim() || "";
  const modelId = body.modelId?.trim() || process.env.KILO_MODEL_ID?.trim() || "";

  if (!modelId) {
    return errorResponse(
      "No model selected. Open “LLM & Kilo API Settings” and pick a model id.",
      400,
    );
  }

  if (!apiKey) {
    return errorResponse(
      "No API key available. Add your Kilo Code API key in “LLM & Kilo API Settings”.",
      401,
    );
  }

  const chunks = (body.ragContextChunks ?? []).filter(
    (chunk): chunk is RagChunkPayload & { content: string } =>
      typeof chunk?.content === "string" && chunk.content.trim().length > 0,
  );

  const system = buildSystemPrompt(body.systemPrompt, chunks);

  const rawTemperature =
    typeof body.temperature === "number" ? body.temperature : undefined;
  const temperature =
    rawTemperature !== undefined && !REASONING_MODEL_PATTERN.test(modelId)
      ? Math.min(2, Math.max(0, rawTemperature))
      : undefined;

  const openai = createOpenAI({ baseURL: baseUrl, apiKey });
  // `.chat()` targets the OpenAI-compatible `/chat/completions` endpoint.
  // Calling the provider directly would use the OpenAI Responses API, which
  // third-party gateways (Kilo Code, OpenRouter, Groq, …) do not implement.
  const model = openai.chat(modelId);

  let result;
  try {
    const modelMessages = await convertToModelMessages(messages);
    result = streamText({
      model,
      system,
      messages: modelMessages,
      ...(temperature !== undefined ? { temperature } : {}),
      abortSignal: request.signal,
      timeout: {
        totalMs: TOTAL_TIMEOUT_MS,
        firstChunkMs: FIRST_CHUNK_TIMEOUT_MS,
        chunkMs: CHUNK_TIMEOUT_MS,
      },
      onError: ({ error }) => {
        console.error("[api/chat] stream error:", error);
      },
      onAbort: () => {
        console.warn("[api/chat] stream aborted (client disconnected or timeout)");
      },
    });
  } catch (error) {
    console.error("[api/chat] failed to start stream:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to reach the model gateway.",
      502,
    );
  }

  const sourceMeta: SourceMeta[] = chunks.map((chunk) => ({
    documentName: chunk.documentName || "document",
    spaceName: chunk.spaceName || "Space",
    content: (chunk.content || "").slice(0, 400),
    score: typeof chunk.score === "number" ? chunk.score : 0,
  }));

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    sendStart: true,
    sendFinish: true,
    messageMetadata: ({ part }) => {
      if (part.type === "start" || part.type === "finish") {
        return {
          sources: sourceMeta,
          modelId,
          baseUrl,
        };
      }
      return undefined;
    },
    onError: (error) => {
      console.error("[api/chat] stream error:", error);
      return error instanceof Error ? error.message : "Unknown streaming error.";
    },
  });

  return createUIMessageStreamResponse({
    stream: stream as ReadableStream<never>,
    status: 200,
  });
}

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "amazon-quick-chat",
      hint: "POST { messages, baseUrl, apiKey, modelId, ragContextChunks, temperature }",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
