import { chromium, type Browser } from "playwright";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

/**
 * Reject obviously-internal targets so the render service can't be used as an
 * SSRF proxy into the host's private network.
 */
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid url: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === "[::1]" ||
    host === "metadata.google.internal";
  if (blocked) throw new Error(`refusing to open private/internal host: ${host}`);
  return u;
}

async function autoScroll(page: import("playwright").Page) {
  // Nudge lazy-loaded content into the DOM without hanging forever.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight || total > 12000) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
    window.scrollTo(0, 0);
  });
}

export interface RenderResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  renderedMs: number;
}

/**
 * Open a URL in a real browser, let JS run, and return the human-visible text.
 * This is the work the agent pays for — it costs real compute and normal
 * HTTP-only agents cannot do it.
 */
export async function renderPage(
  raw: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<RenderResult> {
  const safe = assertSafeUrl(raw);
  const timeoutMs = opts.timeoutMs ?? config.renderTimeoutMs;
  const maxChars = opts.maxChars ?? 18000;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(safe.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Best-effort settle for client-rendered pages; don't fail the whole render if it times out.
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await autoScroll(page).catch(() => {});

    const title = (await page.title().catch(() => "")) || "";
    const text = await page.evaluate(() => {
      const el = document.querySelector("main") ?? document.body;
      return (el as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").trim();
    });

    return {
      url: raw,
      finalUrl: page.url(),
      title,
      text: text.slice(0, maxChars),
      renderedMs: Date.now() - started,
    };
  } finally {
    await context.close();
  }
}

// `npm run render-once -- https://example.com` — render without the paywall, for local sanity checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? "https://example.com";
  renderPage(target)
    .then((r) => {
      console.log(`title: ${r.title}`);
      console.log(`finalUrl: ${r.finalUrl}  (${r.renderedMs}ms)`);
      console.log("--- text (first 600 chars) ---");
      console.log(r.text.slice(0, 600));
    })
    .catch((e) => {
      console.error("render failed:", e.message);
      process.exit(1);
    })
    .finally(() => closeBrowser());
}
