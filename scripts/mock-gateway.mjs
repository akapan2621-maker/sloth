/**
 * Mock OpenAI-compatible gateway used to verify the streaming pipeline
 * without a real provider key. Run: node scripts/mock-gateway.mjs
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PORT ?? 4545);

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "mock-model" }, { id: "anthropic/claude-3.7-sonnet" }],
        }),
      );
      return;
    }

    if (req.url.endsWith("/embeddings")) {
      const parsed = body ? JSON.parse(body) : {};
      const values = parsed.input ?? parsed.values ?? [];
      const list = Array.isArray(values) ? values : [values];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          model: parsed.model ?? "mock-embedding",
          data: list.map((value, index) => {
            // Deterministic pseudo-embedding so vectors are comparable.
            const vector = [];
            for (let i = 0; i < 8; i += 1) {
              let hash = index * 31 + i * 7;
              for (let c = 0; c < String(value).length; c += 1) {
                hash = (hash * 31 + String(value).charCodeAt(c)) % 100000;
              }
              vector.push((hash % 1000) / 1000);
            }
            return { object: "embedding", index, embedding: vector };
          }),
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      );
      return;
    }

    if (req.url.endsWith("/chat/completions")) {
      const parsed = body ? JSON.parse(body) : {};
      const system = parsed.messages?.[0]?.content ?? "";
      const hasContext = system.includes("<knowledge_base>");
      const user = parsed.messages?.[1]?.content ?? "";

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const chunks = [
        "Based on the retrieved excerpts, ",
        `here is the answer to "${user.slice(0, 40)}".`,
        hasContext ? "\n\n[handbook.txt]" : "\n\n(no context)",
      ];

      let index = 0;
      const timer = setInterval(() => {
        if (index >= chunks.length) {
          res.write("data: [DONE]\n\n");
          res.end();
          clearInterval(timer);
          return;
        }
        res.write(
          `data: ${JSON.stringify({
            id: "mock",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: chunks[index] } }],
          })}\n\n`,
        );
        index += 1;
      }, 30);

      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

server.listen(port, () => {
  console.log(`mock gateway listening on http://127.0.0.1:${port}/v1`);
});
