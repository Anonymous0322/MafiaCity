"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Crown,
  LogOut,
  Moon,
  ScrollText,
  Shield,
  Skull,
  Sparkles,
  Sun,
  Swords,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useApp } from "@/app/providers";
import {
  Avatar,
  ConnectionBadge,
  EmptyState,
  ErrorState,
  Loader,
  NoticeBar,
  PageShell,
  TopBar,
} from "@/components/ui";
import { postLobbyAction, useLobby } from "@/components/use-lobby";
import { interpolate, roleLabel } from "@/lib/i18n";
import { translateEvent, PHASE_TAG } from "@/lib/game/events";
import type { GameRole, LobbyView, SeatView } from "@/lib/types";

const ROLE_ICON: Record<GameRole, typeof Skull> = {
  mafia: Skull,
  doctor: Shield,
  detective: Sparkles,
  citizen: UsersRound,
};

const ROLE_DESC_KEY: Record<GameRole, "mafiaDesc" | "doctorDesc" | "detectiveDesc" | "citizenDesc"> = {
  mafia: "mafiaDesc",
  doctor: "doctorDesc",
  detective: "detectiveDesc",
  citizen: "citizenDesc",
};

export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { t, profile, buzz, failWith, errorText, setLobby } = useApp();
  const { lobby, loading, error, online, refresh } = useLobby(code);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    setLobby(lobby);
    return () => setLobby(null);
  }, [lobby, setLobby]);

  // phase transitions -> tactile + audio cue
  useEffect(() => {
    if (!lobby) return;
    const marker = `${lobby.code}:${lobby.phase}:${lobby.round}`;
    if (lastPhase.current && lastPhase.current !== marker) {
      buzz(lobby.phase === "finished" ? "heavy" : "medium");
      playPhaseCue(lobby.phase);
    }
    lastPhase.current = marker;
  }, [lobby, buzz]);

  // a lobby that is still waiting belongs on the room screen
  useEffect(() => {
    if (lobby && lobby.phase === "waiting" && lobby.status === "waiting") {
      router.replace(`/lobby/${lobby.code}`);
    }
  }, [lobby, router]);

  const act = useCallback(
    async (targetId: string) => {
      if (!lobby) return;
      setBusy(true);
      setSelected(targetId);
      const result = await postLobbyAction({
        action: lobby.phase === "night" ? "night" : "vote",
        lobbyId: lobby.id,
        targetId,
      });
      setBusy(false);
      setSelected(null);
      if (!result.ok) {
        buzz("error");
        failWith(result.error, result.code);
        return;
      }
      buzz("medium");
    },
    [lobby, buzz, failWith],
  );

  /**
   * Mid-match the seat is *kept*: closing the Mini App, refreshing or
   * navigating away must not forfeit the player's role. Only a finished or
   * cancelled match can actually be left, because then the seat is free again.
   */
  const exit = useCallback(async () => {
    if (!lobby) return;
    const over = lobby.status !== "playing" && lobby.status !== "starting";
    if (!over) {
      buzz("light");
      router.replace("/");
      return;
    }
    setBusy(true);
    const result = await postLobbyAction({ action: "leave", lobbyId: lobby.id });
    setBusy(false);
    if (!result.ok) {
      buzz("error");
      failWith(result.error, result.code);
      return;
    }
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
          <GameBoard
            lobby={lobby}
            online={online}
            busy={busy || leaving}
            viewerId={profile?.id ?? ""}
            selected={selected}
            showLog={showLog}
            onToggleLog={() => setShowLog((value) => !value)}
            onAct={(id) => void act(id)}
            onExit={() => void exit()}
          />
        )}
      </div>
    </PageShell>
  );
}

