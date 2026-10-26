/**
 * Client-side chat streaming.
 *
 * Two transports are supported:
 *
 *  - `streamViaServer` posts to our own `/api/chat` route, which uses the
 *    Vercel AI SDK (`@ai-sdk/openai`) to talk to the Kilo Code gateway and
 *    relays the UI message stream back.
 *  - `streamDirect` calls the OpenAI-compatible gateway straight from the
 *    browser. This is what "Private mode" uses: the API key never leaves the
 *    device. If the gateway does not allow cross-origin requests the caller
 *    falls back to the server transport.
 */

import type { RetrievedChunk } from "./types";

export interface ChatRequestMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface RagChunkPayload {
  documentName: string;
  spaceName: string;
  content: string;
  score: number;
}

export interface StreamChatParams {
  messages: ChatRequestMessage[];
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  systemPrompt: string;
  ragContextChunks: RagChunkPayload[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onMetadata?: (metadata: StreamMetadata) => void;
}

export interface StreamMetadata {
  sources?: RetrievedChunk[];
  modelId?: string;
  baseUrl?: string;
}

export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

/* -------------------------------------------------------------------------- */
/* SSE helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Splits a raw text buffer into complete SSE data payloads. */
export function splitSseData(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  let rest = buffer;

  while (true) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5).trim();
      if (value) data.push(value);
    }
  }

  return { data, rest };
}

/* -------------------------------------------------------------------------- */
/* Server transport                                                           */
/* -------------------------------------------------------------------------- */

export async function streamViaServer(params: StreamChatParams): Promise<void> {
  const uiMessages = params.messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text" as const, text: message.content }],
  }));

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: params.signal,
      body: JSON.stringify({
        id: "workspace-chat",
        trigger: "submit-message",
        messages: uiMessages,
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        modelId: params.modelId,
        temperature: params.temperature,
        systemPrompt: params.systemPrompt,
        ragContextChunks: params.ragContextChunks,
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw new ChatStreamError(
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while contacting the server.",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string };
      detail = payload.error ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new ChatStreamError(
      detail || `The gateway responded with ${response.status}.`,
      response.status,
    );
  }

  if (!response.body) {
    throw new ChatStreamError("The server returned an empty response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { data, rest } = splitSseData(buffer);
      buffer = rest;

      for (const payload of data) {
        if (payload === "[DONE]") continue;
        handleUiChunk(payload, params);
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

function handleUiChunk(payload: string, params: StreamChatParams): void {
  let chunk: {
    type?: string;
    delta?: string;
    errorText?: string;
    messageMetadata?: StreamMetadata;
  };
  try {
    chunk = JSON.parse(payload) as typeof chunk;
  } catch {
    return;
  }

  switch (chunk.type) {
    case "text-delta":
      if (typeof chunk.delta === "string" && chunk.delta.length > 0) {
        params.onDelta(chunk.delta);
      }
      break;
    case "message-metadata":
    case "start":
    case "finish":
      if (chunk.messageMetadata) {
        params.onMetadata?.(chunk.messageMetadata as StreamMetadata);
      }
      break;
    case "error":
      throw new ChatStreamError(
        chunk.errorText || "The model stream reported an error.",
      );
    default:
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Direct transport (private mode)                                            */
/* -------------------------------------------------------------------------- */

export class DirectTransportUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectTransportUnavailable";
  }
}

/**
 * Streams straight from the OpenAI-compatible gateway.
 *
 * Throws `DirectTransportUnavailable` when the browser blocks the request
 * (CORS / offline), so the caller can transparently fall back to the server.
 */
export async function streamDirect(params: StreamChatParams): Promise<void> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const systemMessage = buildDirectSystemPrompt(
    params.systemPrompt,
    params.ragContextChunks,
  );

  const body = {
    model: params.modelId,
    stream: true,
    messages: [
      { role: "system", content: systemMessage },
      ...params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    ...(params.temperature !== undefined && !isReasoningModel(params.modelId)
      ? { temperature: params.temperature }
      : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      signal: params.signal,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw new DirectTransportUnavailable(
      error instanceof Error
        ? `The gateway rejected a direct browser request (${error.message}).`
        : "The gateway rejected a direct browser request.",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as {
        error?: { message?: string } | string;
        message?: string;
      };
      if (typeof payload.error === "string") detail = payload.error;
      else if (payload.error?.message) detail = payload.error.message;
      else if (payload.message) detail = payload.message;
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new ChatStreamError(
      detail || `The gateway responded with ${response.status}.`,
      response.status,
    );
  }

  if (!response.body) {
    throw new ChatStreamError("The gateway returned an empty response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { data, rest } = splitSseData(buffer);
      buffer = rest;

      for (const payload of data) {
        if (payload === "[DONE]") continue;
        let chunk: {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(payload) as typeof chunk;
        } catch {
          continue;
        }
        if (chunk.error?.message) {
          throw new ChatStreamError(chunk.error.message);
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) params.onDelta(delta);
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

function isReasoningModel(modelId: string): boolean {
  return /(deepseek.*r1|o1|o3|o4|gpt-5|reasoning|thinking)/i.test(modelId);
}

/** Mirrors the server-side system prompt assembly for the direct transport. */
export function buildDirectSystemPrompt(
  systemPrompt: string,
  chunks: RagChunkPayload[],
): string {
  const base = systemPrompt.trim();
  if (chunks.length === 0) return base;

  const blocks = chunks
    .map(
      (chunk, index) =>
        `<source id="${index + 1}" document="${chunk.documentName}" space="${chunk.spaceName}">\n${chunk.content}\n</source>`,
    )
    .join("\n\n");

  return [
    base,
    "",
    "<knowledge_base>",
    "Excerpts retrieved from the user's Space. Ground your answer in them and cite the",
    "source document by name in square brackets, e.g. [Brokerage-Handbook.pdf].",
    "",
    blocks,
    "</knowledge_base>",
  ].join("\n");
}
