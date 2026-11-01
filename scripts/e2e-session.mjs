/**
 * Focused end-to-end suite for the login/session/Split-View delivery.
 *
 *   npm run e2e:session   (requires `npm run dev` + `npm run mock:gateway`)
 *
 * Covers the three failure-prone areas in under a minute:
 *   boot+guest → gateway settings → seeded sessions → reload restore →
 *   RAG over restored chunks → interrupted-turn notice →
 *   sign-out → guest re-login restores everything again.
 */
import { chromium } from "playwright-core";
import path from "node:path";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const errors = [];
const chatRequests = [];
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
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  const failure = request.failure();
  if (failure && !/net::ERR_ABORTED/.test(failure.errorText)) {
    errors.push(`requestfailed: ${request.url()} ${failure.errorText}`);
  }
});
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/chat")) {
    let rag = null;
    try {
      rag = (request.postDataJSON().ragContextChunks ?? []).length;
    } catch {
      /* keep null */
    }
    chatRequests.push(rag);
  }
});

/** Per-step watchdog: a hung step fails loudly instead of freezing the run. */
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise(
      (_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
          ms,
        ),
    ),
  ]);

const step = async (name, fn) => {
  const errorsBefore = errors.length;
  try {
    await withTimeout(fn(), 120_000, `step "${name}"`);
    const added = errors.length - errorsBefore;
    passed += 1;
    console.log(added === 0 ? `  PASS  ${name}` : `  PASS  ${name}  (${added} console error(s))`);
  } catch (error) {
    const message = error?.message ?? String(error);
    failures.push({ name, message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${message.split("\n").slice(0, 6).join("\n        ")}`);
  } finally {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
};

const expect = (condition, detail) => {
  if (!condition) throw new Error(detail ?? "expectation failed");
};

const waitForChatRequests = async (min, timeout = 30000) => {
  const started = Date.now();
  while (chatRequests.length < min) {
    if (Date.now() - started > timeout) {
      throw new Error(`expected ${min} chat request(s), saw ${chatRequests.length}`);
    }
    await page.waitForTimeout(100);
  }
};

const scopeLabel = async () =>
  (await page.locator('[data-testid="space-picker-trigger"]').innerText({ timeout: 15000 })).trim();

const send = async (question) => {
  const before = chatRequests.length;
  await page.getByPlaceholder("Ask a question...").fill(question);
  await page.keyboard.press("Enter");
  await waitForChatRequests(before + 1);
};

const guestLogin = async () => {
  await page.getByRole("button", { name: /Continue as guest/ }).click();
  // A remembered chat may replace the greeting, so wait for the workspace's
  // prompt box (present in both the empty state and an open chat).
  await page.waitForSelector('div[role="textbox"], textarea, [contenteditable]', {
    timeout: 45000,
  });
  await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 45000 });
};

const guestSignOut = async () => {
  await page.locator("aside").first().getByText("Guest").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForSelector("text=Sign in to Sloth", { timeout: 20000 });
};

/** Seeds Space/document/chunks/chats straight into the guest namespace DB. */
const seedWorkspace = async (page_) =>
  page_.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("amazon-quick-workspace");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          try {
            const db = open.result;
            const now = Date.now();
            const tx = db.transaction(["spaces", "documents", "chunks", "chats"], "readwrite");

            tx.objectStore("spaces").put({
            id: "space_session",
            name: "Session Test Space",
            description: "Seeded by e2e-session",
            color: "from-purple-600 via-pink-500 to-indigo-600",
            emoji: "🧪",
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore("documents").put({
            id: "doc_session",
            spaceId: "space_session",
            name: "session-note.md",
            fileName: "session-note.md",
            mimeType: "text/markdown",
            size: 96,
            chunkCount: 2,
            charCount: 180,
            createdAt: now,
            embedded: false,
          });
          const chunks = tx.objectStore("chunks");
          chunks.put({
            id: "doc_session_c0",
            documentId: "doc_session",
            spaceId: "space_session",
            index: 0,
            content: "The maximum session deposit is QUARTZ-BLUE-44 per desk, subject to the daily cap.",
            start: 0,
            end: 90,
          });
          chunks.put({
            id: "doc_session_c1",
            documentId: "doc_session",
            spaceId: "space_session",
            index: 1,
            content: "Follow-ups are logged after each session and reviewed on Monday.",
            start: 90,
            end: 180,
          });
          tx.objectStore("chats").put({
            id: "chat_session",
            title: "Session test chat",
            createdAt: now,
            updatedAt: now,
            messages: [
              { id: "u1", role: "user", content: "hello session", createdAt: now },
              { id: "a1", role: "assistant", content: "session works", createdAt: now },
            ],
            spaceSelection: { kind: "space", spaceId: "space_session" },
            modelId: "mock-model",
          });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }),
  );

console.log(`\nE2E (session & split view) against ${APP_URL}\n`);

await step("boot: the login wall appears and guest clears it", async () => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Sign in to Sloth", { timeout: 45000 });
  await guestLogin();
});

await step("settings: gateway config saved through the real UI", async () => {
  await page.getByRole("button", { name: "LLM & Kilo API" }).first().click();
  await page.waitForSelector("text=Kilo Code AI Gateway", { timeout: 20000 });
  await page.getByLabel("Base URL").fill("http://127.0.0.1:4545/v1");
  await page.getByLabel("API Key").fill("session-key");
  await page.getByLabel("Model ID").fill("mock-model");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Save changes/ }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"]').length === 0,
  );
  const header = await page.locator("header").first().innerText();
  expect(header.includes("mock-model"), "settings were not saved");
});

await step("seed: writes a Space, a document, chunks and a chat", async () => {
  await seedWorkspace(page);
  // seed the remembered session (last chat + scope) for the guest account
  await page.evaluate(() => {
    localStorage.setItem(
      "aqw:ui-state:guest",
      JSON.stringify({
        activeChatId: "chat_session",
        spaceSelection: { kind: "space", spaceId: "space_session" },
        splitOpen: true,
        splitRight: 0.38,
      }),
    );
  });
});

await step("split: reload restores chat, scope and opens split view", async () => {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  // The remembered active chat is open again (this is what per-login UI
  // memory restores — NOT the empty-state greeting).
  await page.waitForFunction(
    () => document.body.innerText.includes("session works"),
    undefined,
    { timeout: 45000 },
  );

  const header = await page.locator("header").first().innerText();
  expect(header.includes("mock-model"), `settings lost, got: ${header.replace(/\n/g, " | ")}`);

  // The remembered active chat is open again.
  await page.waitForFunction(
    () => document.body.innerText.includes("session works"),
    undefined,
    { timeout: 20000 },
  );

  // The remembered Space scope is reflected both in the picker and the split panel.
  expect(
    (await scopeLabel()) === "Session Test Space",
    `scope was not restored, saw: ${await scopeLabel()}`,
  );
  // Split view re-opened (right column visible with the seeded file).
  await page.waitForSelector("text=what you are working with", { timeout: 15000 });
  await page.waitForSelector("text=session-note.md", { timeout: 15000 });
});

await step("rag: chat over the restored chunks grounds the answer", async () => {
  await send("What is the maximum session deposit?");
  // The mock gateway echoes the conversation's FIRST user turn ("hello
  // session") — a restored chat's answer never contains the new question.
  await page.waitForFunction(
    () => document.body.innerText.includes('answer to "hello session'),
    undefined,
    { timeout: 45000 },
  );
  expect(chatRequests[chatRequests.length - 1] > 0, `expected ragContextChunks > 0, got ${chatRequests[chatRequests.length - 1]}`);
});

await step("interrupted: an empty assistant turn shows the retry notice", async () => {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("amazon-quick-workspace");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["chats"], "readwrite");
          const now = Date.now();
          tx.objectStore("chats").put({
            id: "chat_e2e_interrupted",
            title: "Interrupted turn",
            createdAt: now,
            updatedAt: now,
            messages: [
              { id: "m1", role: "user", content: "hello", createdAt: now },
              { id: "m2", role: "assistant", content: "", createdAt: now },
            ],
            spaceSelection: { kind: "none" },
            modelId: "mock-model",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Interrupted turn/ }).click({ timeout: 15000 });
  await page.getByText(/การตอบกลับถูกขัดจังหวะ/).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /ลองอีกครั้ง/ }).first().waitFor({ timeout: 10000 });
});

await step("logout: returns to the login wall", async () => {
  // The interrupted step left the interrupted chat open and its scope
  // selected; restore the seeded memory so the re-login step can assert
  // that exactly that state comes back (this is what the account remembers,
  // not just the workspace files).
  await page.evaluate(() => {
    localStorage.setItem(
      "aqw:ui-state:guest",
      JSON.stringify({
        activeChatId: "chat_session",
        spaceSelection: { kind: "space", spaceId: "space_session" },
        splitOpen: true,
        splitRight: 0.38,
      }),
    );
  });
  await page.waitForTimeout(200);
  await guestSignOut();
});

await step("re-login: the whole guest workspace comes back", async () => {
  await guestLogin();

  const header = await page.locator("header").first().innerText();
  expect(header.includes("mock-model"), `settings lost after re-login`);

  // The remembered chat is reopened, with its messages intact.
  await page.waitForFunction(
    () => document.body.innerText.includes("session works"),
    undefined,
    { timeout: 20000 },
  );
  expect(
    (await scopeLabel()) === "Session Test Space",
    `scope lost after re-login, saw: ${await scopeLabel()}`,
  );

  await send("What is the maximum session deposit?");
  await page.waitForFunction(
    () => document.body.innerText.includes('answer to "hello session'),
    undefined,
    { timeout: 45000 },
  );
  expect(chatRequests[chatRequests.length - 1] > 0, "chunks lost after re-login (rag=0)");
});

await page.screenshot({ path: "e2e-session-final.png", fullPage: false });
await browser.close();

console.log("\n--- chat requests ---");
chatRequests.forEach((rag, index) => console.log(`  #${index + 1} ragChunks=${rag}`));
console.log("\n--- console errors ---");
if (errors.length === 0) console.log("  none");
else errors.forEach((error) => console.log(`  ${error}`));

console.log(
  `\n${passed} passed, ${failures.length} failed. Screenshot: e2e-session-final.png\n`,
);
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
