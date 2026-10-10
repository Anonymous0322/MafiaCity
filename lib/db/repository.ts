import { getSupabase, getDbConfig, isDatabaseConfigured } from "@/lib/db/client";
import type {
  GameEventView,
  GamePhase,
  GamePlayer,
  GameRole,
  GameWinner,
  Language,
  LeaderboardRow,
  LeaderboardView,
  LobbyMode,
  LobbyState,
  LobbyStatus,
  LobbySummary,
  LobbyView,
  MatchHistoryEntry,
  PlayerProfile,
  PlayerStats,
  PublicPlayer,
  SeatView,
} from "@/lib/types";
import {
  allNightActionsSubmitted,
  allVotesSubmitted,
  evaluateWinState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nightActionSubmitted,
  resolveNight,
  resolveVotes,
  RULES,
  validateNightTarget,
  validateVote,
} from "@/lib/game/rules";

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

type PlayerRow = {
  id: string;
  telegram_id: number | string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  display_name: string;
  photo_url: string | null;
  language: Language;
  games_played: number;
  games_won: number;
  games_lost: number;
  mafia_games: number;
  mafia_wins: number;
  town_games: number;
  town_wins: number;
  rating: number | string;
  peak_rating: number | string;
  last_seen_at: string;
};

type LobbyRow = {
  id: string;
  code: string;
  name: string;
  mode: LobbyMode;
  status: LobbyStatus;
  phase: GamePhase;
  round_number: number;
  host_id: string;
  max_players: number;
  winner: GameWinner | null;
  version: number | string;
  state: LobbyState | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type MemberRow = {
  id: string;
  lobby_id: string;
  player_id: string;
  seat: number;
  is_host: boolean;
  is_alive: boolean;
  role: GameRole | null;
  joined_at: string;
};

type GameRow = {
  id: string;
  lobby_id: string;
  status: "active" | "completed" | "cancelled";
  winner: GameWinner | null;
  rounds_played: number;
  player_count: number;
  started_at: string;
  finished_at: string | null;
};

type EventRow = {
  id: number | string;
  round_number: number;
  phase: GamePhase;
  kind: string;
  message_key: string;
  params: Record<string, string | number | boolean | string[]>;
};

type InvestigationRow = {
  detective_id: string;
  target_id: string;
  is_mafia: boolean;
  round_number: number;
};

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "too_small"
  | "full"
  | "in_progress"
  | "already_started"
  | "not_enough_players"
  | "wrong_phase"
  | "duplicate"
  | "self_target"
  | "dead"
  | "no_night_action"
  | "ally_target"
  | "not_member"
  | "database_unavailable"
  | "unknown";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Postgres raise_exception messages -> stable app error codes. */
const PG_ERROR_MAP: Record<string, AppErrorCode> = {
  lobby_not_found: "not_found",
  lobby_in_progress: "in_progress",
  lobby_full: "full",
  player_in_other_lobby: "conflict",
  not_host: "forbidden",
  not_enough_players: "not_enough_players",
  game_already_started: "already_started",
  game_not_found: "not_found",
  duplicate_key: "duplicate",
};

/** PostgREST returns { message, code, details, hint }; keep the useful parts. */
function describeError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as Record<string, unknown>;
  const parts = [record.message, record.details, record.hint, record.code]
    .filter((part) => typeof part === "string" && part.length > 0)
    .map((part) => String(part).trim());
  if (parts.length === 0) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return parts.join(" | ");
}

function translatePgError(error: unknown): AppError {
  const raw = describeError(error);
  // Postgres wraps our own raise_exception text in a longer message
  const key = Object.keys(PG_ERROR_MAP).find((candidate) => raw.includes(candidate));
  if (key) {
    const code = PG_ERROR_MAP[key];
    const status =
      code === "not_found" ? 404 : code === "forbidden" ? 403 : code === "unauthorized" ? 401 : 409;
    return new AppError(code, key, status);
  }
  // unique_violation from PostgREST arrives as code 23505
  const pgCode = (error as { code?: string } | null)?.code;
  if (pgCode === "23505") return new AppError("duplicate", "duplicate", 409);
  if (pgCode === "42501") return new AppError("forbidden", "forbidden", 403);
  if (pgCode === "23503") return new AppError("invalid", "foreign_key_violation", 400);
  if (pgCode === "23514") return new AppError("invalid", "check_violation", 400);
  // a value that does not fit the column type (e.g. a room code sent as a uuid)
  if (pgCode === "22P02") return new AppError("invalid", "invalid_identifier", 400);
  if (pgCode === "PGRST108") return new AppError("unknown", "bad_embed", 500);
  if (pgCode === "PGRST205") return new AppError("not_found", "table_missing", 500);

  console.error("[db] unhandled PostgREST error:", raw);
  return new AppError("unknown", "database_error", 500);
}

