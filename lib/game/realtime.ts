import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { getDbConfig } from "@/lib/db/client";

/**
 * Realtime fan-out for lobby updates.
 *
 * The server publishes a tiny "lobby changed" ping on a public Supabase Realtime
 * channel; clients subscribe with the *publishable* key and refetch. The database
 * remains the single source of truth, so a dropped message only costs latency —
 * clients always poll as a safety net. This keeps the design correct on
 * serverless hosts where in-process WebSockets are impossible.
 *
 * A single channel is kept open per process and reused; opening a WebSocket per
 * mutation would be far too expensive.
 */

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let ready: Promise<boolean> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const IDLE_TIMEOUT_MS = 30_000;

function getClient(): SupabaseClient | null {
  const config = getDbConfig();
  if (!config) return null;
  if (!client) {
    client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "x-application-name": "mafia-city-realtime" } },
    });
  }
  return client;
}

function dropChannel() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const current = channel;
  channel = null;
  ready = null;
  if (current && client) void client.removeChannel(current);
}

function ensureChannel(): Promise<boolean> {
  if (ready) return ready;

  const supabase = getClient();
  if (!supabase) return Promise.resolve(false);

  const created = supabase.channel("mafia-notify");
  channel = created;

  ready = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      dropChannel();
      finish(false);
    }, 4000);

    created.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        finish(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        dropChannel();
        finish(false);
      }
    });
  });

  return ready;
}

export type LobbyPing = {
  lobbyId: string;
  version: number;
  reason: string;
  at: string;
};

/** Fire-and-forget: a realtime hiccup must never break a gameplay request. */
export async function publishLobbyChange(
  lobbyId: string,
  version: number,
  reason: string,
): Promise<void> {
  try {
    const connected = await ensureChannel();
    if (!connected || !channel) return;

    const ping: LobbyPing = {
      lobbyId,
      version,
      reason,
      at: new Date().toISOString(),
    };
    await channel.send({ type: "broadcast", event: "lobby", payload: ping });

    // release the socket when the room goes quiet
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(dropChannel, IDLE_TIMEOUT_MS);
  } catch {
    dropChannel();
  }
}

