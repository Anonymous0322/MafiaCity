import { randomInt } from "node:crypto";
import type { GamePhase, GamePlayer, GameRole, GameWinner } from "@/lib/types";
import { RULES } from "@/lib/game/constants";

/**
 * Server-side game engine.
 *
 * Everything here is a pure function over the authoritative state, which makes
 * the rules unit-testable and keeps the database layer in charge of persistence.
 */

export { RULES };
export const MIN_PLAYERS = RULES.minPlayers;
export const MAX_PLAYERS = RULES.maxPlayers;

export type NightActions = {
  mafiaVotes: Record<string, string>;
  doctorTarget?: string;
  detectiveTarget?: string;
};

export type EngineState = {
  phase: GamePhase;
  round: number;
  nightActions: NightActions;
  votes: Record<string, string>;
  winner: GameWinner | null;
};

export type RolePlan = { role: GameRole; count: number }[];

/** Deterministic role distribution for a table of `count` players. */
export function rolePlan(count: number): RolePlan {
  const mafia = RULES.mafiaFor(count);
  const support = RULES.doctorCount + RULES.detectiveCount;
  let citizens = count - mafia - support;
  let mafiaTotal = mafia;
  if (citizens < 1) {
    citizens = 1;
    mafiaTotal = Math.max(1, count - support - citizens);
  }
  return [
    { role: "mafia", count: mafiaTotal },
    { role: "doctor", count: RULES.doctorCount },
    { role: "detective", count: RULES.detectiveCount },
    { role: "citizen", count: citizens },
  ];
}
export function rolesFor(count: number): GameRole[] {
  const plan = rolePlan(count);
  const roles: GameRole[] = [];
  for (const entry of plan) {
    for (let i = 0; i < entry.count; i += 1) roles.push(entry.role);
  }
  return roles;
}

/** Cryptographically-seeded Fisher–Yates. */
export function shuffle<T>(items: T[], pick: (max: number) => number = randomInt): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function assignRoles(count: number, pick?: (max: number) => number): GameRole[] {
  return shuffle(rolesFor(count), pick);
}

/**
 * Mafia wins when they equal the rest of the table; town wins when no mafia
 * remain. Also returns "stale" when neither side can act any more.
 */
export function evaluateWinState(players: Array<Pick<GamePlayer, "alive" | "role">>): {
  winner: GameWinner | null;
  reason: "mafia-eliminated" | "mafia-controls-city" | "continue";
} {
  const alive = players.filter((player) => player.alive);
  const mafia = alive.filter((player) => player.role === "mafia").length;
  const town = alive.length - mafia;
  if (mafia === 0) return { winner: "town", reason: "mafia-eliminated" };
  if (mafia >= town) return { winner: "mafia", reason: "mafia-controls-city" };
  return { winner: null, reason: "continue" };
}

/** Roles that must act during the night phase. */
export function nightActors(players: GamePlayer[]): GamePlayer[] {
  return players.filter(
    (player) => player.alive && (player.role === "mafia" || player.role === "doctor" || player.role === "detective"),
  );
}

export function nightActionSubmitted(state: EngineState, player: GamePlayer): boolean {
  if (player.role === "mafia") return Boolean(state.nightActions.mafiaVotes[player.id]);
  if (player.role === "doctor") return Boolean(state.nightActions.doctorTarget);
  if (player.role === "detective") return Boolean(state.nightActions.detectiveTarget);
  return true;
}

export function allNightActionsSubmitted(state: EngineState, players: GamePlayer[]): boolean {
  return nightActors(players).every((player) => nightActionSubmitted(state, player));
}

export function allVotesSubmitted(state: EngineState, players: GamePlayer[]): boolean {
  const voters = players.filter((player) => player.alive);
  return voters.every((player) => Boolean(state.votes[player.id]));
}

export type NightOutcome = {
  killedId: string | null;
  savedId: string | null;
  disagreement: boolean;
  investigatedTargetId: string | null;
  detectiveId: string | null;
};

/**
 * Resolves the night. Pure: it mutates the supplied players array and returns
 * the factual outcome so the caller can persist it and localise the log.
 */
export function resolveNight(
  players: GamePlayer[],
  actions: NightActions,
): NightOutcome {
  const totals = new Map<string, number>();
  for (const target of Object.values(actions.mafiaVotes)) {
    totals.set(target, (totals.get(target) ?? 0) + 1);
  }
  let mafiaTarget: string | null = null;
  let disagreement = false;
  if (totals.size > 0) {
    const top = Math.max(...totals.values());
    const leaders = [...totals.entries()].filter(([, count]) => count === top);
    if (leaders.length === 1) mafiaTarget = leaders[0][0];
    else disagreement = true;
  }

  const killedId = mafiaTarget && mafiaTarget !== actions.doctorTarget ? mafiaTarget : null;
  const savedId = mafiaTarget && mafiaTarget === actions.doctorTarget ? mafiaTarget : null;

  if (killedId) {
    const victim = players.find((player) => player.id === killedId);
    if (victim?.alive) victim.alive = false;
  }

  const detective = players.find((player) => player.role === "detective" && player.alive);
  const detectiveTarget = actions.detectiveTarget
    ? players.find((player) => player.id === actions.detectiveTarget && player.alive)
    : undefined;

  return {
    killedId,
    savedId,
    disagreement,
    investigatedTargetId: detective && detectiveTarget ? detectiveTarget.id : null,
    detectiveId: detective?.id ?? null,
  };
}

export type VoteOutcome = { eliminatedId: string | null; tie: boolean };

export function resolveVotes(players: GamePlayer[], votes: Record<string, string>): VoteOutcome {
  const totals = new Map<string, number>();
  for (const [voterId, targetId] of Object.entries(votes)) {
    const voter = players.find((player) => player.id === voterId);
    if (!voter?.alive) continue;
    const target = players.find((player) => player.id === targetId);
    if (!target?.alive) continue;
    totals.set(targetId, (totals.get(targetId) ?? 0) + 1);
  }
  if (totals.size === 0) return { eliminatedId: null, tie: false };
  const top = Math.max(...totals.values());
  const leaders = [...totals.entries()].filter(([, count]) => count === top);
  if (leaders.length !== 1) return { eliminatedId: null, tie: true };
  const eliminatedId = leaders[0][0];
  const player = players.find((entry) => entry.id === eliminatedId);
  if (player) player.alive = false;
  return { eliminatedId, tie: false };
}

export type ActionError =
  | "not-alive"
  | "self-target"
  | "wrong-phase"
  | "duplicate"
  | "no-night-action"
  | "ally-target"
  | "dead-target"
  | "not-a-member";

export function validateNightTarget(
  actor: GamePlayer,
  target: GamePlayer,
  phase: GamePhase,
): ActionError | null {
  if (!actor.alive) return "not-alive";
  if (!target.alive) return "dead-target";
  if (phase !== "night") return "wrong-phase";
  if (actor.id === target.id && actor.role !== "doctor") return "self-target";
  if (actor.role === "mafia" && target.role === "mafia") return "ally-target";
  return null;
}

export function validateVote(
  actor: GamePlayer,
  target: GamePlayer,
  phase: GamePhase,
  votes: Record<string, string>,
): ActionError | null {
  if (!actor.alive) return "not-alive";
  if (!target.alive) return "dead-target";
  if (phase !== "day") return "wrong-phase";
  if (actor.id === target.id) return "self-target";
  if (votes[actor.id]) return "duplicate";
  return null;
}