function db(): ReturnType<typeof getSupabase> {
  return getSupabase();
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

export function toPublicPlayer(row: PlayerRow): PublicPlayer {
  return {
    id: row.id,
    name: row.display_name,
    username: row.username ?? "",
    avatar: row.photo_url ?? null,
  };
}

export function toProfile(row: PlayerRow): PlayerProfile {
  return {
    ...toPublicPlayer(row),
    telegramId: String(row.telegram_id),
    firstName: row.first_name,
    lastName: row.last_name,
    language: row.language,
  };
}

export type TelegramProfileInput = {
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  displayName: string;
  photoUrl?: string;
  language?: Language;
};

/**
 * Upsert on the verified Telegram id. Profile fields always come from the
 * server-validated `initData`, never from the client body.
 */
export async function upsertPlayer(input: TelegramProfileInput): Promise<PlayerRow> {
  const { data, error } = await db()
    .from("mc_players")
    .upsert(
      {
        telegram_id: input.telegramId,
        username: input.username ?? null,
        first_name: input.firstName,
        last_name: input.lastName ?? null,
        display_name: input.displayName,
        photo_url: input.photoUrl ?? null,
        language: input.language ?? "uz",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "telegram_id" },
    )
    .select()
    .single();
  if (error) throw translatePgError(error);
  return data as PlayerRow;
}

export async function getPlayerById(id: string): Promise<PlayerRow | null> {
  const { data, error } = await db().from("mc_players").select("*").eq("id", id).maybeSingle();
  if (error) throw translatePgError(error);
  return (data as PlayerRow | null) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Code generation                                                            */
/* -------------------------------------------------------------------------- */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateLobbyCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `MAF-${code}`;
}

/* -------------------------------------------------------------------------- */
/* Lobbies                                                                    */
/* -------------------------------------------------------------------------- */

export async function listOpenLobbies(): Promise<LobbyRow[]> {
  const { data, error } = await db()
    .from("mc_lobbies")
    .select("*")
    .eq("status", "waiting")
    .eq("mode", "PUBLIC")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw translatePgError(error);
  return (data ?? []) as LobbyRow[];
}

export async function getLobbyById(id: string): Promise<LobbyRow | null> {
  const { data, error } = await db().from("mc_lobbies").select("*").eq("id", id).maybeSingle();
  if (error) throw translatePgError(error);
  return (data as LobbyRow | null) ?? null;
}

export async function getLobbyByCode(code: string): Promise<LobbyRow | null> {
  const normalised = code.trim().toUpperCase();
  const { data, error } = await db()
    .from("mc_lobbies")
    .select("*")
    .eq("code", normalised)
    .maybeSingle();
  if (error) throw translatePgError(error);
  return (data as LobbyRow | null) ?? null;
}

/** The lobby a player is currently sitting in (waiting/starting/playing). */
export async function getActiveLobbyForPlayer(playerId: string): Promise<LobbyRow | null> {
  const { data, error } = await db()
    .from("mc_lobby_members")
    .select("lobby_id, mc_lobbies!inner(*)")
    .eq("player_id", playerId)
    .is("left_at", null)
    .in("mc_lobbies.status", ["waiting", "starting", "playing"])
    .limit(1)
    .maybeSingle();
  if (error) throw translatePgError(error);
  const row = data as { lobby_id: string; mc_lobbies: LobbyRow } | null;
  return row?.mc_lobbies ?? null;
}

export async function createLobby(input: {
  hostId: string;
  name: string;
  mode: LobbyMode;
  maxPlayers: number;
}): Promise<LobbyRow> {
  const maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, input.maxPlayers));
  // retry on the (astronomically unlikely) code collision
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await db()
      .from("mc_lobbies")
      .insert({
        code: generateLobbyCode(),
        name: input.name,
        mode: input.mode,
        host_id: input.hostId,
        max_players: maxPlayers,
        status: "waiting",
        phase: "waiting",
        state: {},
      })
      .select()
      .single();
    if (!error) return data as LobbyRow;
    if (error.code === "23505" && attempt < 4) continue;
    throw translatePgError(error);
  }
  throw new AppError("conflict", "Could not allocate a room code", 409);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lobby can be referenced by its code (`MAF-XXXXXX`) or its uuid. The shape
 * has to be checked first: sending a code into a uuid column makes Postgres
 * raise `invalid_text_representation`, which would surface as a 500 instead of
 * a clean "not found".
 */
export async function resolveLobby(reference: string): Promise<LobbyRow> {
  const value = reference.trim();
  if (UUID_PATTERN.test(value)) {
    const byId = await getLobbyById(value);
    if (byId) return byId;
  }
  const byCode = await getLobbyByCode(value);
  if (byCode) return byCode;
  throw new AppError("not_found", "lobby_not_found", 404);
}

