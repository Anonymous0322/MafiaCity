"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LobbyView } from "@/lib/types";

type State = {
  lobby: LobbyView | null;
  loading: boolean;
  error: string | null;
  online: boolean;
  lastSync: number;
};

const POLL_INTERVAL_MS = 2500;
const OFFLINE_AFTER_MS = 8000;

const IDLE: State = {
  lobby: null,
  loading: false,
  error: null,
  online: true,
  lastSync: 0,
};

/**
 * Keeps a lobby projection in sync.
 *
 * 1. Supabase Realtime broadcast wakes every client the moment the server
 *    mutates the lobby (join/leave/start/action).
 * 2. A short poll runs as a safety net so a missed broadcast can never leave a
 *    player on stale information — and reconnection after a dropped socket is
 *    automatic.
 */
export function useLobby(lobbyId: string | null) {
  const [state, setState] = useState<State>(() =>
    lobbyId ? { ...IDLE, loading: true } : IDLE,
  );
  const versionRef = useRef<number | null>(null);
  const inflight = useRef(false);
  const [trackedId, setTrackedId] = useState(lobbyId);

  // Adjust state during render when the tracked lobby changes (React's
  // documented pattern) instead of syncing with an extra effect pass.
  if (trackedId !== lobbyId) {
    setTrackedId(lobbyId);
    setState(lobbyId ? { ...IDLE, loading: true } : IDLE);
  }

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!lobbyId || inflight.current) return;
      inflight.current = true;
      const since = versionRef.current;
      const query = since === null ? "" : `&since=${since}`;
      try {
        const response = await fetch(`/api/lobbies?id=${encodeURIComponent(lobbyId)}${query}`, {
          cache: "no-store",
        });
        if (response.status === 304) {
          setState((prev) => ({ ...prev, online: true, error: null, lastSync: Date.now() }));
          return;
        }
        const payload = (await response.json()) as { lobby?: LobbyView; error?: string };
        if (!response.ok || !payload.lobby) {
          setState((prev) => ({ ...prev, error: payload.error ?? "load_failed", online: false }));
          return;
        }
        versionRef.current = payload.lobby.version;
        setState({
          lobby: payload.lobby,
          loading: false,
          error: null,
          online: true,
          lastSync: Date.now(),
        });
      } catch {
        setState((prev) => ({ ...prev, error: "network", online: false }));
      } finally {
        inflight.current = false;
        void options;
      }
    },
    [lobbyId],
  );

  useEffect(() => {
    if (!lobbyId) return;
    versionRef.current = null;
    // Deferred by a tick so the first paint is never blocked by the fetch.
    const kickoff = window.setTimeout(() => void load(), 0);

    const poll = window.setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    const watchdog = window.setInterval(() => {
      setState((prev) => ({
        ...prev,
        online: Date.now() - prev.lastSync < OFFLINE_AFTER_MS || prev.lastSync === 0,
      }));
    }, 2000);

    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(poll);
      window.clearInterval(watchdog);
    };
  }, [lobbyId, load]);

  // --- realtime push -------------------------------------------------------
  useEffect(() => {
    if (!lobbyId) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    let channel: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        if (cancelled) return;
        const created = client
          .channel(`lobby:${lobbyId}`)
          .on("broadcast", { event: "lobby" }, () => {
            void load({ silent: true });
          })
          .subscribe();
        channel = created;
      } catch {
        /* polling still covers us */
      }
    })();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, [lobbyId, load]);

  return { ...state, refresh: () => load() };
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** POST helper with uniform error decoding. */
export async function postLobbyAction<T = { lobby?: LobbyView }>(
  body: Record<string, unknown>,
): Promise<ActionResult<T>> {
  try {
    const response = await fetch("/api/lobbies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as T & { error?: string; code?: string };
    if (!response.ok) {
      return { ok: false, error: payload.error ?? "request_failed", code: payload.code };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, error: "network" };
  }
}
