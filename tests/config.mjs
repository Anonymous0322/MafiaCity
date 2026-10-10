/**
 * Reproduces the exact failure the deployed app showed, and proves the app now
 * reports it precisely instead of an opaque code.
 *
 *   npm run test:config
 *
 * Boots the server twice: once correctly configured (must be healthy), and once
 * with SUPABASE_SERVICE_ROLE_KEY removed (must be reported as a
 * configuration problem, never as a generic 500).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { purgeTestRows } from "./lib/purge.mjs";
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

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("[config] SUPABASE_SERVICE_ROLE_KEY is not set locally — nothing to simulate.");
  process.exit(0);
}

const created = new Set();

/** This test signs in for real, so it must not leave players behind. */
async function purge() {
  await purgeTestRows({ players: [...created] });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else proc.kill("SIGTERM");
}

async function boot(port, overrides) {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "start", "--", "-p", String(port)],
    {
      cwd: root,
      env: { ...process.env, ...env, ...overrides, PORT: String(port) },
      stdio: "ignore",
      shell: true,
    },
  );
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.status === 200 || r.status === 503) return { child, base };
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  killTree(child);
  throw new Error("server did not start");
}

function signInitData(user) {
  const payload = { user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(env.TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}

/* ------------------------------------------------ 1. healthy configuration */

console.log("[config] boot 1/2 — fully configured");
const good = await boot(5300 + Math.floor(Math.random() * 60), {});
const goodHealth = await (await fetch(`${good.base}/api/health`)).json();
check(
  "healthy deployment reports healthy",
  goodHealth.ok === true && goodHealth.database.privileged === true,
  `status=${goodHealth.status} privileged=${goodHealth.database?.privileged}`,
);
check("healthy deployment names no misconfiguration", goodHealth.misconfiguration === null);

const goodAuth = await fetch(`${good.base}/api/auth/telegram`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ initData: signInitData({ id: 991000001, first_name: "Config", username: "cfg_ok" }) }),
});
const goodAuthBody = await goodAuth.json();
check("sign-in succeeds with the service-role key present", goodAuth.status === 200 && Boolean(goodAuthBody.player?.id), `HTTP ${goodAuth.status}`);
if (goodAuthBody.player?.id) created.add(goodAuthBody.player.id);

killTree(good.child);
await new Promise((r) => setTimeout(r, 1500));

/* --------------------------------------- 2. service role key removed (the bug) */

console.log("[config] boot 2/2 — SUPABASE_SERVICE_ROLE_KEY removed");

// Object spread cannot *remove* a key, so the secret is blanked out — the app
// treats an empty value as absent and falls back to the public anon key, which
// is exactly what the broken deployment did.
const broken = await boot(5400 + Math.floor(Math.random() * 60), {
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
  SUPABASE_DB_KEY: "",
  // the anon key is what the deployed app silently fell back to
  SUPABASE_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
const badHealth = await (await fetch(`${broken.base}/api/health`)).json();
check("misconfigured deployment reports degraded", badHealth.ok === false, `status=${badHealth.status}`);
check("health check names the missing variable", String(badHealth.misconfiguration ?? "").includes("SUPABASE_SERVICE_ROLE_KEY"));
check("health check no longer claims the tables are missing", badHealth.database?.tablesReady === false && String(badHealth.database?.detail ?? "").includes("permission denied"));

const badAuth = await fetch(`${broken.base}/api/auth/telegram`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ initData: signInitData({ id: 991000002, first_name: "Config", username: "cfg_bad" }) }),
});
const badAuthBody = await badAuth.json();
check(
  "auth returns a specific configuration code, not a generic failure",
  badAuth.status === 503 && badAuthBody.code === "database_not_configured",
  `HTTP ${badAuth.status} ${JSON.stringify(badAuthBody)}`,
);

/* ----------------------------- 3. the browser shows an actionable message */

const CHROME = process.env.CHROME_PATH
  ?? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => fs.existsSync(candidate));

if (CHROME) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("telegram.org/js/telegram-web-app.js")) void request.abort();
    else void request.continue();
  });
  await page.evaluateOnNewDocument(() => {
    window.localStorage.setItem("mafia:language", "en");
    window.Telegram = {
      WebApp: {
        initData: "stub", version: "8.0", platform: "tdesktop", colorScheme: "dark",
        themeParams: {}, isExpanded: true, viewportHeight: 844, viewportStableHeight: 844,
        ready() {}, expand() {}, close() {}, onEvent() {}, offEvent() {},
        setHeaderColor() {}, setBackgroundColor() {},
        HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
      },
    };
  });
  await page.goto(`${broken.base}/`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".gate-error", { timeout: 20_000 });
  const message = await page.$eval(".gate-error", (node) => node.textContent ?? "");
  check(
    "the UI explains what to fix instead of showing a raw code",
    /SUPABASE_SERVICE_ROLE_KEY/.test(message) && !message.includes("_failed"),
    message.slice(0, 120),
  );
  await browser.close();
} else {
  console.log("  (no browser found — skipped the UI assertion)");
}

killTree(broken.child);
await new Promise((r) => setTimeout(r, 500));
await purge();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} configuration checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
