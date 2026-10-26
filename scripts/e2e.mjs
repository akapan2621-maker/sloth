/**
 * End-to-end test suite.
 *
 *   npm run e2e        (requires `npm run dev` + `npm run mock:gateway`)
 *
 * Covers the full user journey in a fresh browser profile:
 *   boot → view navigation → document ingestion (with embeddings) →
 *   space CRUD → gateway settings + connection test →
 *   RAG chats (with and without context, asserted at the request level) →
 *   regenerate → search palette → reload persistence → cleanup.
 */
import { chromium } from "playwright-core";
import path from "node:path";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const FIXTURE = path.join(process.cwd(), "fixtures", "trading-desk-handbook.md");
const SCRATCH_SPACE = "E2E Test Space";
const RENAMED_SPACE = "E2E Renamed";

const errors = [];
const warnings = [];
const chatRequests = []; // { rag: number|null, modelId, baseUrl }
const embeddingStatuses = [];
const failures = [];
let passed = 0;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("console", (message) => {
  const type = message.type();
  if (type === "error") errors.push(`console.error: ${message.text()}`);
  if (type === "warning") warnings.push(`console.warn: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  const failure = request.failure();
  if (failure && !/net::ERR_ABORTED/.test(failure.errorText)) {
    errors.push(`requestfailed: ${request.url()} ${failure.errorText}`);
  }
});

// Space rename uses window.prompt, deletion uses window.confirm.
page.on("dialog", async (dialog) => {
  if (dialog.type() === "prompt") await dialog.accept(RENAMED_SPACE);
  else await dialog.accept();
});

page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/chat")) {
    const record = { rag: null, modelId: null, baseUrl: null };
    try {
      const body = request.postDataJSON();
      record.rag = (body.ragContextChunks ?? []).length;
      record.modelId = body.modelId ?? null;
      record.baseUrl = body.baseUrl ?? null;
    } catch {
      /* keep nulls; the arrival of the request still counts */
    }
    chatRequests.push(record);
  }
});
page.on("response", (response) => {
  if (response.url().includes("/api/embeddings")) embeddingStatuses.push(response.status());
});

/** Closes any modal a failed step may have left open. */
const resetOverlays = async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
};

const step = async (name, fn) => {
  const errorsBefore = errors.length;
  try {
    await fn();
    const added = errors.length - errorsBefore;
    passed += 1;
    console.log(
      added === 0 ? `  PASS  ${name}` : `  PASS  ${name}  (${added} console error(s))`,
    );
  } catch (error) {
    const message = error?.message ?? String(error);
    failures.push({ name, message });
    console.log(`  FAIL  ${name}`);
    console.log(
      `        ${message.split("\n").slice(0, 6).join("\n        ")}`,
    );
  } finally {
    await resetOverlays();
  }
};

const expect = (condition, detail) => {
  if (!condition) throw new Error(detail ?? "expectation failed");
};

/** Waits until at least `min` chat requests have been observed. */
const waitForChatRequests = async (min, timeout = 45000) => {
  const started = Date.now();
  while (chatRequests.length < min) {
    if (Date.now() - started > timeout) {
      throw new Error(
        `expected ${min} chat request(s), saw ${chatRequests.length}`,
      );
    }
    await page.waitForTimeout(100);
  }
};

const lastChatRequest = () => chatRequests[chatRequests.length - 1];

/** Waits for this question's streamed answer (unique per question). */
const waitForAnswer = async (question) => {
  const needle = `answer to "${question.slice(0, 30)}`;
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    needle,
    { timeout: 45000 },
  );
};

/** Opens the SpacePicker dropdown and picks an option by visible label. */
const pickSpace = async (currentLabel, optionName) => {
  await page.getByText(currentLabel, { exact: true }).click();
  await page.getByRole("button", { name: optionName }).click();
};

const send = async (question) => {
  const before = chatRequests.length;
  await page.getByPlaceholder("Ask a question...").fill(question);
  await page.keyboard.press("Enter");
  await waitForChatRequests(before + 1);
  return lastChatRequest();
};

console.log(`\nE2E against ${APP_URL} (mock gateway on :4545)\n`);

/* -------------------------------------------------------------------------- */
/* Boot + navigation                                                           */
/* -------------------------------------------------------------------------- */

await step("boot: app loads and hydrates", async () => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Ready when you are, Akapan.", { timeout: 45000 });
  await page.waitForSelector("text=Sloth");
});

