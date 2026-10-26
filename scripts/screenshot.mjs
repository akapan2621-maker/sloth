/**
 * Captures the product screenshots used in the README.
 *
 *   npm run mock:gateway &   # required
 *   node scripts/screenshot.mjs
 */
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = path.join(process.cwd(), "docs");

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`captured ${name}.png`);
};

await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Ready when you are, Akapan.", { timeout: 45000 });
await page.waitForTimeout(700);
await shot("screenshot");

/* Spaces view with an indexed document ------------------------------------ */
await page.getByRole("button", { name: /^Spaces/ }).first().click();
await page.waitForSelector("text=Drop files to index into this Space", {
  timeout: 20000,
});
await page
  .locator('input[type="file"]')
  .setInputFiles(
    path.join(process.cwd(), "fixtures", "trading-desk-handbook.md"),
  );
// The document row only appears once ingestion has finished.
await page.waitForSelector("text=chars", { timeout: 45000 });
await page.waitForTimeout(900);
await shot("spaces");

/* Configured chat with a grounded answer ---------------------------------- */
await page.getByRole("button", { name: "LLM & Kilo API" }).first().click();
await page.waitForSelector("text=Kilo Code AI Gateway", { timeout: 20000 });
await page.getByLabel("Base URL").fill("http://127.0.0.1:4545/v1");
await page.getByLabel("API Key").fill("test-key");
await page.getByLabel("Model ID").fill("google/gemini-2.5-flash");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /Save changes/ }).click();
await page.waitForTimeout(800);

await page.getByRole("button", { name: "New chat", exact: true }).first().click();
await page.getByPlaceholder("Ask a question...").waitFor({ timeout: 20000 });
await page.getByText("No Space", { exact: true }).click();
await page.getByRole("button", { name: /All Spaces/ }).click();
await page
  .getByPlaceholder("Ask a question...")
  .fill("What is the maximum position size per trade, and what invalidates a breakout setup?");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.body.innerText.includes("Based on the retrieved excerpts"),
  { timeout: 45000 },
);
await page.getByText("Sources Used from Space").first().click();
await page.waitForTimeout(900);
await shot("chat");

await browser.close();
console.log("done");