/** Join through the transactional RPC so seat/race conditions are impossible. */
export async function joinLobby(lobbyRef: string, playerId: string): Promise<LobbyRow> {
  const lobby = await resolveLobby(lobbyRef);
  const { data, error } = await db().rpc("join_lobby", {
    p_lobby_id: lobby.id,
    p_player_id: playerId,
  });
  if (error) throw translatePgError(error);
  const updated = data as LobbyRow | null;
  if (updated) return updated;
  return (await getLobbyById(lobby.id))!;
}

export async function leaveLobby(lobbyRef: string, playerId: string): Promise<void> {
  const lobby = await resolveLobby(lobbyRef);
  const { error } = await db().rpc("leave_lobby", {
    p_lobby_id: lobby.id,
    p_player_id: playerId,
  });
  if (error) throw translatePgError(error);
}

/** Host-only, atomic, single-shot. Delegates validation to Postgres. */
export async function startLobbyGame(lobbyRef: string, playerId: string): Promise<LobbyRow> {
  const lobby = await resolveLobby(lobbyRef);
  const { data, error } = await db().rpc("start_game", {
    p_lobby_id: lobby.id,
    p_player_id: playerId,
    p_min_players: MIN_PLAYERS,
  });
  if (error) throw translatePgError(error);
  const payload = data as { lobby: LobbyRow } | null;
  return payload?.lobby ?? (await getLobbyById(lobby.id))!;
}

/* -------------------------------------------------------------------------- */
/* Members & game state                                                       */
/* -------------------------------------------------------------------------- */

export async function getMembers(lobbyId: string): Promise<MemberRow[]> {
  const { data, error } = await db()
    .from("mc_lobby_members")
    .select("*")
    .eq("lobby_id", lobbyId)
    .is("left_at", null)
    .order("seat", { ascending: true });
  if (error) throw translatePgError(error);
  return (data ?? []) as MemberRow[];
}

export async function getPlayersByIds(ids: string[]): Promise<Map<string, PlayerRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db().from("mc_players").select("*").in("id", ids);
  if (error) throw translatePgError(error);
  const map = new Map<string, PlayerRow>();
  for (const row of (data ?? []) as PlayerRow[]) map.set(row.id, row);
  return map;
}

/** Heartbeat: keeps "connected" fresh without blocking gameplay on disconnect. */
export async function touchPresence(playerId: string): Promise<void> {
  await db()
    .from("mc_players")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", playerId)
    .then(({ error }) => {
      if (error) throw translatePgError(error);
    });
}

const PRESENCE_WINDOW_MS = 45_000;

export function isOnline(row: PlayerRow | undefined): boolean {
  if (!row) return false;
  return Date.now() - new Date(row.last_seen_at).getTime() < PRESENCE_WINDOW_MS;
}

async function getGameId(lobbyId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("mc_games")
    .select("id")
    .eq("lobby_id", lobbyId)
    .maybeSingle();
  if (error) throw translatePgError(error);
  return (data as { id: string } | null)?.id ?? null;
}

