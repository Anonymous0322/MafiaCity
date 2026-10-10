/**
 * Navigation flow check in a real browser.
 *
 *   npm run test:navigation
 *
 * Asserts the requirement that creating a room leaves the creation screen
 * behind: the browser must land on /lobby/<code> with the create/join cards no
 * longer present, and the room's own controls present instead.
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

const CHROME = process.env.CHROME_PATH
  ?? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((candidate) => fs.existsSync(candidate));

if (!CHROME) {
  console.log("[nav] no Chrome/Edge found — set CHROME_PATH to run this suite");
  process.exit(2);
}

let child = null;
function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else proc.kill("SIGTERM");
}
process.on("exit", () => killTree(child));

const port = 5200 + Math.floor(Math.random() * 300);
child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "--", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, ...env, PORT: String(port) },
  stdio: "ignore",
  shell: true,
});
const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 90; i += 1) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.status === 200 || r.status === 503) { up = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { killTree(child); throw new Error("server did not start"); }

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const CODE = "MAF-NAVTEST";
const LOBBY = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  code: CODE,
  name: "Navigation Test",
  mode: "PUBLIC",
  status: "waiting",
  phase: "waiting",
  round_number: 0,
  hostId: "11111111-1111-4111-8111-111111111111",
  hostName: "NavTester",
  playerCount: 2,
  maxPlayers: 8,
  minPlayers: 5,
  version: 7,
  createdAt: new Date().toISOString(),
  players: [
    { id: "11111111-1111-4111-8111-111111111111", name: "NavTester", username: "nav", avatar: null, alive: true, host: true, connected: true },
    { id: "22222222-2222-4222-8222-222222222222", name: "Guest", username: "guest", avatar: null, alive: true, host: false, connected: true },
  ],
  me: { id: "11111111-1111-4111-8111-111111111111", isHost: true, alive: true, canStart: false, actionDone: false },
  allies: [],
  investigation: null,
  events: [],
  winner: null,
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("telegram.org/js/telegram-web-app.js")) void request.abort();
  else void request.continue();
});

await page.evaluateOnNewDocument((code) => {
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
  const player = {
    id: "11111111-1111-4111-8111-111111111111", telegramId: "1", name: "NavTester",
    username: "nav", firstName: "Nav", lastName: "Tester", avatar: null, language: "en",
  };
  const real = window.fetch.bind(window);
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/telegram")) return json({ success: true, player });
    if (url.includes("/api/lobbies") && method === "POST") {
      return json({ success: true, lobby: window.__LOBBY__ });
    }
    if (url.includes("/api/lobbies?since")) return new Response(null, { status: 304 });
    if (url.includes("/api/lobbies?id=")) return json({ lobby: window.__LOBBY__ });
    if (url.includes("/api/lobbies")) return json({ lobbies: [], current: null });
    return real(input, init);
  };
  window.__LOBBY__ = null;
  window.__CODE__ = code;
}, CODE);

// the stub needs the lobby object; inject it before every navigation
await page.evaluateOnNewDocument((lobby) => {
  window.__LOBBY__ = lobby;
}, LOBBY);

await page.goto(`${base}/`, { waitUntil: "networkidle2" });
await page.waitForSelector(".quick-card", { timeout: 20_000 });

check("home shows the create + join cards", true);

await page.click(".quick-card");
await page.waitForSelector(".create-modal", { timeout: 10_000 });
check("the create dialog opens", true);

await page.evaluate(() => {
  const input = document.querySelector(".create-modal input");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "Navigation Test");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click(".create-modal .primary-button");
await page.waitForFunction(() => location.pathname.startsWith("/lobby/"), { timeout: 20_000 });

const url = new URL(page.url());
check("creating a room navigates to /lobby/<code>", url.pathname === `/lobby/${CODE}`, url.pathname);

await page.waitForSelector(".room-panel", { timeout: 15_000 });
await new Promise((r) => setTimeout(r, 500));

const state = await page.evaluate(() => ({
  pathname: location.pathname,
  hasQuickCard: Boolean(document.querySelector(".quick-card")),
  hasJoinForm: Boolean(document.querySelector(".join-form")),
  hasCreateModal: Boolean(document.querySelector(".create-modal")),
  hasHero: Boolean(document.querySelector(".hero")),
  hasRoomCode: Boolean(document.querySelector(".code-panel-text strong")),
  codeText: document.querySelector(".code-panel-text strong")?.textContent ?? "",
  hasStartButton: Boolean(document.querySelector(".room-footer .primary-button")),
  seatCards: document.querySelectorAll(".seat-card:not(.is-empty)").length,
  emptySeats: document.querySelectorAll(".seat-card.is-empty").length,
  copyButton: Boolean(document.querySelector(".copy-code-button")),
  shareButton: Boolean(document.querySelector(".ghost-button")),
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));

check("the creation card is gone", state.hasQuickCard === false);
check("the join form is gone", state.hasJoinForm === false);
check("the create dialog is closed", state.hasCreateModal === false);
check("the home hero is gone", state.hasHero === false);
check("the room code is shown", state.hasRoomCode && state.codeText === CODE, state.codeText);
check("the host sees a start button", state.hasStartButton);
check("a copy-code control is present", state.copyButton);
check("a share control is present", state.shareButton);
check("seats are listed", state.seatCards === 2, `${state.seatCards} seated`);
check("empty seats are shown", state.emptySeats > 0, `${state.emptySeats}`);
check("no horizontal overflow", state.scrollWidth <= state.innerWidth + 1, `${state.scrollWidth}/${state.innerWidth}`);

// leaving returns to the home screen
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll(".room-footer .ghost-button")];
  buttons[buttons.length - 1]?.click();
});
await new Promise((r) => setTimeout(r, 1200));
const backHome = new URL(page.url()).pathname === "/";
check("leaving the room returns to the home screen", backHome, new URL(page.url()).pathname);

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} navigation checks passed.`);
killTree(child);
await new Promise((r) => setTimeout(r, 400));
process.exit(failed.length === 0 ? 0 : 1);