function GameBoard({
  lobby,
  online,
  busy,
  viewerId,
  selected,
  showLog,
  onToggleLog,
  onAct,
  onExit,
}: {
  lobby: LobbyView;
  online: boolean;
  busy: boolean;
  viewerId: string;
  selected: string | null;
  showLog: boolean;
  onToggleLog: () => void;
  onAct: (targetId: string) => void;
  onExit: () => void;
}) {
  const { t, language, buzz } = useApp();
  const finished = lobby.status === "completed" && lobby.phase === "finished";
  const cancelled = lobby.status === "cancelled";

  const aliveSeats = useMemo(() => lobby.players.filter((p) => p.alive), [lobby.players]);
  const deadSeats = useMemo(() => lobby.players.filter((p) => !p.alive), [lobby.players]);

  const myRole = lobby.me.role;
  const mySide: "mafia" | "town" | null = myRole
    ? myRole === "mafia"
      ? "mafia"
      : "town"
    : null;
  const won = finished && lobby.winner !== null && mySide !== null && lobby.winner === mySide;

  const canAct =
    !finished && !cancelled && lobby.status === "playing" && !lobby.me.actionDone && lobby.me.alive;

  const targets: SeatView[] = useMemo(() => {
    if (!canAct) return [];
    const allyIds = new Set(lobby.allies.map((ally) => ally.id));
    return lobby.players.filter((seat) => {
      if (!seat.alive) return false;
      if (lobby.phase === "night") {
        if (myRole === "citizen") return false;
        // the server rejects these too, but offering them is a bad experience
        if (allyIds.has(seat.id)) return false;
        if (seat.id === viewerId && myRole !== "doctor") return false;
        return true;
      }
      return seat.id !== viewerId;
    });
  }, [canAct, lobby.players, lobby.allies, lobby.phase, myRole, viewerId]);

  return (
    <>
      {/* ---------------- phase header ---------------- */}
      {finished ? (
        <div className={`result-banner ${won ? "result-win" : "result-loss"}`}>
          <Trophy size={26} />
          <strong>{won ? t.won : t.lost}</strong>
          <span>{lobby.winner === "mafia" ? t.mafia : t.town}</span>
          <small>
            {interpolate(t.round, { n: lobby.round })} · {aliveSeats.length}/{lobby.players.length}
          </small>
        </div>
      ) : cancelled ? (
        <div className="result-banner result-cancelled">
          <LogOut size={22} />
          <strong>{t.cancelled}</strong>
        </div>
      ) : (
        <div className={`round-banner round-${lobby.phase} phase-pulse`} data-phase={lobby.phase}>
          <span className="round-icon">
            {lobby.phase === "night" ? <Moon size={22} /> : <Sun size={22} />}
          </span>
          <div className="round-text">
            <strong>
              {lobby.phase === "night" ? t.night : t.day} {lobby.round}
            </strong>
            <span>{PHASE_TAG[lobby.phase === "night" ? "nightQuiet" : "dayGather"][language]}</span>
          </div>
          <span className="pill">
            <UsersRound size={13} /> {aliveSeats.length}
          </span>
        </div>
      )}

      <div className="game-status-row">
        <ConnectionBadge online={online} />
        <button type="button" className="ghost-button" onClick={onToggleLog}>
          <ScrollText size={14} /> {t.events} ({lobby.events.length})
        </button>
      </div>

      {/* ---------------- own role ---------------- */}
      {myRole && !cancelled ? (
        <div className={`role-card role-${myRole}`}>
          <span className="role-icon">
            {(() => {
              const Icon = ROLE_ICON[myRole];
              return <Icon size={19} />;
            })()}
          </span>
          <div className="role-body">
            <small>{t.role}</small>
            <strong>{roleLabel(myRole, t)}</strong>
            <p>{t[ROLE_DESC_KEY[myRole]]}</p>
            {myRole === "mafia" && lobby.allies.length > 0 ? (
              <p className="role-allies">
                {t.allies}: {lobby.allies.map((ally) => ally.name).join(", ")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {lobby.investigation ? (
        <div className="investigation-result">
          <Sparkles size={16} />
          <span>
            <strong>{t.investigated}:</strong> {lobby.investigation.playerName} —{" "}
            {lobby.investigation.isMafia ? t.isMafia : t.notMafia}
          </span>
        </div>
      ) : null}

      {!lobby.me.alive && !finished && !cancelled ? (
        <div className="spectator-note">
          <Skull size={15} /> {t.youDied} · {t.spectating}
        </div>
      ) : null}

      {/* ---------------- action area ---------------- */}
      {canAct ? (
        <section className="action-box">
          <p className="action-label">
            {lobby.phase === "night" ? t.choose : t.chooseVote}
          </p>
          <div className="target-list">
            {targets.map((seat) => (
              <button
                type="button"
                key={seat.id}
                className={`target-button${selected === seat.id ? " is-selected" : ""}`}
                disabled={busy}
                onClick={() => {
                  buzz("select");
                  onAct(seat.id);
                }}
              >
                <Avatar name={seat.name} avatar={seat.avatar} size="small" />
                <span className="target-name">{seat.name}</span>
                {seat.host ? <Crown size={12} className="target-crown" /> : null}
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>
      ) : lobby.me.actionDone && !finished && !cancelled ? (
        <div className="waiting-action">
          <Check size={17} />
          <span>{t.waitingOthers}</span>
          <span className="waiting-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}

      {/* ---------------- players ---------------- */}
      <section className="players-block">
        <div className="section-heading">
          <div className="section-heading-text">
            <p className="eyebrow">{t.alive}</p>
            <h3>{t.playersList}</h3>
          </div>
          <span>
            {aliveSeats.length}/{lobby.players.length}
          </span>
        </div>
        <div className="player-board">
          {lobby.players.map((seat) => (
            <PlayerRow
              key={seat.id}
              seat={seat}
              isMe={seat.id === viewerId}
              revealRole={finished}
              isMafiaTeam={mySide === "mafia" && seat.role === "mafia"}
            />
          ))}
        </div>
        {deadSeats.length > 0 ? (
          <p className="eliminations-note">
            <Skull size={12} /> {t.eliminations}: {deadSeats.length}
          </p>
        ) : null}
      </section>

      {/* ---------------- log ---------------- */}
      {showLog ? (
        <section className="events-block events-panel">
          <div className="section-heading">
            <div className="section-heading-text">
              <p className="eyebrow">CHRONICLE</p>
              <h3>{t.events}</h3>
            </div>
            <button type="button" className="icon-button" onClick={onToggleLog} aria-label={t.close}>
              ×
            </button>
          </div>
          {lobby.events.length === 0 ? (
            <p className="muted-copy">—</p>
          ) : (
            <ol className="event-log">
              {lobby.events.map((event) => (
                <li key={event.id} className={`event-line event-${event.kind}`}>
                  <span className="event-round">{event.round}</span>
                  <span>{translateEvent(event.key, event.params, language)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      <div className="room-footer game-footer">
        <button type="button" className="ghost-button full-button" onClick={onExit} disabled={busy}>
          <LogOut size={15} /> {finished || cancelled ? t.newGame : t.back}
        </button>
        {finished ? (
          <Link className="primary-button full-button" href="/profile">
            <Swords size={16} /> {t.stats}
          </Link>
        ) : null}
        {!finished ? <p className="muted-copy game-footer-note">{t.keepSeat}</p> : null}
      </div>
    </>
  );
}

function PlayerRow({
  seat,
  isMe,
  revealRole,
  isMafiaTeam,
}: {
  seat: SeatView;
  isMe: boolean;
  revealRole: boolean;
  isMafiaTeam: boolean;
}) {
  const { t } = useApp();
  return (
    <div
      className={`game-player${seat.alive ? "" : " is-dead"}${isMe ? " is-me" : ""}${
        isMafiaTeam ? " is-ally" : ""
      }`}
    >
      <Avatar name={seat.name} avatar={seat.avatar} size="small" />
      <span className="player-name" title={seat.name}>
        {seat.name}
        {seat.host ? <Crown size={11} className="player-crown" /> : null}
        {isMe ? <em className="player-you">{t.me}</em> : null}
      </span>
      <span className="player-state">{seat.alive ? t.alive : t.dead}</span>
      {revealRole && seat.role ? (
        <span className={`revealed-role role-${seat.role}`}>{roleLabel(seat.role, t)}</span>
      ) : null}
    </div>
  );
}

/** Tiny WebAudio blip — no asset downloads, respects the user gesture rules. */
function playPhaseCue(phase: string) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = phase === "night" ? 180 : phase === "day" ? 420 : 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio is optional */
  }
}
