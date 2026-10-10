/**
 * Verifies the Telegram profile presentation: nickname shown instead of the
 * @username, the handle kept as secondary text, and the avatar photo actually
 * rendering (not the initial fallback).
 *
 *   npm run test:profile
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
  ].find((candidate) => fs.existsSync(candidate));
if (!CHROME) {
  console.log("[profile] no browser found — skipped");
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

const port = 5500 + Math.floor(Math.random() * 300);
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

// A 1x1 PNG data URI: it always loads, so the assertion tests the Avatar
// component rather than whether a third-party host happens to respond.
const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const PLAYER = {
  id: "33333333-3333-4333-8333-333333333333",
  telegramId: "7901013364",
  name: "К Р А С U B O",
  username: "uletaaay",
  firstName: "К Р А С U B O",
  lastName: "Test",
  avatar: PHOTO,
  language: "uz",
};

const PROFILE_PAYLOAD = {
  profile: PLAYER,
  stats: {
    playerId: PLAYER.id, rating: 1012, peakRating: 1012, gamesPlayed: 0, gamesWon: 0,
    gamesLost: 0, winRate: 0, mafiaGames: 0, mafiaWins: 0, mafiaWinRate: 0,
    townGames: 0, townWins: 0, townWinRate: 0, survived: 0, survivalRate: 0, rank: null,
  },
  history: [],
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("telegram.org/js/telegram-web-app.js")) void request.abort();
  else void request.continue();
});

await page.evaluateOnNewDocument((player) => {
  window.localStorage.setItem("mafia:language", "uz");
  window.Telegram = {
    WebApp: {
      initData: "stub", version: "8.0", platform: "tdesktop", colorScheme: "dark",
      themeParams: {}, isExpanded: true, viewportHeight: 844, viewportStableHeight: 844,
      ready() {}, expand() {}, close() {}, onEvent() {}, offEvent() {},
      setHeaderColor() {}, setBackgroundColor() {},
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    },
  };
  const real = window.fetch.bind(window);
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/auth/telegram")) return json({ success: true, player });
    if (url.includes("/api/lobbies")) return json({ lobbies: [], current: null });
    if (url.includes("/api/leaderboard")) return json({ players: [], total: 0, page: 1, pageSize: 25, me: null });
    if (url.includes("/api/profile")) return json(window.__PROFILE__);
    return real(input, init);
  };
  window.__PLAYER__ = player;
}, PLAYER);
await page.evaluateOnNewDocument((payload) => {
  window.__PROFILE__ = payload;
}, PROFILE_PAYLOAD);

/* ------------------------------------------------------------ home hero -- */

await page.goto(`${base}/`, { waitUntil: "networkidle2" });
await page.waitForSelector(".hero h1", { timeout: 20_000 });
await new Promise((r) => setTimeout(r, 600));

const hero = await page.evaluate(() => ({
  heading: document.querySelector(".hero h1")?.textContent?.trim() ?? "",
  headingIsNotHandle: !/^@/.test(document.querySelector(".hero h1")?.textContent?.trim() ?? "@x"),
  chipName: document.querySelector(".auth-chip-name")?.textContent?.trim() ?? "",
  avatarImg: (() => {
    const img = document.querySelector(".avatar-hero img");
    if (!img) return null;
    return { complete: img.complete, width: img.naturalWidth };
  })(),
  avatarBox: (() => {
    const box = document.querySelector(".avatar-hero");
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  })(),
}));

check("hero shows the nickname", hero.heading === PLAYER.name, hero.heading);
check("hero does not show the @handle as the name", hero.headingIsNotHandle);
check("top bar shows the nickname", hero.chipName === PLAYER.name, hero.chipName);
check("hero renders an <img> avatar, not the letter fallback", hero.avatarImg !== null);
check("hero avatar has a real size", (hero.avatarBox?.width ?? 0) >= 36, JSON.stringify(hero.avatarBox));
check(
  "avatar image actually loaded (naturalWidth > 0)",
  Boolean(hero.avatarImg?.complete && hero.avatarImg.width > 0),
  hero.avatarImg ? `naturalWidth=${hero.avatarImg.width}` : "no <img>",
);

