/**
 * Proves the Realtime push path really works end to end.
 *
 *   npm run test:realtime
 *
 * A real Supabase client (publishable key, as the browser uses) subscribes to
 * the shared channel. The test then performs a real API action, which makes the
 * server publish a broadcast. If the message never arrives, the push path is
 * broken and the app is silently falling back to polling.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
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
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}
const env = { ...loadEnvFile(path.join(root, ".env.local")), ...loadEnvFile(path.join(root, ".env")) };

/* Read the constants straight out of the source. A hardcoded copy here would
 * let server and client drift apart again without this test noticing. */
const channelSource = fs.readFileSync(path.join(root, "lib/game/realtime-channel.ts"), "utf8");
function constantFromSource(name) {
  const match = channelSource.match(new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`could not read ${name} from lib/game/realtime-channel.ts`);
  return match[1];
}
const REALTIME_CHANNEL = constantFromSource("REALTIME_CHANNEL");
const REALTIME_EVENT = constantFromSource("REALTIME_EVENT");

const serverSource = fs.readFileSync(path.join(root, "lib/game/realtime.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "components/use-lobby.ts"), "utf8");
for (const [label, source] of [["server", serverSource], ["client", clientSource]]) {
  if (!source.includes("REALTIME_CHANNEL")) {
    throw new Error(`${label} no longer uses the shared REALTIME_CHANNEL constant`);
  }
  if (new RegExp(`channel\\(\\s*[\`'"]lobby:`).test(source)) {
    throw new Error(`${label} still subscribes to a per-lobby channel`);
  }
}
console.log(`[realtime] channel "${REALTIME_CHANNEL}" / event "${REALTIME_EVENT}" shared by server, client and this test`);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log("[realtime] NEXT_PUBLIC_SUPABASE_* missing — skipped");
  process.exit(2);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("[realtime] SUPABASE_SERVICE_ROLE_KEY missing — skipped");
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

const created = { players: new Set(), lobbies: new Set() };
async function purge() {
  await purgeTestRows({ players: [...created.players], lobbies: [...created.lobbies] });
}

const port = 5700 + Math.floor(Math.random() * 200);
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

async function signIn(id, first, username) {
  const response = await fetch(`${base}/api/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      initData: signInitData({ id, first_name: first, last_name: "RT", username }),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.player) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  created.players.add(body.player.id);
  return { cookie: (response.headers.get("set-cookie") ?? "").split(";")[0], id: body.player.id };
}

const stamp = Date.now();
const tag = stamp % 10000;
// prefixed so `npm run db:clean` still sweeps us up if a run dies mid-way
const host = await signIn(980000000 + (stamp % 9000), "RtHost", `probe_rt_host_${tag}`);
const guest = await signIn(980000000 + (stamp % 9000) + 1, "RtGuest", `probe_rt_guest_${tag}`);

const create = await fetch(`${base}/api/lobbies`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: host.cookie },
  body: JSON.stringify({ action: "create", name: "probe realtime", mode: "PUBLIC", maxPlayers: 8 }),
});
const createdBody = await create.json();
const lobbyId = createdBody?.lobby?.id;
const lobbyCode = createdBody?.lobby?.code;
if (lobbyId) created.lobbies.add(lobbyId);
check("lobby created for the realtime probe", create.status === 201, `HTTP ${create.status}`);

/* ------------------------------------------------ subscribe like a browser */

const browser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: WebSocket },
});

const pings = [];
let subscribed = false;

const channel = browser
  .channel(REALTIME_CHANNEL)
  .on("broadcast", { event: REALTIME_EVENT }, (message) => {
    pings.push(message?.payload);
  })
  .subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

for (let i = 0; i < 20 && !subscribed; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
}
check("a browser client can subscribe to the shared channel", subscribed);

/* --------------------------------------------------- trigger a server push */

const before = pings.length;

// a real join makes the server publish a lobby change
const join = await fetch(`${base}/api/lobbies`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: guest.cookie },
  body: JSON.stringify({ action: "join", reference: lobbyCode }),
});
check("guest joined the lobby (server publishes on this)", join.status === 200, `HTTP ${join.status}`);

let arrived = null;
for (let i = 0; i < 24; i += 1) {
  await new Promise((r) => setTimeout(r, 250));
  if (pings.length > before) {
    arrived = pings[pings.length - 1];
    break;
  }
}

check("the broadcast was delivered without polling", arrived !== null);
check("the payload carries the lobby id", arrived?.lobbyId === lobbyId, String(arrived?.lobbyId));
check("the payload names the change", typeof arrived?.reason === "string" && arrived.reason.length > 0, arrived?.reason);
check("the payload carries a version", typeof arrived?.version === "number", String(arrived?.version));

/* the client filter must ignore pings meant for a different lobby */
const foreign = { ...arrived, lobbyId: "00000000-0000-0000-0000-000000000000" };
check(
  "the client filter ignores another lobby's ping",
  foreign.lobbyId !== lobbyId && pings.every((entry) => entry.lobbyId === lobbyId),
  `received: ${pings.map((entry) => entry.lobbyId).join(", ") || "none"}`,
);

await browser.removeChannel(channel);
await purge();
killTree(child);
await new Promise((r) => setTimeout(r, 400));

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} realtime checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
