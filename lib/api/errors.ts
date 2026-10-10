/** Maps backend error codes to human-readable, already-localised keys. */
export const ERROR_MESSAGE_KEYS: Record<string, string> = {
  lobby_not_found: "lobby_not_found",
  not_found: "lobby_not_found",
  player_not_found: "lobby_not_found",
  target_not_found: "lobby_not_found",
  lobby_full: "lobby_full",
  full: "lobby_full",
  lobby_in_progress: "lobby_started",
  in_progress: "lobby_started",
  already_started: "lobby_started",
  game_already_started: "lobby_started",
  wrong_phase: "lobby_started",
  player_in_other_lobby: "already_in_lobby",
  conflict: "already_in_lobby",
  not_host: "not_host",
  forbidden: "not_host",
  not_enough_players: "not_enough_players",
  not_member: "not_member",
  unauthorized: "unauthorized",
  duplicate: "duplicate",
  self_target: "self_target",
  not_alive: "you_died_short",
  target_dead: "already_dead",
  dead: "already_dead",
  ally_target: "ally_target",
  no_night_action: "no_night_action",
  network: "network",
  load_failed: "load_failed",
  request_failed: "generic",
  invalid: "generic",
  invalid_body: "generic",
  invalid_action: "generic",
  database_unavailable: "generic",
  unknown: "generic",
  generic: "generic",
  not_configured: "generic",
};

/**
 * Resolves an error code into a translation key. Accepts either the raw code or
 * the `{ error, code }` pair returned by the API helpers.
 */
export function translateError(code?: string, errorCode?: string): string {
  const key = errorCode ?? code ?? "";
  return ERROR_MESSAGE_KEYS[key] ?? "generic";
}