/* --------------------------------------------------------------- profile -- */

await page.goto(`${base}/profile`, { waitUntil: "networkidle2" });
await page.waitForSelector(".profile-identity strong", { timeout: 20_000 });
await new Promise((r) => setTimeout(r, 600));

const profile = await page.evaluate(() => ({
  name: document.querySelector(".profile-identity strong")?.textContent?.trim() ?? "",
  handle: document.querySelector(".profile-identity > span")?.textContent?.trim() ?? "",
  avatarImg: (() => {
    const img = document.querySelector(".avatar-large img");
    return img ? { complete: img.complete, width: img.naturalWidth } : null;
  })(),
}));

check("profile shows the nickname", profile.name === PLAYER.name, profile.name);
check("profile shows @username as secondary text", profile.handle === `@${PLAYER.username}`, profile.handle);
check(
  "profile avatar photo loaded",
  Boolean(profile.avatarImg?.complete && profile.avatarImg.width > 0),
  profile.avatarImg ? `naturalWidth=${profile.avatarImg.width}` : "no <img>",
);

/* --------------------------------------------------- create-room dialog -- */

await page.goto(`${base}/`, { waitUntil: "networkidle2" });
await page.waitForSelector(".quick-card-main", { timeout: 20_000 });
await page.click(".quick-card-main");
await page.waitForSelector(".create-modal", { timeout: 10_000 });
await new Promise((r) => setTimeout(r, 500));

const modal = await page.evaluate(() => {
  const panel = document.querySelector(".create-modal");
  const backdrop = document.querySelector(".modal-backdrop");
  if (!panel || !backdrop) return null;
  const rect = panel.getBoundingClientRect();
  const labels = [...document.querySelectorAll(".field-label")];
  const first = labels[0]?.getBoundingClientRect();
  const second = labels[1]?.getBoundingClientRect();
  const input = document.querySelector(".field-label > input");
  return {
    // the panel must be inside the viewport
    fullyVisible: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    viewport: window.innerHeight,
    backdropPosition: getComputedStyle(backdrop).position,
    panelWidth: Math.round(rect.width),
    // fields must stack, not overlap
    labelsStacked: Boolean(first && second) ? second.top > first.bottom - 1 : null,
    inputVisible: input ? getComputedStyle(input).display !== "none" && input.getBoundingClientRect().height > 30 : false,
    inputWidth: input ? Math.round(input.getBoundingClientRect().width) : 0,
    hasBackdropBlur: getComputedStyle(backdrop).backdropFilter !== "none",
    hasAnimation: getComputedStyle(panel).animationName !== "none",
  };
});

check("the dialog is rendered", modal !== null);
check("the dialog is fully inside the viewport (not cut off)", modal?.fullyVisible === true, modal ? `top=${modal.top} bottom=${modal.bottom} vh=${modal.viewport}` : "");
check("the dialog is centred within the sheet", (modal?.panelWidth ?? 0) > 300, `${modal?.panelWidth}px`);
check("the backdrop is fixed to the screen", modal?.backdropPosition === "fixed", modal?.backdropPosition);
check("form fields stack vertically instead of overlapping", modal?.labelsStacked === true);
check("the room-name input is visible and sized", modal?.inputVisible === true && (modal?.inputWidth ?? 0) > 200, `${modal?.inputWidth}px`);
check("the backdrop blurs the page", modal?.hasBackdropBlur === true);
check("the dialog animates in", modal?.hasAnimation === true);

await page.screenshot({ path: path.join(root, ".screenshots", "create-room-dialog.png") });

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} profile/dialog checks passed.`);
killTree(child);
await new Promise((r) => setTimeout(r, 400));
process.exit(failed.length === 0 ? 0 : 1);
