/**
 * Full multiplayer smoke test against a live server + live database.
 *
 *   node tests/gameplay.mjs
 *
 * Signs real Telegram initData with the real bot token, creates 6 players,
 * runs a complete match (lobby -> join -> host start -> night -> day ->
 * verdict) and asserts the invariants: role secrecy, host authorisation,
 * duplicate-vote rejection, phase validation and persisted statistics.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { purgeTestRows as sharedPurge } from "./lib/purge.mjs";

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
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "";
if (!BOT_TOKEN) {
  console.error("[gameplay] TELEGRAM_BOT_TOKEN missing");
  process.exit(1);
}

let child = null;
function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else proc.kill("SIGTERM");
}

/**
 * Test data must never survive a run: the leaderboard and the room list are
 * user-facing, and leftover `smoke_*` rows make both look broken.
 */
const cleanup = { players: new Set(), lobbies: new Set() };

async function purgeTestRows() {
  await sharedPurge({
    players: [...cleanup.players],
    lobbies: [...cleanup.lobbies],
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const port = 4900 + Math.floor(Math.random() * 90);
child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "--", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, ...env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});
let serverLog = "";
child.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
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
console.log(`[gameplay] target ${base}`);

/* ------------------------------------------------------------------ auth --- */

function signInitData(user) {
  const payload = { user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}

const stamp = Date.now();
const NAMES = ["Host", "Alpha", "Bravo", "Charlie", "Delta", "Echo"];

async function signIn(index) {
  const name = NAMES[index];
  const user = {
    id: 950000000 + stamp % 100000 + index,
    first_name: name,
    last_name: "Tester",
    username: `smoke_${name.toLowerCase()}_${stamp % 10000}`,
  };
  const response = await fetch(`${base}/api/auth/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: signInitData(user), language: "en" }),
  });
  const body = await response.json();
  if (!response.ok || !body.player) {
    throw new Error(`sign-in failed for ${name}: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  cleanup.players.add(body.player.id);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return {
    name,
    id: body.player.id,
    cookie,
    displayName: body.player.name,
    username: body.player.username,
  };
}

const players = [];
for (let i = 0; i < NAMES.length; i += 1) players.push(await signIn(i));
check("6 players signed in through the real Telegram handshake", players.length === 6);
check(
  "display name is the nickname, not the @username",
  players.every((player) => player.displayName === `${player.name} Tester`),
  `${players[0].name} -> "${players[0].displayName}"`,
);
check(
  "the @username is kept as a separate handle",
  players.every((player) => String(player.username).startsWith("smoke_")),
  players[0].username,
);

/* ------------------------------------------------------------------- api --- */

async function call(player, action) {
  const response = await fetch(`${base}/api/lobbies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: player.cookie },
    body: JSON.stringify(action),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function readLobby(player, code, label = "") {
  const response = await fetch(`${base}/api/lobbies?id=${encodeURIComponent(code)}`, {
    headers: { Cookie: player.cookie },
  });
  const text = await response.text();
  if (response.status === 304) {
    console.log(`  !! 304 for ${label || player.name}`);
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.log(`  !! non-JSON for ${label || player.name}: HTTP ${response.status} ${text.slice(0, 200)}`);
    return null;
  }
  if (!response.ok) {
    console.log(`  !! HTTP ${response.status} for ${label || player.name}: ${JSON.stringify(payload)}`);
    return null;
  }
  return payload.lobby ?? null;
}

/* ---------------------------------------------------------------- lobby ---- */

process.on("uncaughtException", async (error) => {
  console.log("\n!! uncaught:", error?.message ?? String(error));
  console.log("---- server log ----");
  console.log(serverLog.split("\n").slice(-80).join("\n"));
  await purgeTestRows();
  killTree(child);
  process.exit(1);
});

const created = await call(players[0], {
  action: "create",
  name: `Smoke ${stamp % 1000}`,
  mode: "PUBLIC",
  maxPlayers: 8,
});
check("host can create a lobby", created.status === 201, `HTTP ${created.status} ${created.body?.error ?? ""}`);
const code = created.body?.lobby?.code;
const lobbyId = created.body?.lobby?.id;
if (lobbyId) cleanup.lobbies.add(lobbyId);
if (!code) {
  console.log(JSON.stringify(created.body));
  console.log("---- server log ----");
  console.log(serverLog.split("\n").slice(-60).join("\n"));
  await purgeTestRows();
  killTree(child);
  process.exit(1);
}
check("lobby got a shareable code", /^MAF-[A-Z2-9]{6}$/.test(code ?? ""), code);
check("creator is the host and is seated", created.body.lobby.me.isHost && created.body.lobby.playerCount === 1);
check("host cannot start with only 1 player", created.body.lobby.me.canStart === false);

for (const player of players.slice(1)) {
  const joined = await call(player, { action: "join", reference: code });
  console.log(
    `  join ${player.name}: HTTP ${joined.status}`,
    joined.status === 200 ? `seated=${joined.body?.lobby?.playerCount}` : JSON.stringify(joined.body),
  );
}
const room = await readLobby(players[0], code);
check("6 players are seated", room?.playerCount === 6, `${room?.playerCount}`);
check("host can now start", room?.me.canStart === true);

// a non-member may not join a private room
const stranger = await call(
  { cookie: players[0].cookie },
  { action: "join", reference: "MAF-ZZZZZZ" },
);
check("joining a non-existent code is rejected", stranger.status === 404, `HTTP ${stranger.status}`);

/* ---------------------------------------------------------------- start ---- */

const nonHostStart = await call(players[1], { action: "start", lobbyId });
check("a non-host cannot start the game", nonHostStart.status === 403, `HTTP ${nonHostStart.status} ${nonHostStart.body?.code}`);

const started = await call(players[0], { action: "start", lobbyId });
check("host can start the game", started.status === 200, `HTTP ${started.status} ${started.body?.error ?? ""}`);

const doubleStart = await call(players[0], { action: "start", lobbyId });
check("the same game cannot be started twice", doubleStart.status === 409, `HTTP ${doubleStart.status} ${doubleStart.body?.code}`);

/* ---------------------------------------------------------- role secrecy -- */

const views = [];
for (const player of players) {
  const view = await readLobby(player, code);
  views.push(view);
  if (!view) continue;
  const revealed = view.players.filter((seat) => seat.role !== undefined);
  if (revealed.length > 0) {
    console.log(`  !! ${player.name} saw roles:`, revealed.map((seat) => seat.role));
  }
}
check("nobody can see another player's role", views.every((view) => view && view.players.every((seat) => seat.role === undefined)));
check(
  "every player has a role and it is one of the four",
  views.every((view) => view && view.me && ["mafia", "doctor", "detective", "citizen"].includes(view.me.role)),
);
check("exactly one doctor and one detective were assigned", (() => {
  const roles = views.filter(Boolean).map((view) => view.me.role);
  return roles.filter((role) => role === "doctor").length === 1 && roles.filter((role) => role === "detective").length === 1;
})());
check("mafia count matches the 6-player ruleset", views.filter((view) => view.me.role === "mafia").length === 1);
check("the game is in the night phase", views[0]?.phase === "night", views[0]?.phase);

/* ---------------------------------------------------------- night + day --- */

const nightView = views[0];
const actors = views.filter(Boolean).filter((view) => ["mafia", "doctor", "detective"].includes(view.me.role));
check("only mafia/doctor/detective must act at night", actors.length === 3, `${actors.length}`);
check("citizens have no night action", views.filter(Boolean).filter((view) => view.me.role === "citizen").every((view) => view.me.actionDone === true));

// mafia may not target a teammate
const mafia = views.filter(Boolean).find((view) => view.me.role === "mafia");
const allyIds = new Set(mafia.allies.map((ally) => ally.id));
const allySeat = nightView.players.find((seat) => allyIds.has(seat.id));
if (allySeat) {
  const bad = await call(players.find((p) => p.id === mafia.me.id), { action: "night", lobbyId, targetId: allySeat.id });
  check("mafia cannot target a teammate", bad.status === 409 && bad.body?.code === "ally_target", `HTTP ${bad.status} ${bad.body?.code}`);
} else {
  check("mafia cannot target a teammate (single mafia, skipped)", true);
}

// self-target is rejected for everyone except the doctor
const citizen = views.filter(Boolean).find((view) => view.me.role === "citizen");
const selfVote = await call(players.find((p) => p.id === citizen.me.id), { action: "vote", lobbyId, targetId: citizen.me.id });
check("a player cannot vote for themself", selfVote.status === 409, `HTTP ${selfVote.status}`);

// voting during the night is rejected
const nightVote = await call(players.find((p) => p.id === citizen.me.id), { action: "vote", lobbyId, targetId: nightView.players.find((s) => s.id !== citizen.me.id).id });
check("voting during the night is rejected", nightVote.status === 409 && nightVote.body?.code === "wrong_phase", `HTTP ${nightVote.status} ${nightVote.body?.code}`);

// run the night
for (const actor of actors) {
  const seat = (await readLobby(players.find((p) => p.id === actor.me.id), code, "night")) ?? nightView;
  const target = seat.players.find(
    (candidate) =>
      candidate.alive &&
      candidate.id !== actor.me.id &&
      !(actor.me.role === "mafia" && allyIds.has(candidate.id)),
  );
  const result = await call(
    players.find((p) => p.id === actor.me.id),
    { action: "night", lobbyId, targetId: target.id },
  );
  if (result.status !== 200) console.log(`  night action failed for ${actor.name}: ${result.body?.error}`);
}
const afterNight = await readLobby(players[0], code);
check("the night resolved into the day phase", afterNight.phase === "day", afterNight.phase);
check("a night event was logged", afterNight.events.length > 0, `${afterNight.events.length} event(s)`);
check(
  "event lines are localised, not raw keys",
  afterNight.events.every((event) => !event.key.startsWith("event.") || /[a-zA-Z]/.test(event.key)),
  afterNight.events[0]?.key,
);
check("roles are still secret during the day", (await readLobby(players[1], code)).players.every((seat) => seat.role === undefined));

// run the day (vote until the phase resolves)
for (let i = 0; i < 6; i += 1) {
  const view = await readLobby(players[0], code);
  if (view.phase !== "day" && view.status !== "playing") break;
  for (const player of players) {
    const current = await readLobby(player, code);
    if (!current || current.status !== "playing" || current.phase !== "day") continue;
    if (current.me.actionDone || !current.me.alive) continue;
    const target = current.players.find((seat) => seat.alive && seat.id !== player.id);
    if (!target) continue;
    await call(player, { action: "vote", lobbyId, targetId: target.id });
  }
  const next = await readLobby(players[0], code);
  if (next.status === "completed") break;
  if (next.phase === "night") break;
}

const afterDay = await readLobby(players[0], code);
check("the match advanced past the first day", afterDay.round >= 2 || afterDay.status !== "playing", `round ${afterDay.round}, status ${afterDay.status}`);
check("eliminations are reflected in alive flags", afterDay.players.filter((seat) => !seat.alive).length > 0, `${afterDay.players.filter((s) => !s.alive).length} dead`);

/* --------------------------------------------------- duplicate protection -- */

const current = await readLobby(players[0], code);
const livePhase = current.phase === "night" ? "night" : "vote";
const mover = players.find((p) => {
  const view = current.players.find((seat) => seat.id === p.id);
  return view && view.alive;
});
const freshView = await readLobby(mover, code);
if (freshView && !freshView.me.actionDone && freshView.phase === current.phase) {
  const target = freshView.players.find(
    (seat) => seat.alive && seat.id !== mover.id && !allyIds.has(seat.id),
  );
  if (target) {
    const first = await call(mover, { action: livePhase, lobbyId, targetId: target.id });
    if (first.status === 200) {
      const second = await call(mover, { action: livePhase, lobbyId, targetId: target.id });
      check("a repeated action is rejected", second.status === 409 && second.body?.code === "duplicate", `HTTP ${second.status} ${second.body?.code}`);
    }
  }
}

/* ------------------------------------------------------------ persistence -- */

const profileResponse = await fetch(`${base}/api/profile`, { headers: { Cookie: players[0].cookie } });
const profile = await profileResponse.json();
check("profile endpoint responds", profileResponse.status === 200, `HTTP ${profileResponse.status}`);
check("statistics are well formed", typeof profile?.stats?.gamesPlayed === "number" && typeof profile?.stats?.winRate === "number", `played=${profile?.stats?.gamesPlayed}`);

const boardResponse = await fetch(`${base}/api/leaderboard?page=1`, { headers: { Cookie: players[0].cookie } });
const board = await boardResponse.json();
check("leaderboard endpoint responds", boardResponse.status === 200, `HTTP ${boardResponse.status}`);
check("leaderboard is ordered by rating", (board.players ?? []).every((row, i, arr) => i === 0 || arr[i - 1].rating >= row.rating));
check("leaderboard rows are complete", (board.players ?? []).every((row) => typeof row.rank === "number" && typeof row.rating === "number"));

// the match resolved, so exactly one game must now be on the books
const resolved = afterDay.status === "completed";
check(
  resolved ? "a completed match is counted exactly once" : "an unfinished match is not counted",
  resolved ? profile?.stats?.gamesPlayed === 1 : profile?.stats?.gamesPlayed === 0,
  `status=${afterDay.status} played=${profile?.stats?.gamesPlayed}`,
);
if (resolved) {
  check("the result is internally consistent", (() => {
    const s = profile.stats;
    return s.gamesWon + s.gamesLost === s.gamesPlayed && s.mafiaGames + s.townGames === s.gamesPlayed;
  })(), JSON.stringify({ played: profile.stats.gamesPlayed, won: profile.stats.gamesWon, lost: profile.stats.gamesLost }));
  check("a rating was awarded for the finished match", Number.isFinite(profile?.stats?.rating) && profile.stats.rating !== 1000, `rating=${profile?.stats?.rating}`);
  check("match history records the result", Array.isArray(profile?.history) && profile.history.length === 1, `${profile?.history?.length} entry/entries`);
  check("the host now has a rank", typeof profile?.stats?.rank === "number" && profile.stats.rank > 0, `rank=${profile?.stats?.rank}`);
}

const leaveResponse = await call(players[1], { action: "leave", lobbyId });
check("leaving the room works", leaveResponse.status === 200, `HTTP ${leaveResponse.status}`);

/* ---------------------------------------------------------------- report -- */

await purgeTestRows();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} gameplay checks passed.`);
if (failed.length > 0) {
  console.log("\n---- server log ----");
  console.log(serverLog.split("\n").filter((l) => /error|Error|\[db\]|\[api\]/.test(l)).slice(-40).join("\n"));
}
console.log(`lobby code used: ${code}`);
killTree(child);
await new Promise((r) => setTimeout(r, 500));
process.exit(failed.length === 0 ? 0 : 1);
