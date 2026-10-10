/**
 * End-to-end database verification: proves the schema exists and that real
 * INSERT / SELECT / UPDATE / DELETE round-trips work against the live project.
 *
 *   npm run db:check
 *
 * Requires supabase/migrations to have been applied (npm run db:migrate).
 * Creates and removes a throw-away player row; never touches existing data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
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
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("[db:check] SUPABASE_URL / SUPABASE_KEY are not configured.");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const stamp = Date.now();
const telegramId = 9_000_000_000_000_000n + BigInt(stamp % 1_000_000);
let createdId = null;

// 1. schema present -----------------------------------------------------------
const probe = await rest("players?select=id&limit=1");
if (probe.status === 200) {
  record("schema: players table reachable", true);
} else if (probe.status === 404 && String(probe.body?.message ?? "").includes("schema cache")) {
  record("schema: players table reachable", false, "table missing — run `npm run db:migrate`");
  console.log("\nAborting: schema not provisioned.");
  process.exit(1);
} else {
  record("schema: players table reachable", false, `HTTP ${probe.status}`);
  process.exit(1);
}

// 2. INSERT -------------------------------------------------------------------
const insert = await rest("players", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    telegram_id: telegramId.toString(),
    username: `dbcheck_${stamp}`,
    first_name: "DB",
    last_name: "Check",
    display_name: `dbcheck_${stamp}`,
    photo_url: null,
    language: "en",
  }),
});
if (insert.status === 201 && Array.isArray(insert.body) && insert.body[0]?.id) {
  createdId = insert.body[0].id;
  record("write: INSERT player", true, createdId);
} else {
  record("write: INSERT player", false, `HTTP ${insert.status} ${JSON.stringify(insert.body)}`);
  process.exit(1);
}

// 3. SELECT -------------------------------------------------------------------
const read = await rest(`players?id=eq.${createdId}&select=id,display_name,rating`);
if (read.status === 200 && read.body?.[0]?.display_name === `dbcheck_${stamp}`) {
  record("read: SELECT player by id", true, `rating=${read.body[0].rating}`);
} else {
  record("read: SELECT player by id", false, `HTTP ${read.status}`);
}

// 4. UPDATE -------------------------------------------------------------------
const update = await rest(`players?id=eq.${createdId}`, {
  method: "PATCH",
  body: JSON.stringify({ language: "ru" }),
});
const updated = await rest(`players?id=eq.${createdId}&select=language`);
if (updated.status === 200 && updated.body?.[0]?.language === "ru") {
  record("write: UPDATE player", true);
} else {
  record("write: UPDATE player", false, `HTTP ${update.status}/${updated.status}`);
}

// 5. Atomic RPC: join_lobby ----------------------------------------------------
const lobbyInsert = await rest("lobbies", {
  method: "POST",
  body: JSON.stringify({
    code: `CHK-${stamp.toString().slice(-6)}`,
    name: "db-check",
    mode: "PRIVATE",
    status: "waiting",
    phase: "waiting",
    host_id: createdId,
    max_players: 8,
    state: {},
  }),
});
if (lobbyInsert.status === 201 && lobbyInsert.body?.[0]?.id) {
  const lobbyId = lobbyInsert.body[0].id;
  record("write: INSERT lobby", true, lobbyId);

  const joined = await rest("rpc/join_lobby", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_lobby_id: lobbyId, p_player_id: createdId }),
  });
  record("rpc: join_lobby", joined.status === 200 || joined.status === 204, `HTTP ${joined.status}`);

  const notEnough = await rest("rpc/start_game", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_lobby_id: lobbyId, p_player_id: createdId, p_min_players: 5 }),
  });
  const msg = String(notEnough.body?.message ?? "");
  record(
    "rpc: start_game rejects a short lobby",
    notEnough.status >= 400 && msg.includes("not_enough_players"),
    msg || `HTTP ${notEnough.status}`,
  );

  const left = await rest("rpc/leave_lobby", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_lobby_id: lobbyId, p_player_id: createdId }),
  });
  record("rpc: leave_lobby", left.status === 200 || left.status === 204, `HTTP ${left.status}`);

  const board = await rest("rpc/leaderboard", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ p_limit: 5, p_offset: 0 }),
  });
  record("rpc: leaderboard", board.status === 200, `HTTP ${board.status}`);

  await rest(`lobbies?id=eq.${lobbyId}`, { method: "DELETE" });
} else {
  record("write: INSERT lobby", false, `HTTP ${lobbyInsert.status} ${JSON.stringify(lobbyInsert.body)}`);
}

// 6. DELETE -------------------------------------------------------------------
const cleanup = await rest(`players?id=eq.${createdId}`, { method: "DELETE" });
record("write: DELETE player", cleanup.status >= 200 && cleanup.status < 300, `HTTP ${cleanup.status}`);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
