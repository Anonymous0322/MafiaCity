/**
 * Client-safe ruleset constants.
 *
 * This module is imported by UI code, so it must stay free of Node built-ins.
 * The authoritative engine (`lib/game/rules.ts`) re-exports these values.
 */

export const RULES = {
  /** Minimum seats required before the host can start a match. */
  minPlayers: 5,
  maxPlayers: 20,
  nightSeconds: 45,
  daySeconds: 60,
  /** Preserved from the original ruleset. */
  mafiaFor(count: number): number {
    if (count >= 10) return 3;
    if (count >= 7) return 2;
    return 1;
  },
  doctorCount: 1,
  detectiveCount: 1,
} as const;

export const MIN_PLAYERS = RULES.minPlayers;
export const MAX_PLAYERS = RULES.maxPlayers;
