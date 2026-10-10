"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Crown, LogOut, Moon, Sparkles, UsersRound } from "lucide-react";
import { useApp } from "@/app/providers";
import {
  Avatar,
  ConnectionBadge,
  CopyCodeButton,
  EmptyState,
  ErrorState,
  Loader,
  NoticeBar,
  PageShell,
  ShareButton,
  SlotCard,
  TopBar,
} from "@/components/ui";
import { postLobbyAction, useLobby } from "@/components/use-lobby";
import { interpolate } from "@/lib/i18n";
import type { LobbyView } from "@/lib/types";

export default function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { t, profile, buzz, setNotice, failWith, errorText, setLobby } = useApp();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { lobby, loading, error, online, refresh } = useLobby(code);

  useEffect(() => {
    setLobby(lobby);
    return () => setLobby(null);
  }, [lobby, setLobby]);

  // game started for everyone -> everyone moves to the match view
  useEffect(() => {
    if (lobby && lobby.phase !== "waiting" && lobby.status === "playing") {
      router.replace(`/game/${lobby.code}`);
    }
  }, [lobby, router]);

  const start = useCallback(async () => {
    if (!lobby) return;
    setBusy(true);
    const result = await postLobbyAction({ action: "start", lobbyId: lobby.id });
    setBusy(false);
    if (!result.ok) {
      buzz("error");
      failWith(result.error, result.code);
      return;
    }
    buzz("success");
    setNotice(t.starting);
    await refresh();
    router.replace(`/game/${lobby.code}`);
  }, [lobby, buzz, setNotice, failWith, refresh, router, t.starting]);

  const leave = useCallback(async () => {
    if (!lobby) return;
    setBusy(true);
    const result = await postLobbyAction({ action: "leave", lobbyId: lobby.id });
    setBusy(false);
    if (!result.ok) {
      buzz("error");
      failWith(result.error, result.code);
      return;
    }
    buzz("light");
    setLeaving(true);
    router.replace("/");
  }, [lobby, buzz, failWith, router]);

  return (
    <PageShell>
      <TopBar />
      <NoticeBar />

      <div className="page-body">
        {loading && !lobby ? (
          <Loader label={t.loading} />
        ) : error && !lobby ? (
          <ErrorState message={errorText(error)} onRetry={() => void refresh()} />
        ) : !lobby ? (
          <EmptyState
            title={errorText("not_found")}
            action={
              <Link className="text-button" href="/">
                {t.back}
              </Link>
            }
          />
        ) : (
          <LobbyRoom
            lobby={lobby}
            online={online}
            busy={busy || leaving}
            viewerId={profile?.id ?? ""}
            onStart={() => void start()}
            onLeave={() => void leave()}
          />
        )}
      </div>
    </PageShell>
  );
}

function LobbyRoom({
  lobby,
  online,
  busy,
  viewerId,
  onStart,
  onLeave,
}: {
  lobby: LobbyView;
  online: boolean;
  busy: boolean;
  viewerId: string;
  onStart: () => void;
  onLeave: () => void;
}) {
  const { t, buzz } = useApp();
  const isHost = lobby.me.isHost;
  const seatsLeft = Math.max(0, lobby.maxPlayers - lobby.playerCount);
  const ready = lobby.playerCount >= lobby.minPlayers;

  return (
    <>
      <section className="room-panel">
        <div className="section-heading room-heading">
          <div className="section-heading-text">
            <span className={`phase-badge phase-${lobby.phase}`}>
              <UsersRound size={14} /> {t.waiting}
            </span>
            <h2 title={lobby.name}>{lobby.name}</h2>
            <p className="room-subtitle">
              {t.host}: <strong>{lobby.hostName}</strong>
              <span className="separator-dot">·</span>
              {interpolate(t.min_players_short, { n: lobby.minPlayers })}
            </p>
          </div>
          <ConnectionBadge online={online} />
        </div>

        <div className="code-panel">
          <div className="code-panel-text">
            <small>{t.roomCode}</small>
            <strong>{lobby.code}</strong>
          </div>
          <div className="code-panel-actions">
            <CopyCodeButton code={lobby.code} label={t.copyCode} />
            <ShareButton code={lobby.code} />
          </div>
        </div>

        <div className="seat-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (lobby.playerCount / lobby.maxPlayers) * 100)}%` }} />
        </div>
        <p className="seat-progress-label">
          {interpolate(t.seats, { a: lobby.playerCount, b: lobby.maxPlayers })}
          <span className="separator-dot">·</span>
          {interpolate(t.seatsLeft, { n: seatsLeft })}
        </p>

        <div className="seat-grid">
          {lobby.players.map((player) => (
            <div
              key={player.id}
              className={`seat-card${player.alive ? "" : " is-dead"}${player.id === viewerId ? " is-me" : ""}`}
            >
              <Avatar name={player.name} avatar={player.avatar} />
              <div className="seat-info">
                <span className="seat-name" title={player.name}>
                  {player.name}
                  {player.host ? <Crown size={11} className="seat-crown" /> : null}
                </span>
                <span className="seat-meta">
                  <span className={player.connected ? "dot-online" : "dot-offline"} />
                  {player.id === viewerId ? t.me : player.host ? t.hostBadge : t.alive}
                </span>
              </div>
            </div>
          ))}
          {Array.from({ length: Math.min(9, seatsLeft) }, (_, index) => (
            <SlotCard key={`empty-${index}`} label={t.seatEmpty} />
          ))}
        </div>

        <div className="room-footer">
          {isHost ? (
            <button
              type="button"
              className="primary-button full-button"
              disabled={busy || !ready || !lobby.me.canStart}
              onClick={() => {
                buzz("medium");
                onStart();
              }}
            >
              <Sparkles size={16} /> {t.start}
            </button>
          ) : (
            <p className="muted-copy">
              {ready ? interpolate(t.waiting, {}) : interpolate(t.minPlayers, { n: lobby.minPlayers })}
            </p>
          )}
          <button type="button" className="ghost-button full-button" onClick={onLeave} disabled={busy}>
            <LogOut size={15} /> {t.leave}
          </button>
        </div>
      </section>

      <section className="how-card">
        <div className="how-title">
          <Moon size={18} /> <strong>{t.gameRules}</strong>
        </div>
        <ul className="rules-list rules-list-compact">
          <li>
            <span className="rule-check">
              <Check size={12} />
            </span>
            <span>{interpolate(t.minPlayers, { n: lobby.minPlayers })}</span>
          </li>
          <li>
            <span className="rule-check">
              <Check size={12} />
            </span>
            <span>
              {t.players}: {lobby.maxPlayers - lobby.minPlayers + 1}–{lobby.maxPlayers}
            </span>
          </li>
          <li>
            <span className="rule-check">
              <Check size={12} />
            </span>
            <span>{t.gameRules}</span>
          </li>
        </ul>
      </section>
    </>
  );
}