await step("navigation: Research / Chat agents / Apps views render", async () => {
  await page.getByRole("button", { name: "Research", exact: true }).first().click();
  await page.locator("header").first().getByText("Research", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Chat agents" }).first().click();
  await page.locator("header").first().getByText("Chat agents", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Apps" }).first().click();
  await page.locator("header").first().getByText("Apps", { exact: true }).waitFor();
});

/* -------------------------------------------------------------------------- */
/* Settings (before ingestion so embeddings are configured)                    */
/* -------------------------------------------------------------------------- */

await step("settings: connection test + gateway config saved", async () => {
  await page.getByRole("button", { name: "LLM & Kilo API" }).first().click();
  await page.waitForSelector("text=Kilo Code AI Gateway", { timeout: 20000 });

  await page.getByLabel("Base URL").fill("http://127.0.0.1:4545/v1");
  await page.getByLabel("API Key").fill("e2e-key");
  await page.getByLabel("Model ID").fill("mock-model");
  // Close the model dropdown so it cannot intercept later clicks.
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page
    .getByText(/Connected to http:\/\/127\.0\.0\.1:4545/)
    .waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: /Save changes/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);

  const header = await page.locator("header").first().innerText();
  expect(header.includes("mock-model"), `header badge missing, got: ${header.replace(/\n/g, " | ")}`);
});

/* -------------------------------------------------------------------------- */
/* Spaces: ingestion                                                           */
/* -------------------------------------------------------------------------- */

await step("spaces: upload indexes the fixture with embeddings", async () => {
  await page.getByRole("button", { name: /^Spaces/ }).first().click();
  await page.waitForSelector("text=XAUUSD & MT5 Research", { timeout: 20000 });

  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  // The done-stage label commits in the same render as document/chunks state.
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 30000 });

  const row = page.locator('li:has-text("trading-desk-handbook.md")').first();
  const meta = await row.innerText();
  expect(
    /[1-9]\d* chunks?/.test(meta),
    `expected a positive chunk count, got: ${meta}`,
  );
  expect(meta.includes("embedded"), `expected an "embedded" badge, got: ${meta}`);
  expect(
    embeddingStatuses.includes(200),
    `expected a 200 from /api/embeddings, saw: ${embeddingStatuses.join(", ") || "none"}`,
  );
});

await step("spaces: document filter narrows the list", async () => {
  const filter = page.getByPlaceholder("Filter documents");
  await filter.fill("handbook");
  await page.locator('li:has-text("trading-desk-handbook.md")').first().waitFor();

  await filter.fill("zzz-no-match");
  await page.waitForSelector("text=No documents yet", { timeout: 10000 });

  await filter.fill("");
  await page.locator('li:has-text("trading-desk-handbook.md")').first().waitFor();
});

await step("spaces: create a scratch space", async () => {
  await page.getByLabel("Create space").click();
  await page.getByPlaceholder("Space name").fill(SCRATCH_SPACE);
  await page.getByPlaceholder("Space name").press("Enter");
  await page
    .getByRole("heading", { name: SCRATCH_SPACE, level: 2 })
    .waitFor({ timeout: 10000 });
  await page.waitForSelector("text=No documents yet");
});

/* -------------------------------------------------------------------------- */
/* Chat + RAG                                                                  */
/* -------------------------------------------------------------------------- */

