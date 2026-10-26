/**
 * Browser smoke test (development helper).
 *
 * Loads the app in headless Chrome, exercises the main flows and reports any
 * console errors, page errors or failed requests.
 *
 *   node scripts/smoke.mjs
 *
 * Requires the mock gateway (scripts/mock-gateway.mjs) on port 4545 so the
 * chat step has somewhere to stream from.
 */
import { chromium } from "playwright-core";
import path from "node:path";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const errors = [];
const warnings = [];

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

/** Closes any modal that a failed step may have left open. */
const resetOverlays = async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
};

const step = async (name, fn) => {
  const before = errors.length;
  try {
    await fn();
    const added = errors.length - before;
    if (added === 0) {
      console.log(`  PASS  ${name}`);
    } else {
      console.log(`  PASS  ${name}  (with ${added} console error(s))`);
      for (const error of errors.slice(before)) {
        console.log(`        ${error}`);
      }
    }
  } catch (error) {
    const message = error?.message ?? String(error);
    errors.push(`step "${name}": ${message}`);
    console.log(`  FAIL  ${name}`);
    console.log(
      `        ${message.split("\n").slice(0, 6).join("\n        ")}`,
    );
  } finally {
    await resetOverlays();
  }
};

console.log(`Smoke test against ${APP_URL}\n`);

await step("page loads and hydrates", async () => {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Ready when you are, Akapan.", { timeout: 45000 });
});

await step("sidebar renders brand, nav and profile", async () => {
  await page.waitForSelector("text=Sloth");
  await page.waitForSelector("text=New chat");
  await page.waitForSelector("text=Spaces");
  await page.waitForSelector("text=Research");
  await page.waitForSelector("text=Chat agents");
  await page.waitForSelector("text=Apps");
  await page.waitForSelector("text=akapan2621");
});

await step("prompt box + quick modes + recommendations render", async () => {
  await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 20000 });
  await page.waitForSelector("text=Get recommended samples");
  await page.waitForSelector("text=Presentation");
  await page.waitForSelector("text=Visual");
});

await step("spaces view opens with seeded spaces", async () => {
  await page.getByRole("button", { name: /^Spaces/ }).first().click();
  await page.waitForSelector("text=XAUUSD & MT5 Research", { timeout: 20000 });
  await page.waitForSelector("text=IT Audit & ISO 27001");
  await page.waitForSelector("text=General Docs");
  await page.waitForSelector("text=Drop files to index into this Space");
});

await step("uploads a document, chunks it and indexes it", async () => {
  await page.locator('input[type="file"]').setInputFiles(
    path.join(process.cwd(), "fixtures", "trading-desk-handbook.md"),
  );

  // The file name shows up in the ingestion progress panel as soon as work
  // starts, and the page description contains "indexed" — so neither is a
  // reliable completion signal. The done-stage label commits in the same
  // render as the document/chunks state, which is what retrieval needs.
  await page.getByText("Indexed", { exact: true }).waitFor({ timeout: 30000 });

  // Assert a positive chunk count from the document list row (it only
  // renders once indexing has committed).
  const meta = await page
    .locator('li:has-text("trading-desk-handbook.md")')
    .first()
    .innerText();
  if (!/[1-9]\d* chunks?/.test(meta)) {
    throw new Error(`expected a positive chunk count, got: ${meta}`);
  }
});

await step("LLM settings modal opens, saves config and closes", async () => {
  await page.getByRole("button", { name: "LLM & Kilo API" }).first().click();
  await page.waitForSelector("text=Kilo Code AI Gateway", { timeout: 20000 });
  await page.waitForSelector("text=Custom OpenAI-Compatible Endpoint");
  await page.waitForSelector("text=Google Gemini Direct");

  await page.getByLabel("Base URL").fill("http://127.0.0.1:4545/v1");
  await page.getByLabel("API Key").fill("test-key");
  await page.getByLabel("Model ID").fill("mock-model");
  // Close the model dropdown so it cannot intercept the footer button.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Save changes/ }).click();
  await page.waitForTimeout(900);

  const badge = await page.locator("header").first().innerText();
  if (!badge.includes("mock-model")) {
    throw new Error(
      `header badge did not update, got: ${badge.replace(/\n/g, " | ")}`,
    );
  }
  if ((await page.getByRole("dialog").count()) > 0) {
    throw new Error("settings modal did not close");
  }
});

await step("search palette opens with Ctrl+K", async () => {
  await page.keyboard.press("Control+k");
  await page
    .getByPlaceholder("Search conversations and documents")
    .waitFor({ timeout: 20000 });
});

await step("chat sends a message and streams a reply", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 20000 });

  // Ground the answer in the Space that now holds the uploaded document.
  await page.getByText("No Space", { exact: true }).click();
  await page.getByRole("button", { name: /All Spaces/ }).click();
  await page.waitForTimeout(200);

  await page
    .getByPlaceholder("Ask a question...")
    .fill("What is the maximum position size per trade?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.body.innerText.includes("Based on the retrieved excerpts"),
    { timeout: 45000 },
  );
});

await step("assistant answer shows the sources drawer", async () => {
  await page.waitForSelector("text=Sources Used from Space", { timeout: 20000 });
  await page.getByText("Sources Used from Space").first().click();
  await page.waitForSelector("text=trading-desk-handbook.md", { timeout: 10000 });
});

await step("a specific Space selection also grounds the answer", async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 20000 });
  await page.getByText("All Spaces", { exact: true }).click();
  await page.getByRole("button", { name: /XAUUSD & MT5 Research/ }).click();
  await page
    .getByPlaceholder("Ask a question...")
    .fill("What invalidates a breakout setup?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.body.innerText.includes("Based on the retrieved excerpts"),
    { timeout: 45000 },
  );
  await page.waitForSelector("text=Sources Used from Space", { timeout: 20000 });
});

await step("agents view starts a templated chat", async () => {
  await page.getByRole("button", { name: "Chat agents" }).first().click();
  await page.waitForSelector("text=Market Analyst", { timeout: 20000 });
  await page.getByText("Document Analyst", { exact: true }).click();
  await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 20000 });
});

await page.screenshot({ path: "smoke-screenshot.png", fullPage: false });

await browser.close();

console.log("\n--- console errors ---");
if (errors.length === 0) console.log("  none");
else {
  errors.forEach((error) => console.log(`  ${error}`));
  console.log("\nA screenshot of the final state was written to smoke-screenshot.png");
}

console.log("\n--- console warnings ---");
if (warnings.length === 0) console.log("  none");
else warnings.slice(0, 10).forEach((warning) => console.log(`  ${warning}`));

process.exit(errors.length === 0 ? 0 : 1);
