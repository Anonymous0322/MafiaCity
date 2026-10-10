/**
 * Real-browser layout verification.
 *
 *   npm run test:layout
 *
 * Drives the installed Chrome/Edge against a running production build and
 * measures `.quick-card` / `.join-form` in uz / ru / en at several viewports.
 * The original bug was that these cards changed width when the language
 * changed, so the assertion is a *cross-language equality* of measured widths,
 * not a hard-coded number.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}
const env = { ...loadEnvFile(path.join(root, ".env.local")), ...loadEnvFile(path.join(root, ".env")) };

/* ---------------------------------------------------------------- browser */

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const executablePath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!executablePath) {
  console.error(
    "[layout] No Chrome/Edge found. Set CHROME_PATH to a Chromium binary to run this suite.",
  );
  process.exit(2);
}
console.log(`[layout] browser: ${executablePath}`);

/* ----------------------------------------------------------------- server */

let child = null;
function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill("SIGTERM");
  }
}
process.on("exit", () => killTree(child));

async function waitForServer(base) {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 200 || response.status === 503) return true;
    } catch {
      /* not up */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

let base = process.env.BASE;
if (!base) {
  const port = 4300 + Math.floor(Math.random() * 400);
  child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "--", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: "ignore",
    shell: true,
  });
  base = `http://127.0.0.1:${port}`;
  if (!(await waitForServer(base))) {
    killTree(child);
    throw new Error("server did not start");
  }
}
console.log(`[layout] target: ${base}`);

/* ------------------------------------------------------------------ setup */

const VIEWPORTS = [
  { name: "iphone-se", width: 320, height: 568 },
  { name: "android", width: 360, height: 740 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "iphone-pro-max", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];
const LANGUAGES = ["uz", "ru", "en"];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

/**
 * Loads the home screen with a stubbed Telegram identity so the authenticated
 * UI (quick-card / join-form) is actually reachable without a real bot.
 */
async function measure(viewport, language) {
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

  // The real SDK overwrites window.Telegram.WebApp; keep the stub alive by
  // blocking the CDN script during this measurement run.
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("telegram.org/js/telegram-web-app.js")) {
      void request.abort();
    } else {
      void request.continue();
    }
  });

  await page.evaluateOnNewDocument(
    (lang) => {
      window.localStorage.setItem("mafia:language", lang);
      window.Telegram = {
        WebApp: {
          initData: "stub_init_data_for_layout_test",
          version: "8.0",
          platform: "tdesktop",
          colorScheme: "dark",
          themeParams: {},
          isExpanded: true,
          viewportHeight: window.innerHeight,
          viewportStableHeight: window.innerHeight,
          ready() {},
          expand() {},
          close() {},
          onEvent() {},
          offEvent() {},
          setHeaderColor() {},
          setBackgroundColor() {},
          HapticFeedback: {
            impactOccurred() {},
            notificationOccurred() {},
            selectionChanged() {},
          },
        },
      };

      const player = {
        id: "11111111-1111-4111-8111-111111111111",
        telegramId: "900000001",
        name: "LayoutTester",
        username: "layout_tester",
        firstName: "Layout",
        lastName: "Tester",
        avatar: null,
        language: lang,
      };

      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/auth/telegram")) {
          return new Response(JSON.stringify({ success: true, player }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/lobbies")) {
          return new Response(JSON.stringify({ lobbies: [], current: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    },
    language,
  );

  await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 45_000 });
  await page.waitForSelector(".quick-card", { timeout: 20_000 });
  await page.waitForSelector(".join-form", { timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 350));

  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 };
    };
    const clipped = [...document.querySelectorAll(".quick-card, .join-form, .quick-card small, .join-form input, .quick-card strong")]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.className || node.tagName);

    const overflowing = [...document.querySelectorAll(".quick-card, .join-form, .quick-actions, .game-app, body")]
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
      .map((node) => node.className || node.tagName);

    return {
      quickCard: rect(".quick-card"),
      joinForm: rect(".join-form"),
      quickActions: rect(".quick-actions"),
      gameApp: rect(".game-app"),
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      clipped,
      overflowing,
      // height of the two cards; a language change must not reflow them either
      quickCardText: document.querySelector(".quick-card small")?.textContent?.slice(0, 60) ?? "",
      heroName: document.querySelector(".hero h1")?.textContent ?? "",
    };
  });

  await page.close();
  return metrics;
}

/* ------------------------------------------------------------------- run */

for (const viewport of VIEWPORTS) {
  const perLanguage = {};
  for (const language of LANGUAGES) {
    perLanguage[language] = await measure(viewport, language);
  }

  const cards = LANGUAGES.map((language) => perLanguage[language].quickCard?.width ?? 0);
  const forms = LANGUAGES.map((language) => perLanguage[language].joinForm?.width ?? 0);
  const actions = LANGUAGES.map((language) => perLanguage[language].quickActions?.width ?? 0);

  const unique = (values) => new Set(values.map((value) => Math.round(value * 10))).size;
  const tag = `${viewport.name} (${viewport.width}px)`;

  check(`${tag}: quick-card width identical across uz/ru/en`, unique(cards) === 1, cards.join(" / "));
  check(`${tag}: join-form width identical across uz/ru/en`, unique(forms) === 1, forms.join(" / "));
  check(`${tag}: container width identical across uz/ru/en`, unique(actions) === 1, actions.join(" / "));
  check(
    `${tag}: quick-card fills its container`,
    Math.abs(cards[0] - actions[0]) < 1.5,
    `${cards[0]} vs ${actions[0]}`,
  );
  check(
    `${tag}: join-form fills its container`,
    Math.abs(forms[0] - actions[0]) < 1.5,
    `${forms[0]} vs ${actions[0]}`,
  );

  for (const language of LANGUAGES) {
    const data = perLanguage[language];
    check(
      `${tag}/${language}: no horizontal page overflow`,
      data.documentScrollWidth <= data.innerWidth + 1,
      `${data.documentScrollWidth} vs ${data.innerWidth}`,
    );
    check(`${tag}/${language}: no element overflows the viewport`, data.overflowing.length === 0, data.overflowing.join(", "));
    check(`${tag}/${language}: no clipped text`, data.clipped.length === 0, data.clipped.join(", "));
    check(
      `${tag}/${language}: telegram profile name is rendered`,
      data.heroName.trim() === "LayoutTester" && data.heroName.trim() !== "…",
      JSON.stringify(data.heroName),
    );
  }
}

/* ---------------------------------------------------------------- report */

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} layout checks passed.`);
killTree(child);
await new Promise((resolve) => setTimeout(resolve, 400));
process.exit(failed.length === 0 ? 0 : 1);
