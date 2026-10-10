/**
 * End-to-end HTTP checks against a running server.
 *
 *   npm run test:e2e            (starts `next start` on a free port itself)
 *   BASE=http://localhost:3000 npm run test:e2e   (use an already running server)
 *
 * Exits non-zero on the first failed expectation.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { purgeTestRows } from "./lib/purge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const env = { ...loadEnvFile(path.join(root, ".env.local")), ...loadEnvFile(path.join(root, ".env")) };
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "";

/* -------------------------------------------------------------------------- */
/* server bootstrap                                                           */
/* -------------------------------------------------------------------------- */

let child = null;

function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32" && proc.pid) {
    // npm spawns next as a grandchild; /T takes the whole tree down
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill("SIGTERM");
  }
}

process.on("exit", () => killTree(child));
process.on("SIGINT", () => {
  killTree(child);
  process.exit(130);
});

async function waitForServer(base, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (response.status === 200 || response.status === 503) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function startServer() {
  const port = 3900 + Math.floor(Math.random() * 400);
  child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "--", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const base = `http://127.0.0.1:${port}`;
  if (!(await waitForServer(base))) {
    killTree(child);
    throw new Error("server did not start");
  }
  return base;
}

const base = process.env.BASE ?? (await startServer());
console.log(`[e2e] target: ${base}`);

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function signInitData(user, botToken = BOT_TOKEN) {
  const payload = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const check = Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}

const created = new Set();

/** A real sign-in creates a real player row; remove it afterwards. */
async function purge() {
  await purgeTestRows({ players: [...created] });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(route, init = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let body = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

/* -------------------------------------------------------------------------- */
/* 1. health                                                                  */
/* -------------------------------------------------------------------------- */

const health = await api("/api/health");
check("health endpoint responds", health.status === 200 || health.status === 503, `HTTP ${health.status}`);
const dbReady = health.body?.database?.tablesReady === true;
console.log(`[e2e] database ready: ${dbReady}${dbReady ? "" : ` (${health.body?.database?.detail ?? "unknown"})`}`);

/* -------------------------------------------------------------------------- */
/* 2. auth                                                                    */
/* -------------------------------------------------------------------------- */

const user = {
  id: 900000001,
  first_name: "Test",
  last_name: "Player",
  username: "e2e_player",
};

if (!BOT_TOKEN) {
  check("bot token present", false, "TELEGRAM_BOT_TOKEN is missing");
} else {
  const valid = await api("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData: signInitData(user) }),
  });
  const cookie = valid.headers.get("set-cookie") ?? "";
  if (dbReady) {
    check("auth accepts valid initData", valid.status === 200 && Boolean(valid.body?.player?.id), `HTTP ${valid.status}`);
    check(
      "auth returns the nickname, not the @username",
      valid.body?.player?.name === "Test Player",
      String(valid.body?.player?.name),
    );
    check("the @username is kept as a separate handle", valid.body?.player?.username === "e2e_player", String(valid.body?.player?.username));
    check("auth sets an HttpOnly session cookie", /session=/.test(cookie) && /HttpOnly/i.test(cookie));
    if (valid.body?.player?.id) created.add(valid.body.player.id);
  } else {
    check(
      "auth fails closed when the database is unavailable",
      valid.status === 503 && valid.body?.code === "database_unavailable",
      `HTTP ${valid.status} ${valid.body?.code ?? ""}`,
    );
    check("no session cookie is issued when auth fails", !/session=/.test(cookie));
  }

  const tampered = await api("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData: signInitData(user).replace("e2e_player", "attacker_x") }),
  });
  check("auth rejects a tampered signature", tampered.status === 401, `HTTP ${tampered.status}`);

  const wrongBot = await api("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData: signInitData(user, "1:WRONG") }),
  });
  check("auth rejects a signature made with another bot token", wrongBot.status === 401, `HTTP ${wrongBot.status}`);

  const empty = await api("/api/auth/telegram", { method: "POST", body: JSON.stringify({}) });
  check("auth rejects an empty body", empty.status === 400, `HTTP ${empty.status}`);

  const garbage = await api("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData: "a=b&c=d" }),
  });
  check("auth rejects unsigned data", garbage.status === 401, `HTTP ${garbage.status}`);
}

/* -------------------------------------------------------------------------- */
/* 3. authorization                                                           */
/* -------------------------------------------------------------------------- */

const noCookie = await api("/api/lobbies");
check("lobby list requires a session", noCookie.status === 401, `HTTP ${noCookie.status}`);

const forgedCookie = await api("/api/lobbies", {
  headers: { Cookie: "session=eyJ1c2VySWQiOiJ4In0.ZmFrZQ" },
});
check("lobby list rejects a forged cookie", forgedCookie.status === 401, `HTTP ${forgedCookie.status}`);

for (const route of ["/api/profile", "/api/leaderboard", "/api/lobbies?current=1"]) {
  const response = await api(route);
  check(`${route.split("?")[0]} requires a session`, response.status === 401, `HTTP ${response.status}`);
}

/* -------------------------------------------------------------------------- */
/* 4. input validation                                                        */
/* -------------------------------------------------------------------------- */

const cookieHeader = { Cookie: "session=eyJ1c2VySWQiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5fQ.ZmFrZQ" };

