/**
 * Removes test/demo data from the database.
 *
 *   npm run db:clean            # dry run — prints what would be deleted
 *   npm run db:clean -- --yes   # actually deletes
 *
 * Safety: a player is only considered test data when its Telegram username
 * matches one of the prefixes the test suites generate (`smoke_`, `e2e_`,
 * `cfg_`, `probe_`, `join_probe_`, `lobby_probe_`, `seq_probe_`, `dbcheck_`,
 * `nav_`, `rt_host_`, `rt_guest_`, `anonymous`). Real players never match, so
 * this cannot delete a real account. Anything unmatched is listed and left
 * untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const TEST_PREFIXES = [
  "smoke_",
  "e2e_",
  "cfg_",
  "probe_",
  "join_probe_",
  "lobby_probe_",
  "seq_probe_",
  "dbcheck_",
  "nav_",
  "layout_",
  "test_",
  "rt_host_",
  "rt_guest_",
];

const TEST_LOBBY_PREFIXES = ["Smoke", "Navigation Test", "probe", "join probe", "seq", "db-check", "Realtime probe"];

const apply = process.argv.includes("--yes");

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: WebSocket },
});

function isTestPlayer(row) {
  const handle = String(row.username ?? "").toLowerCase();
  const name = String(row.display_name ?? "").toLowerCase();
  return TEST_PREFIXES.some(
    (prefix) => handle.startsWith(prefix) || name.startsWith(prefix),
  );
}

function isTestLobby(row) {
  const name = String(row.name ?? "").toLowerCase();
  return TEST_LOBBY_PREFIXES.some((prefix) => name.startsWith(prefix.toLowerCase()));
}

const { data: players, error: playersError } = await db
  .from("mc_players")
  .select("id, telegram_id, username, display_name, games_played");
if (playersError) {
  console.error("[db:clean] cannot read players:", playersError.message);
  process.exit(1);
}

const doomedPlayers = (players ?? []).filter(isTestPlayer);
const keepPlayers = (players ?? []).filter((row) => !isTestPlayer(row));

const { data: lobbies, error: lobbiesError } = await db
  .from("mc_lobbies")
  .select("id, code, name, status");
if (lobbiesError) {
  console.error("[db:clean] cannot read lobbies:", lobbiesError.message);
  process.exit(1);
}

const doomedLobbies = (lobbies ?? []).filter(isTestLobby);
const keepLobbies = (lobbies ?? []).filter((row) => !isTestLobby(row));

console.log(`[db:clean] ${apply ? "APPLYING" : "DRY RUN — pass --yes to delete"}\n`);
console.log(`  players: ${doomedPlayers.length} to delete, ${keepPlayers.length} to keep`);
console.log(`  lobbies: ${doomedLobbies.length} to delete, ${keepLobbies.length} to keep\n`);

if (keepPlayers.length > 0) {
  console.log("  keeping (real accounts):");
  for (const row of keepPlayers) {
    console.log(`    @${row.username ?? "?"}  name=${row.display_name}  played=${row.games_played}`);
  }
  console.log("");
}

if (!apply) {
  console.log("  would delete:");
  for (const row of doomedPlayers) console.log(`    player @${row.username} (${row.telegram_id})`);
  for (const row of doomedLobbies) console.log(`    lobby  ${row.code} "${row.name}"`);
  process.exit(0);
}

if (doomedLobbies.length > 0) {
  // cascades clear members, games, players, events and investigations
  const { error } = await db
    .from("mc_lobbies")
    .delete()
    .in("id", doomedLobbies.map((row) => row.id));
  if (error) {
    console.error("[db:clean] lobby delete failed:", error.message);
    process.exit(1);
  }
  console.log(`  deleted ${doomedLobbies.length} lobby/lobbies (cascade)`);
}

if (doomedPlayers.length > 0) {
  const { error } = await db
    .from("mc_players")
    .delete()
    .in("id", doomedPlayers.map((row) => row.id));
  if (error) {
    console.error("[db:clean] player delete failed:", error.message);
    process.exit(1);
  }
  console.log(`  deleted ${doomedPlayers.length} player(s)`);
}

// any orphan rows left behind by earlier runs
for (const table of ["mc_lobby_members", "mc_game_events", "mc_investigations", "mc_game_players"]) {
  const { count } = await db.from(table).select("*", { count: "exact", head: true });
  if (count) console.log(`  ${table}: ${count} row(s) still present`);
}
const { count: gamesLeft } = await db.from("mc_games").select("*", { count: "exact", head: true });
if (gamesLeft) console.log(`  mc_games: ${gamesLeft} row(s) still present`);

console.log("\n[db:clean] done");