async function getEvents(gameId: string, limit = 40): Promise<EventRow[]> {
  const { data, error } = await db()
    .from("mc_game_events")
    .select("id, round_number, phase, kind, message_key, params")
    .eq("game_id", gameId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw translatePgError(error);
  return (data ?? []) as EventRow[];
}

async function appendEvent(
  gameId: string,
  lobbyId: string,
  input: { round: number; phase: GamePhase; kind: string; key: string; params?: Record<string, string | number> },
): Promise<void> {
  const { error } = await db().from("mc_game_events").insert({
    game_id: gameId,
    lobby_id: lobbyId,
    round_number: input.round,
    phase: input.phase,
    kind: input.kind,
    message_key: input.key,
    params: input.params ?? {},
    is_public: true,
  });
  if (error) throw translatePgError(error);
}

async function getLatestInvestigation(
  gameId: string,
  detectiveId: string,
): Promise<InvestigationRow | null> {
  const { data, error } = await db()
    .from("mc_investigations")
    .select("detective_id, target_id, is_mafia, round_number")
    .eq("game_id", gameId)
    .eq("detective_id", detectiveId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw translatePgError(error);
  return (data as InvestigationRow | null) ?? null;
}

async function persistState(lobbyId: string, state: LobbyState): Promise<void> {
  const { error } = await db()
    .from("mc_lobbies")
    .update({ state: state as unknown as Record<string, unknown>, version: Date.now() })
    .eq("id", lobbyId);
  if (error) throw translatePgError(error);
}

function toEnginePlayers(
  members: MemberRow[],
  players: Map<string, PlayerRow>,
): GamePlayer[] {
  return members.map((member) => {
    const row = players.get(member.player_id);
    return {
      id: member.player_id,
      name: row?.display_name ?? "Player",
      username: row?.username ?? "",
      avatar: row?.photo_url ?? null,
      alive: member.is_alive,
      role: member.role ?? undefined,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

function summarise(lobby: LobbyRow, players: Map<string, PlayerRow>, count: number): LobbySummary {
  return {
    id: lobby.id,
    code: lobby.code,
    name: lobby.name,
    mode: lobby.mode,
    status: lobby.status,
    phase: lobby.phase,
    round: lobby.round_number,
    hostId: lobby.host_id,
    hostName: players.get(lobby.host_id)?.display_name ?? "—",
    playerCount: count,
    maxPlayers: lobby.max_players,
    minPlayers: MIN_PLAYERS,
    version: toNumber(lobby.version),
    createdAt: lobby.created_at,
  };
}

/**
 * Builds the per-player projection of a lobby. Secret roles are filtered out
 * here — a client can never receive another player's role unless the game is
 * over, and can never receive *any* role other than its own.
 */
export async function presentLobby(lobby: LobbyRow, viewerId: string): Promise<LobbyView> {
  const members = await getMembers(lobby.id);
  const isMember = members.some((member) => member.player_id === viewerId);

  // A private room is invisible to non-members; public rooms are watchable.
  if (lobby.mode === "PRIVATE" && !isMember) {
    throw new AppError("forbidden", "lobby_not_found", 404);
  }

  const players = await getPlayersByIds(members.map((m) => m.player_id));
  const gameId = await getGameId(lobby.id);

  const revealAll = lobby.phase === "finished" && lobby.status === "completed";
  const viewer = members.find((member) => member.player_id === viewerId);
  const viewerRole = viewer?.role ?? undefined;

  const seats: SeatView[] = members.map((member) => {
    const row = players.get(member.player_id);
    const seat: SeatView = {
      id: member.player_id,
      name: row?.display_name ?? "Player",
      username: row?.username ?? "",
      avatar: row?.photo_url ?? null,
      alive: member.is_alive,
      host: member.player_id === lobby.host_id,
      connected: isOnline(row),
    };
    if (revealAll && member.role) seat.role = member.role;
    return seat;
  });

  // Look the role up by seat id: filtering `seats` first would shift the
  // indices and could hand a player the wrong "ally".
  const roleBySeat = new Map(members.map((member) => [member.player_id, member.role]));
  const allies: PublicPlayer[] =
    viewerRole === "mafia"
      ? seats
          .filter((seat) => seat.id !== viewerId && seat.alive)
          .filter((seat) => roleBySeat.get(seat.id) === "mafia")
          .map((seat) => ({ id: seat.id, name: seat.name, username: seat.username, avatar: seat.avatar }))
      : [];

  const state: LobbyState = lobby.state ?? {
    nightActions: { mafiaVotes: {} },
    votes: {},
    investigations: {},
  };
  const engineState = {
    phase: lobby.phase,
    round: lobby.round_number,
    nightActions: state.nightActions ?? { mafiaVotes: {} },
    votes: state.votes ?? {},
    winner: lobby.winner ?? null,
  };
  const enginePlayers = toEnginePlayers(members, players);
  const viewerPlayer = enginePlayers.find((player) => player.id === viewerId);

  let actionDone = false;
  if (viewerPlayer) {
    if (lobby.phase === "night") actionDone = nightActionSubmitted(engineState, viewerPlayer);
    else if (lobby.phase === "day") actionDone = Boolean(state.votes?.[viewerId]);
  }

  let investigation = null;
  if (viewerRole === "detective" && gameId) {
    const row = await getLatestInvestigation(gameId, viewerId);
    if (row) {
      const target = players.get(row.target_id);
      investigation = {
        playerId: row.target_id,
        playerName: target?.display_name ?? "—",
        isMafia: row.is_mafia,
        round: row.round_number,
      };
    }
  }

  const events: GameEventView[] = gameId
    ? (await getEvents(gameId)).map((row) => ({
        id: toNumber(row.id),
        round: row.round_number,
        phase: row.phase,
        kind: row.kind,
        key: row.message_key,
        params: row.params ?? {},
      }))
    : [];

  const enoughPlayers = seats.length >= MIN_PLAYERS;

  return {
    ...summarise(lobby, players, seats.length),
    players: seats,
    me: {
      id: viewerId,
      isHost: lobby.host_id === viewerId,
      role: viewerRole,
      alive: viewer?.is_alive ?? false,
      canStart:
        lobby.host_id === viewerId &&
        lobby.status === "waiting" &&
        lobby.phase === "waiting" &&
        enoughPlayers,
      actionDone,
    },
    allies,
    investigation,
    events,
    winner: lobby.winner ?? null,
  };
}

/** Lightweight list projection — no roles, no events. */
export async function presentLobbySummaries(lobbies: LobbyRow[]): Promise<LobbySummary[]> {
  if (lobbies.length === 0) return [];
  const ids = lobbies.map((lobby) => lobby.id);
  const { data, error } = await db()
    .from("mc_lobby_members")
    .select("lobby_id, player_id")
    .in("lobby_id", ids)
    .is("left_at", null);
  if (error) throw translatePgError(error);
  const rows = data as { lobby_id: string; player_id: string }[];

  const hostIds = lobbies.map((lobby) => lobby.host_id);
  const { data: hostRows, error: hostError } = await db()
    .from("mc_players")
    .select("*")
    .in("id", [...new Set(hostIds)]);
  if (hostError) throw translatePgError(hostError);
  const hostPlayers = new Map(
    ((hostRows ?? []) as PlayerRow[]).map((row) => [row.id, row]),
  );

  return lobbies.map((lobby) => {
    const count = rows.filter((row) => row.lobby_id === lobby.id).length;
    return summarise(lobby, hostPlayers, count);
  });
}

/* -------------------------------------------------------------------------- */
/* Gameplay                                                                   */
/* -------------------------------------------------------------------------- */

async function loadMatchContext(lobbyRef: string, playerId: string) {
  const lobby = await resolveLobby(lobbyRef);
  const members = await getMembers(lobby.id);
  const me = members.find((member) => member.player_id === playerId);
  if (!me) throw new AppError("not_member", "not_member", 403);
  const players = await getPlayersByIds(members.map((m) => m.player_id));
  const gameId = await getGameId(lobby.id);
  if (!gameId) throw new AppError("not_found", "game_not_found", 404);
  return { lobby, members, players, gameId, me };
}

const EMPTY_STATE: LobbyState = {
  nightActions: { mafiaVotes: {} },
  votes: {},
  investigations: {},
};

/**
 * Applies a night action or a vote, then resolves the phase when every living
 * player has acted. All validation happens here on the server; the client is
 * never trusted.
 */
export async function submitGameAction(
  lobbyRef: string,
  playerId: string,
  input: { action: "night" | "vote"; targetId: string },
): Promise<LobbyView> {
  const { lobby, members, players, gameId } = await loadMatchContext(lobbyRef, playerId);

  if (lobby.status !== "playing") {
    throw new AppError("in_progress", "lobby_in_progress", 409);
  }

  const state: LobbyState = { ...(lobby.state ?? EMPTY_STATE) };
  state.nightActions = { ...(state.nightActions ?? { mafiaVotes: {} }) };
  state.votes = { ...(state.votes ?? {}) };

  const enginePlayers = toEnginePlayers(members, players);
  const actor = enginePlayers.find((player) => player.id === playerId);
  const target = enginePlayers.find((player) => player.id === input.targetId);
  if (!actor) throw new AppError("not_member", "not_member", 403);
  if (!target) throw new AppError("not_found", "target_not_found", 404);

  if (input.action === "night") {
    const failure = validateNightTarget(actor, target, lobby.phase);
    if (failure) throw actionError(failure);

    if (actor.role === "mafia") {
      if (state.nightActions.mafiaVotes[actor.id]) throw new AppError("duplicate", "duplicate", 409);
      state.nightActions.mafiaVotes = { ...state.nightActions.mafiaVotes, [actor.id]: target.id };
    } else if (actor.role === "doctor") {
      if (state.nightActions.doctorTarget) throw new AppError("duplicate", "duplicate", 409);
      state.nightActions.doctorTarget = target.id;
    } else if (actor.role === "detective") {
      if (state.nightActions.detectiveTarget) throw new AppError("duplicate", "duplicate", 409);
      state.nightActions.detectiveTarget = target.id;
    } else {
      throw new AppError("no_night_action", "no_night_action", 403);
    }

    const engineState = {
      phase: lobby.phase,
      round: lobby.round_number,
      nightActions: state.nightActions,
      votes: state.votes,
      winner: lobby.winner,
    };
    if (!allNightActionsSubmitted(engineState, enginePlayers)) {
      await persistState(lobby.id, state);
      return presentLobby(await resolveLobby(lobbyRef), playerId);
    }

    const outcome = resolveNight(enginePlayers, state.nightActions);

    if (outcome.investigatedTargetId && outcome.detectiveId) {
      const subject = enginePlayers.find((p) => p.id === outcome.investigatedTargetId);
      await db()
        .from("mc_investigations")
        .insert({
          game_id: gameId,
          detective_id: outcome.detectiveId,
          target_id: outcome.investigatedTargetId,
          is_mafia: subject?.role === "mafia",
          round_number: lobby.round_number,
        })
        .then(({ error }) => {
          if (error && error.code !== "23505") throw translatePgError(error);
        });
    }

    await syncAliveFlags(members, enginePlayers);

    const winner = evaluateWinState(enginePlayers);
    if (outcome.killedId) {
      const victim = enginePlayers.find((p) => p.id === outcome.killedId);
      await appendEvent(gameId, lobby.id, {
        round: lobby.round_number,
        phase: "night",
        kind: "elimination",
        key: "event.mafiaKill",
        params: { player: victim?.name ?? "?" },
      });
    } else if (outcome.savedId) {
      await appendEvent(gameId, lobby.id, {
        round: lobby.round_number,
        phase: "night",
        kind: "saved",
        key: "event.doctorSaved",
      });
    } else if (outcome.disagreement) {
      await appendEvent(gameId, lobby.id, {
        round: lobby.round_number,
        phase: "night",
        kind: "standoff",
        key: "event.mafiaDisagreement",
      });
    } else {
      await appendEvent(gameId, lobby.id, {
        round: lobby.round_number,
        phase: "night",
        kind: "quiet",
        key: "event.nightNoKill",
      });
    }

    if (winner.winner) {
      await finishGame(gameId, lobby.id, winner.winner, lobby.round_number);
    } else {
      await appendEvent(gameId, lobby.id, {
        round: lobby.round_number,
        phase: "day",
        kind: "phase",
        key: "event.dayBreaks",
      });
      await resetPhase(lobby.id, "day", lobby.round_number);
    }
    return presentLobby(await resolveLobby(lobbyRef), playerId);
  }

  // ---- vote ---------------------------------------------------------------
  const failure = validateVote(actor, target, lobby.phase, state.votes);
  if (failure) throw actionError(failure);

  state.votes = { ...state.votes, [actor.id]: target.id };

  const engineState = {
    phase: lobby.phase,
    round: lobby.round_number,
    nightActions: state.nightActions,
    votes: state.votes,
    winner: lobby.winner,
  };

  if (!allVotesSubmitted(engineState, enginePlayers)) {
    await persistState(lobby.id, state);
    return presentLobby(await resolveLobby(lobbyRef), playerId);
  }

  const outcome = resolveVotes(enginePlayers, state.votes);

  if (outcome.eliminatedId) {
    const victim = enginePlayers.find((p) => p.id === outcome.eliminatedId);
    if (victim) victim.alive = false;
    await syncAliveFlags(members, enginePlayers);
    await appendEvent(gameId, lobby.id, {
      round: lobby.round_number,
      phase: "day",
      kind: "elimination",
      key: "event.eliminatedByVote",
      params: { player: victim?.name ?? "?" },
    });
  } else {
    await appendEvent(gameId, lobby.id, {
      round: lobby.round_number,
      phase: "day",
      kind: "standoff",
      key: "event.voteTie",
    });
  }

  const winner = evaluateWinState(enginePlayers);
  if (winner.winner) {
    await finishGame(gameId, lobby.id, winner.winner, lobby.round_number);
  } else {
    await appendEvent(gameId, lobby.id, {
      round: lobby.round_number + 1,
      phase: "night",
      kind: "phase",
      key: "event.nightFalls",
    });
    await resetPhase(lobby.id, "night", lobby.round_number + 1);
  }
  return presentLobby(await resolveLobby(lobbyRef), playerId);
}

function actionError(code: string): AppError {
  switch (code as never) {
    case "not-alive":
      return new AppError("dead", "not_alive", 409);
    case "dead-target":
      return new AppError("dead", "target_dead", 409);
    case "wrong-phase":
      return new AppError("wrong_phase", "wrong_phase", 409);
    case "duplicate":
      return new AppError("duplicate", "duplicate", 409);
    case "self-target":
      return new AppError("self_target", "self_target", 409);
    case "ally-target":
      return new AppError("ally_target", "ally_target", 409);
    case "no-night-action":
      return new AppError("no_night_action", "no_night_action", 403);
    default:
      return new AppError("invalid", "invalid_action", 400);
  }
}

/* -------------------------------------------------------------------------- */
/* Phase watchdog                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Matches are not allowed to stall. If a phase outlives its window and the
 * required actions are still missing, the phase is force-resolved with
 * whatever has been submitted. This is what makes an abandoned table recover
 * instead of deadlocking forever.
 */
export async function enforcePhaseDeadline(lobby: LobbyRow, now = Date.now()): Promise<void> {
  if (lobby.status !== "playing") return;
  const state: LobbyState = lobby.state ?? EMPTY_STATE;
  const startedAt = state.phaseStartedAt ? Date.parse(state.phaseStartedAt) : 0;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return;

  const budget = lobby.phase === "night" ? RULES.nightSeconds : RULES.daySeconds;
  if (now - startedAt < budget * 1000) return;

  const members = await getMembers(lobby.id);
  if (members.length === 0) {
    await db()
      .from("mc_lobbies")
      .update({ status: "cancelled", phase: "finished", version: now, state: {}, finished_at: new Date().toISOString() })
      .eq("id", lobby.id)
      .then(({ error }) => {
        if (error) throw translatePgError(error);
      });
    return;
  }

  const gameId = await getGameId(lobby.id);
  if (!gameId) return;

  const players = await getPlayersByIds(members.map((member) => member.player_id));
  const enginePlayers = toEnginePlayers(members, players);
  const round = lobby.round_number;

  if (lobby.phase === "night") {
    const outcome = resolveNight(enginePlayers, state.nightActions ?? { mafiaVotes: {} });
    if (outcome.killedId) {
      const victim = enginePlayers.find((entry) => entry.id === outcome.killedId);
      await syncAliveFlags(members, enginePlayers);
      await appendEvent(gameId, lobby.id, {
        round,
        phase: "night",
        kind: "elimination",
        key: "event.mafiaKill",
        params: { player: victim?.name ?? "?" },
      });
    }
    const winner = evaluateWinState(enginePlayers);
    if (winner.winner) {
      await finishGame(gameId, lobby.id, winner.winner, round);
    } else {
      await appendEvent(gameId, lobby.id, { round, phase: "day", kind: "phase", key: "event.dayBreaks" });
      await resetPhase(lobby.id, "day", round);
    }
    return;
  }

  // day
  const outcome = resolveVotes(enginePlayers, state.votes ?? {});
  if (outcome.eliminatedId) {
    const victim = enginePlayers.find((entry) => entry.id === outcome.eliminatedId);
    await syncAliveFlags(members, enginePlayers);
    await appendEvent(gameId, lobby.id, {
      round,
      phase: "day",
      kind: "elimination",
      key: "event.eliminatedByVote",
      params: { player: victim?.name ?? "?" },
    });
  }
  const winner = evaluateWinState(enginePlayers);
  if (winner.winner) {
    await finishGame(gameId, lobby.id, winner.winner, round);
  } else {
    await appendEvent(gameId, lobby.id, {
      round: round + 1,
      phase: "night",
      kind: "phase",
      key: "event.nightFalls",
    });
    await resetPhase(lobby.id, "night", round + 1);
  }
}

async function syncAliveFlags(members: MemberRow[], enginePlayers: GamePlayer[]): Promise<void> {
  for (const player of enginePlayers) {
    const member = members.find((entry) => entry.player_id === player.id);
    if (member && member.is_alive !== player.alive) {
      await db()
        .from("mc_lobby_members")
        .update({ is_alive: player.alive })
        .eq("id", member.id)
        .then(({ error }) => {
          if (error) throw translatePgError(error);
        });
    }
  }
}

async function resetPhase(lobbyId: string, phase: "night" | "day", round: number): Promise<void> {
  await db()
    .from("mc_lobbies")
    .update({
      phase,
      round_number: round,
      version: Date.now(),
      state: {
        nightActions: { mafiaVotes: {} },
        votes: {},
        phaseStartedAt: new Date().toISOString(),
      } as unknown as Record<string, unknown>,
    })
    .eq("id", lobbyId)
    .then(({ error }) => {
      if (error) throw translatePgError(error);
    });
}

async function finishGame(
  gameId: string,
  lobbyId: string,
  winner: GameWinner,
  rounds: number,
): Promise<void> {
  await appendEvent(gameId, lobbyId, {
    round: rounds,
    phase: "finished",
    kind: "result",
    key: winner === "mafia" ? "event.mafiaWin" : "event.townWin",
  });
  const { error } = await db().rpc("finish_game", {
    p_game_id: gameId,
    p_winner: winner,
    p_rounds: rounds,
  });
  if (error) throw translatePgError(error);
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

function ratio(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function getStats(playerId: string): Promise<PlayerStats> {
  const player = await getPlayerById(playerId);
  if (!player) throw new AppError("not_found", "player_not_found", 404);

  const [{ count: survivedCount }, { data: rankRow }] = await Promise.all([
    db()
      .from("mc_game_players")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("survived", true),
    db().rpc("leaderboard_rank", { p_player_id: playerId }),
  ]);

  const gamesPlayed = player.games_played;
  const rankValue = typeof rankRow === "number" ? rankRow : toNumber(rankRow, 0);

  return {
    playerId,
    rating: toNumber(player.rating, 1000),
    peakRating: toNumber(player.peak_rating, 1000),
    gamesPlayed,
    gamesWon: player.games_won,
    gamesLost: player.games_lost,
    winRate: ratio(player.games_won, gamesPlayed),
    mafiaGames: player.mafia_games,
    mafiaWins: player.mafia_wins,
    mafiaWinRate: ratio(player.mafia_wins, player.mafia_games),
    townGames: player.town_games,
    townWins: player.town_wins,
    townWinRate: ratio(player.town_wins, player.town_games),
    survived: survivedCount ?? 0,
    survivalRate: ratio(survivedCount ?? 0, gamesPlayed),
    rank: rankValue > 0 ? rankValue : null,
  };
}

export async function getMatchHistory(playerId: string, limit = 15): Promise<MatchHistoryEntry[]> {
  const { data, error } = await db()
    .from("mc_game_players")
    .select(
      "game_id, role, won, survived, rating_delta, rating_after, created_at, mc_games!inner(id, winner, rounds_played, player_count, finished_at, status)",
    )
    .eq("player_id", playerId)
    .eq("mc_games.status", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw translatePgError(error);

  const rows = (data ?? []) as unknown as Array<{
    game_id: string;
    role: GameRole;
    won: boolean;
    survived: boolean;
    rating_delta: number | string;
    rating_after: number | string | null;
    created_at: string;
    mc_games: GameRow | GameRow[];
  }>;

  return rows.map((row) => {
    const game = (Array.isArray(row.mc_games) ? row.mc_games[0] : row.mc_games) as GameRow;
    return {
      gameId: row.game_id,
      playedAt: game.finished_at ?? row.created_at,
      role: row.role,
      won: row.won,
      survived: row.survived,
      ratingDelta: toNumber(row.rating_delta),
      ratingAfter: row.rating_after === null ? null : toNumber(row.rating_after),
      winner: game.winner ?? null,
      rounds: game.rounds_played,
      playerCount: game.player_count,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Leaderboard                                                                */
/* -------------------------------------------------------------------------- */

export async function getLeaderboard(options: {
  page: number;
  pageSize: number;
  viewerId?: string;
}): Promise<LeaderboardView> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const page = Math.max(1, options.page);
  const offset = (page - 1) * pageSize;

  const { data, error } = await db().rpc("leaderboard", {
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) throw translatePgError(error);

  const rows = (data ?? []) as Array<{
    rank: number | string;
    id: string;
    username: string | null;
    display_name: string;
    photo_url: string | null;
    rating: number | string;
    games_played: number;
    games_won: number;
    mafia_wins: number;
    town_wins: number;
  }>;

  const players: LeaderboardRow[] = rows.map((row) => ({
    rank: toNumber(row.rank),
    id: row.id,
    username: row.username ?? "",
    displayName: row.display_name,
    photoUrl: row.photo_url,
    rating: toNumber(row.rating, 1000),
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    mafiaWins: row.mafia_wins,
    townWins: row.town_wins,
    winRate: ratio(row.games_won, row.games_played),
    isMe: options.viewerId === row.id,
  }));

  const total = players.length > 0 ? toNumber(players[players.length - 1].rank) : 0;

  let me: LeaderboardRow | null = players.find((row) => row.isMe) ?? null;
  if (!me && options.viewerId) {
    const stats = await getStats(options.viewerId);
    if (stats.rank) {
      me = {
        rank: stats.rank,
        id: options.viewerId,
        username: "",
        displayName: "",
        photoUrl: null,
        rating: stats.rating,
        gamesPlayed: stats.gamesPlayed,
        gamesWon: stats.gamesWon,
        mafiaWins: stats.mafiaWins,
        townWins: stats.townWins,
        winRate: stats.winRate,
        isMe: true,
      };
    }
  }

  return { players, total, page, pageSize, me };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

export type DatabaseHealth = {
  configured: boolean;
  reachable: boolean;
  tablesReady: boolean;
  privileged: boolean;
  latencyMs: number | null;
  detail?: string;
};

export async function checkDatabase(): Promise<DatabaseHealth> {
  const config = getDbConfig();
  if (!config) {
    return {
      configured: false,
      reachable: false,
      tablesReady: false,
      privileged: false,
      latencyMs: null,
      detail: "SUPABASE_URL / SUPABASE_KEY are not set",
    };
  }
  const started = Date.now();
  try {
    const { error } = await db().from("mc_players").select("id").limit(1);
    const latencyMs = Date.now() - started;
    if (error) {
      return {
        configured: true,
        reachable: error.code === "PGRST205" ? true : false,
        tablesReady: false,
        privileged: config.privileged,
        latencyMs,
        detail: config.privileged
          ? error.message
          : `${error.message} — set SUPABASE_SERVICE_ROLE_KEY (rows are protected by RLS, the publishable key cannot read them)`,
      };
    }
    return {
      configured: true,
      reachable: true,
      tablesReady: true,
      privileged: config.privileged,
      latencyMs,
      ...(config.privileged
        ? {}
        : {
            detail:
              "Connected with the publishable key. RLS blocks reads for that role — configure SUPABASE_SERVICE_ROLE_KEY before going live.",
          }),
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      tablesReady: false,
      privileged: config.privileged,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : "unknown",
    };
  }
}

export { RULES, MIN_PLAYERS, MAX_PLAYERS, isDatabaseConfigured };