const badCreate = await api("/api/lobbies", {
  method: "POST",
  headers: cookieHeader,
  body: JSON.stringify({ action: "create", name: "", mode: "PUBLIC", maxPlayers: 8 }),
});
check("create rejects an invalid room name", badCreate.status >= 400, `HTTP ${badCreate.status}`);

const badAction = await api("/api/lobbies", {
  method: "POST",
  headers: cookieHeader,
  body: JSON.stringify({ action: "delete_everything" }),
});
check("unknown actions are rejected", badAction.status >= 400, `HTTP ${badAction.status}`);

const badJson = await fetch(`${base}/api/lobbies`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader.Cookie },
  body: "{not json",
});
check("malformed JSON is handled", badJson.status >= 400, `HTTP ${badJson.status}`);

/* -------------------------------------------------------------------------- */
/* 5. pages render                                                            */
/* -------------------------------------------------------------------------- */

for (const route of ["/", "/profile", "/leaderboard", "/lobby/MAF-XXXXXX", "/game/MAF-XXXXXX"]) {
  const response = await fetch(`${base}${route}`, { cache: "no-store" });
  const html = await response.text();
  check(
    `${route} renders`,
    response.status === 200 && html.length > 500 && !html.includes("Application error"),
    `HTTP ${response.status}, ${html.length} bytes`,
  );
}

/* -------------------------------------------------------------------------- */
/* 6. layout invariants (multilingual width regression guard)                  */
/* -------------------------------------------------------------------------- */

const cssRaw = fs.readFileSync(path.join(root, "app", "globals.css"), "utf8");
// strip comments so documentation text cannot satisfy or break a rule
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

check("quick-card is not width-limited by content", /\.quick-card\s*\{[\s\S]*?width:\s*100%;/.test(css));
check("join-form is not width-limited by content", /\.join-form\s*\{[\s\S]*?width:\s*100%;/.test(css));
check("both cards declare min-width: 0", (css.match(/min-width: 0;/g) ?? []).length >= 4);
check("box-sizing is applied globally", /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing: border-box/.test(css));

// `width: 100%` and `max-width: 100%` are correct (fill the parent / clamp to it).
// Any *other* percentage — the original `width: 85%` bug — is not allowed.
function percentageWidths(selector) {
  const block = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";
  return [...block.matchAll(/(?<!max-)(?<!min-)width:\s*(\d+)%/g)]
    .map((match) => match[1])
    .filter((value) => value !== "100");
}
check(
  "quick-card has no shrunken percentage width",
  percentageWidths(".quick-card").length === 0,
  percentageWidths(".quick-card").join(", ") || "only width:100%",
);
check(
  "join-form has no shrunken percentage width",
  percentageWidths(".join-form").length === 0,
  percentageWidths(".join-form").join(", ") || "only width:100%",
);
check("reduced motion is respected", /prefers-reduced-motion/.test(css));
check("safe-area insets are handled", /env\(safe-area-inset-bottom/.test(css));
check("inputs use 16px to prevent iOS zoom", /\.join-form input\s*\{[\s\S]*?font-size: 16px;/.test(css));

// auto-fill / auto-fit / 1fr tracks are fluid; a bare `NNNpx` track is not
const gridTracks = [...css.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((match) => match[1].trim());
const rigid = gridTracks.filter((track) => /^\s*\d+px\s*$/.test(track));
check(
  "no rigid single-pixel grid tracks",
  rigid.length === 0,
  rigid.join(" | ") || `${gridTracks.length} fluid track definitions`,
);
check(
  "text containers wrap instead of clipping",
  /\.quick-card small\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/.test(css) &&
    /\.join-form input\s*\{[\s\S]*?min-width: 0;/.test(css),
);

/* -------------------------------------------------------------------------- */
/* 7. secrets hygiene                                                         */
/* -------------------------------------------------------------------------- */

const clientFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) clientFiles.push(full);
  }
})(path.join(root, "app"));
for (const extra of ["components", "lib"]) {
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) clientFiles.push(full);
    }
  })(path.join(root, extra));
}

const forbidden = [
  { label: "bot token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/ },
  { label: "supabase secret", pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: "service role jwt", pattern: /\beyJ[A-Za-z0-9_-]{40,}\./ },
  { label: "session secret literal", pattern: /b8d7c2a1e0f94837/ },
];

let leaks = 0;
for (const file of clientFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const { label, pattern } of forbidden) {
    if (pattern.test(content)) {
      console.log(`  !! ${label} literal found in ${path.relative(root, file)}`);
      leaks += 1;
    }
  }
}
check("no credential literals in application source", leaks === 0, `${leaks} leak(s)`);

const clientBundleHit = await fetch(`${base}/`);
const bundleHtml = await clientBundleHit.text();
check(
  "rendered HTML exposes no NEXT_PUBLIC secret",
  !bundleHtml.includes("sb_secret_") && !/eyJ[A-Za-z0-9_-]{40,}\./.test(bundleHtml),
);

/* -------------------------------------------------------------------------- */

await purge();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed.`);
killTree(child);
await new Promise((resolve) => setTimeout(resolve, 500));
process.exit(failed.length === 0 ? 0 : 1);