await step("chat: No Space sends zero RAG context (no sources drawer)", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.getByPlaceholder("Ask a question...").waitFor();

  const question = "Hello from the E2E suite";
  const request = await send(question);
  await waitForAnswer(question);

  expect(request.rag === 0, `expected 0 ragContextChunks, got ${request.rag}`);
  // The mock's final SSE chunk reveals whether the gateway got a
  // knowledge_base system prompt — wait for it instead of racing it.
  await page
    .getByText("(no context)")
    .first()
    .waitFor({ timeout: 45000 })
    .catch(() => {
      throw new Error("gateway was sent knowledge context on a No-Space chat");
    });
  const drawers = await page.getByText("Sources Used from Space").count();
  expect(drawers === 0, `expected no sources drawer, saw ${drawers}`);
});

await step("chat: All Spaces grounds the answer with retrievable sources", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await pickSpace("No Space", /All Spaces/);

  const question = "What is the maximum position size per trade?";
  const request = await send(question);
  await waitForAnswer(question);

  expect(request.rag > 0, `expected ragContextChunks > 0, got ${request.rag}`);
  // Mock's third SSE chunk echoes [handbook.txt] only when the system prompt
  // carried the knowledge_base block — wait for the full stream to land.
  await page
    .getByText("[handbook.txt]")
    .first()
    .waitFor({ timeout: 45000 })
    .catch(() => {
      throw new Error("gateway did not receive the knowledge_base block");
    });

  await page.getByText("Sources Used from Space").click();
  await page.waitForSelector('text=trading-desk-handbook.md', { timeout: 10000 });
  await page.screenshot({ path: "e2e-rag-drawer.png", fullPage: false });
});

await step("chat: a specific Space scopes retrieval", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await pickSpace("All Spaces", /XAUUSD & MT5 Research/);

  const question = "What invalidates a breakout setup?";
  const request = await send(question);
  await waitForAnswer(question);

  expect(request.rag > 0, `expected ragContextChunks > 0, got ${request.rag}`);
  const drawers = await page.getByText("Sources Used from Space").count();
  expect(drawers >= 1, "expected a sources drawer");
});

await step("chat: an empty Space returns no sources", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await pickSpace("XAUUSD & MT5 Research", new RegExp(SCRATCH_SPACE));

  const question = "Summarise this space for me";
  const request = await send(question);
  await waitForAnswer(question);

  expect(request.rag === 0, `expected 0 ragContextChunks, got ${request.rag}`);
  const drawers = await page.getByText("Sources Used from Space").count();
  expect(drawers === 0, `expected no sources drawer, saw ${drawers}`);
});

await step("chat: regenerate issues another completion", async () => {
  const before = chatRequests.length;
  await page.getByLabel("Regenerate answer").last().click();
  await waitForChatRequests(before + 1);
});

/* -------------------------------------------------------------------------- */
/* Search + navigation hand-off                                                */
/* -------------------------------------------------------------------------- */

await step("search: palette finds the indexed document and opens its Space", async () => {
  await page.keyboard.press("Control+k");
  await page
    .getByPlaceholder("Search conversations and documents")
    .waitFor({ timeout: 20000 });
  await page.getByPlaceholder("Search conversations and documents").fill("handbook");

  await page
    .getByRole("button", { name: /trading-desk-handbook\.md/ })
    .click({ timeout: 20000 });
  // Wait for the search modal to finish closing, otherwise its lingering
  // result button and the space list both match /XAUUSD/.
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"]').length === 0,
    undefined,
    { timeout: 10000 },
  );
  await page
    .locator("header")
    .first()
    .getByText("Spaces · Knowledge Base", { exact: true })
    .waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: /XAUUSD & MT5 Research/ }).click();
  await page
    .getByRole("heading", { name: "XAUUSD & MT5 Research", level: 2 })
    .waitFor({ timeout: 10000 });
  await page.locator('li:has-text("trading-desk-handbook.md")').first().waitFor();
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

