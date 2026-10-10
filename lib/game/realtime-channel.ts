/**
 * The single Realtime channel shared by the server and every client.
 *
 * Both sides MUST import this constant. An earlier version had the server
 * publishing on "mafia-notify" while the client subscribed to
 * "lobby:<id>", so no message ever arrived and the polling fallback hid the
 * failure completely.
 *
 * The lobby id travels in the payload and each client filters on it, which
 * keeps one socket per browser tab instead of one per lobby.
 */
export const REALTIME_CHANNEL = "mafia-notify";
export const REALTIME_EVENT = "lobby";

export type LobbyPing = {
  lobbyId: string;
  version: number;
  reason: string;
  at: string;
};

export function isPingForLobby(payload: unknown, lobbyId: string): payload is LobbyPing {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as LobbyPing).lobbyId === lobbyId
  );
}