await step("persistence: reload keeps settings, chats and indexed chunks", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Ready when you are, Akapan.", { timeout: 45000 });

  const header = await page.locator("header").first().innerText();
  expect(header.includes("mock-model"), "gateway settings lost after reload");
  await page.getByText(/maximum position size/).first().waitFor({ timeout: 10000 });

  // Retrieval still works after reload → chunks survived in IndexedDB.
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await pickSpace("No Space", /All Spaces/);
  const question = "How are stop losses placed?";
  const request = await send(question);
  await waitForAnswer(question);
  expect(request.rag > 0, `chunks lost after reload (rag=${request.rag})`);

  await page.getByRole("button", { name: /^Spaces/ }).first().click();
  await page.getByRole("button", { name: /XAUUSD & MT5 Research/ }).click();
  await page.locator('li:has-text("trading-desk-handbook.md")').first().waitFor();
  await page.getByRole("button", { name: new RegExp(SCRATCH_SPACE) }).waitFor();
});

/* -------------------------------------------------------------------------- */
/* Interrupted turn                                                            */
/* -------------------------------------------------------------------------- */

await step("chat: an interrupted answer shows a notice instead of spinning", async () => {
  // Simulate a turn that was cut off before any text arrived (page reload or
  // gateway stall). It used to render the "thinking" dots forever.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("amazon-quick-workspace");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["chats"], "readwrite");
          tx.objectStore("chats").put({
            id: "chat_e2e_interrupted",
            title: "Interrupted turn",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [
              { id: "m1", role: "user", content: "hello", createdAt: Date.now() },
              { id: "m2", role: "assistant", content: "", createdAt: Date.now() },
            ],
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .getByRole("button", { name: /Interrupted turn/ })
    .click({ timeout: 15000 });
  await page
    .getByText(/การตอบกลับถูกขัดจังหวะ/)
    .first()
    .waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /ลองอีกครั้ง/ }).first().waitFor({
    timeout: 10000,
  });
});

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                     */
/* -------------------------------------------------------------------------- */

await step("cleanup: rename and delete the scratch space", async () => {
  // The previous step left the app on a chat, so return to the Spaces view.
  await page.getByRole("button", { name: /^Spaces/ }).first().click();
  await page
    .getByRole("button", { name: new RegExp(SCRATCH_SPACE) })
    .getByLabel("Rename space")
    .click();
  await page
    .getByRole("button", { name: new RegExp(RENAMED_SPACE) })
    .waitFor({ timeout: 10000 });

  await page
    .getByRole("button", { name: new RegExp(RENAMED_SPACE) })
    .getByLabel("Delete space")
    .click();
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll("button")].some((button) =>
        (button.textContent ?? "").includes(name),
      ),
    RENAMED_SPACE,
    { timeout: 10000 },
  );
});

await page.screenshot({ path: "e2e-final.png", fullPage: false });
await browser.close();

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

console.log("\n--- chat requests (POST /api/chat) ---");
chatRequests.forEach((request, index) => {
  console.log(
    `  #${index + 1} ragChunks=${request.rag} model=${request.modelId} baseUrl=${request.baseUrl}`,
  );
});
console.log("\n--- /api/embeddings statuses ---");
console.log(
  `  ${embeddingStatuses.length ? embeddingStatuses.join(", ") : "none"}`,
);

console.log("\n--- console errors ---");
if (errors.length === 0) console.log("  none");
else errors.forEach((error) => console.log(`  ${error}`));

console.log("\n--- console warnings ---");
if (warnings.length === 0) console.log("  none");
else warnings.slice(0, 10).forEach((warning) => console.log(`  ${warning}`));

console.log(
  `\n${passed} passed, ${failures.length} failed. Screenshots: e2e-rag-drawer.png, e2e-final.png\n`,
);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
