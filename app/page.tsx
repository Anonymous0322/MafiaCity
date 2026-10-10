"use client";

import { ArrowRight, CircleHelp, Moon, Plus, RefreshCw, Search, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/app/providers";
import {
  Avatar,
  CopyCodeButton,
  EmptyState,
  Loader,
  NoticeBar,
  PageShell,
  PlayersPill,
  SectionTitle,
  TopBar,
} from "@/components/ui";
import { postLobbyAction } from "@/components/use-lobby";
import { getCopy } from "@/lib/i18n";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/lib/game/constants";
import type { LobbySummary, LobbyView } from "@/lib/types";

function HomeScreen({ onJoined }: { onJoined: (lobby: LobbyView) => void }) {
  const { t, profile, buzz, setNotice } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rooms, setRooms] = useState<LobbySummary[]>([]);
  const [current, setCurrent] = useState<LobbySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [mode, setMode] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [maxPlayers, setMaxPlayers] = useState(8);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/lobbies", { cache: "no-store" });
      const payload = (await response.json()) as {
        lobbies?: LobbySummary[];
        current?: LobbySummary | null;
        error?: string;
      };
      if (!response.ok) {
        setNotice(payload.error ?? "load_failed");
        return;
      }
      setRooms(payload.lobbies ?? []);
      setCurrent(payload.current ?? null);
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  // deep link: /?join=MAF-XXXXXX
  const deepLink = searchParams.get("join");
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!deepLink || autoJoined.current) return;
    autoJoined.current = true;
    void joinByCode(deepLink, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  async function joinByCode(code: string, quiet = false) {
    const reference = code.trim().toUpperCase();
    if (reference.length < 3) {
      if (!quiet) setNotice(t.codePlaceholder);
      return;
    }
    setBusy(true);
    const result = await postLobbyAction<{ lobby?: LobbyView }>({
      action: "join",
      reference,
    });
    setBusy(false);
    if (!result.ok) {
      buzz("error");
      setNotice(joinErrorMessage(result.error, result.code));
      return;
    }
    buzz("success");
    if (result.data.lobby) {
      setCurrent(result.data.lobby as unknown as LobbySummary);
      onJoined(result.data.lobby);
      router.push(`/lobby/${result.data.lobby.code}`);
    }
  }

  async function createRoom() {
    if (roomName.trim().length < 2) {
      setNotice(t.createTitle);
      return;
    }
    setBusy(true);
    const result = await postLobbyAction<{ lobby?: LobbyView }>({
      action: "create",
      name: roomName.trim(),
      mode,
      maxPlayers,
    });
    setBusy(false);
    if (!result.ok) {
      buzz("error");
      setNotice(joinErrorMessage(result.error, result.code));
      return;
    }
    buzz("success");
    setShowCreate(false);
    if (result.data.lobby) {
      onJoined(result.data.lobby);
      router.push(`/lobby/${result.data.lobby.code}`);
    }
  }

  const displayName = profile?.name ?? "…";

  return (
    <>
      <section className="hero">
        <div className="hero-texture" aria-hidden="true" />
        <div className="hero-content">
          <span className="hero-kicker">
            <span className="live-dot" /> {t.online}
          </span>
          <div className="hero-identity">
            <Avatar
              name={displayName}
              avatar={profile?.avatar}
              size="hero"
            />
            <h1 title={displayName}>{displayName}</h1>
          </div>
          <p>{t.howDescription}</p>
          <button
            type="button"
            className="primary-button hero-button"
            onClick={() => {
              setRoomName(t.title);
              setShowCreate(true);
              buzz();
            }}
          >
            <Plus size={17} /> {t.create}
          </button>
        </div>
        <div className="moon-art" aria-hidden="true">
          <Moon size={92} strokeWidth={0.8} />
        </div>
        <span className="hero-number">01 / 03</span>
      </section>

      {current ? (
        <section className="room-panel" aria-labelledby="current-room">
          <SectionTitle
            eyebrow={t.lobby}
            title={current.name}
            action={
              <Link className="ghost-button" href={`/lobby/${current.code}`}>
                {t.back} <ArrowRight size={15} />
              </Link>
            }
          />
          <div className="current-room-row">
            <CopyCodeButton code={current.code} label={`${t.roomCode} · ${current.code}`} />
            <PlayersPill count={current.playerCount} max={current.maxPlayers} />
          </div>
        </section>
      ) : (
        <section className="quick-actions">
          <button
            type="button"
            className="quick-card quick-card-main"
            onClick={() => {
              setRoomName(t.title);
              setShowCreate(true);
              buzz();
            }}
          >
            <span className="quick-icon">
              <Plus size={20} />
            </span>
            <span className="quick-card-text">
              <strong>{t.create}</strong>
              <small>{t.howDescription}</small>
            </span>
            <ArrowRight size={18} className="quick-card-arrow" />
          </button>

          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              void joinByCode(joinCode);
            }}
          >
            <span className="join-icon">
              <Search size={18} />
            </span>
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder={t.codePlaceholder}
              aria-label={t.codePlaceholder}
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
            />
            <button type="submit" disabled={busy} className="join-submit">
              {t.enter}
            </button>
          </form>
        </section>
      )}

      <section className="public-section">
        <SectionTitle
          eyebrow="MULTIPLAYER"
          title={t.publicRooms}
          action={
            <button type="button" className="icon-button" onClick={() => void load()} aria-label={t.refresh}>
              <RefreshCw size={16} />
            </button>
          }
        />
        {loading ? (
          <Loader label={t.loading} />
        ) : rooms.length === 0 ? (
          <EmptyState
            icon={<Moon size={22} />}
            title={t.empty}
            body={t.emptyHelp}
            action={
              <button type="button" className="text-button" onClick={() => setShowCreate(true)}>
                {t.create} <ArrowRight size={14} />
              </button>
            }
          />
        ) : (
          <div className="room-list">
            {rooms.map((room) => (
              <article className="public-room" key={room.id}>
                <span className="room-symbol">
                  <Moon size={18} />
                </span>
                <div className="room-details">
                  <strong title={room.name}>{room.name}</strong>
                  <span>
                    {t.host}: {room.hostName}
                  </span>
                </div>
                <span className="room-count">
                  <UsersRound size={14} />
                  {room.playerCount}/{room.maxPlayers}
                </span>
                <button
                  type="button"
                  className="join-room-button"
                  disabled={busy || room.playerCount >= room.maxPlayers}
                  onClick={() => void joinByCode(room.code)}
                >
                  {room.playerCount >= room.maxPlayers ? "—" : t.enter}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="how-card">
        <div className="how-title">
          <CircleHelp size={18} /> <strong>{t.howTo}</strong>
        </div>
        <p>{t.howDescription}</p>
        <ul className="rules-list">
          <li>
            <strong>{t.mafia}</strong>
            <span>{t.mafiaDesc}</span>
          </li>
          <li>
            <strong>{t.doctor}</strong>
            <span>{t.doctorDesc}</span>
          </li>
          <li>
            <strong>{t.detective}</strong>
            <span>{t.detectiveDesc}</span>
          </li>
          <li>
            <strong>{t.citizen}</strong>
            <span>{t.citizenDesc}</span>
          </li>
        </ul>
        <span className="rules-foot">{t.gameRules}</span>
      </section>

      {showCreate ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-heading">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t.title}</p>
                <h2 id="create-heading">{t.createTitle}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowCreate(false)} aria-label={t.close}>
                <X size={18} />
              </button>
            </div>

            <label className="field-label">
              {t.roomName}
              <input
                maxLength={32}
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder={t.roomName}
              />
            </label>

            <label className="field-label">
              {t.mode}
              <select value={mode} onChange={(event) => setMode(event.target.value as "PUBLIC" | "PRIVATE")}>
                <option value="PUBLIC">{t.public}</option>
                <option value="PRIVATE">{t.private}</option>
              </select>
            </label>

            <label className="field-label">
              {t.players}
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => setMaxPlayers((value) => Math.max(MIN_PLAYERS, value - 1))}
                  aria-label="-"
                >
                  −
                </button>
                <strong>{maxPlayers}</strong>
                <button
                  type="button"
                  onClick={() => setMaxPlayers((value) => Math.min(MAX_PLAYERS, value + 1))}
                  aria-label="+"
                >
                  +
                </button>
              </div>
            </label>

            <p className="modal-note">{t.gameRules}</p>
            <button
              type="button"
              className="primary-button full-button"
              disabled={busy || roomName.trim().length < 2}
              onClick={() => void createRoom()}
            >
              <Plus size={17} /> {t.createButton}
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * Turns an auth failure code into something a person can act on. A raw code
 * like `profile_persist_failed` told the user nothing.
 */
function describeAuthError(code: string, t: ReturnType<typeof getCopy>): string {
  switch (code) {
    case "database_not_configured":
      return t.serverMisconfigured;
    case "database_unavailable":
      return t.databaseUnavailable;
    case "telegram_signature_invalid":
    case "invalid":
      return t.authError;
    case "network":
      return t.connectionLost;
    case "not_configured":
      return t.serverMisconfigured;
    default:
      return t.genericError;
  }
}

function joinErrorMessage(code?: string, errorCode?: string): string {
  switch (errorCode ?? code) {
    case "not_found":
      return "lobby_not_found";
    case "full":
      return "lobby_full";
    case "in_progress":
      return "lobby_started";
    case "conflict":
      return "already_in_lobby";
    default:
      return code ?? "request_failed";
  }
}

function CurrentLobbyRedirect({ lobby }: { lobby: LobbyView }) {
  const router = useRouter();
  useEffect(() => {
    const target = lobby.phase === "waiting" ? `/lobby/${lobby.code}` : `/game/${lobby.code}`;
    router.replace(target);
  }, [lobby.code, lobby.phase, router]);
  return <Loader label="…" />;
}

export default function HomePage() {
  const { status, profile, t, authError, retryAuth, botUsername } = useApp();

  if (status === "loading") {
    return (
      <PageShell>
        <div className="boot-screen">
          <Loader label={t.loadingProfile} />
        </div>
      </PageShell>
    );
  }

  if (status === "unauthenticated") {
    return (
      <PageShell>
        <div className="gate-screen">
          <span className="brand-mark gate-mark">
            <Moon size={24} />
          </span>
          <p className="eyebrow">{t.title}</p>
          <h1>{t.connectionTitle}</h1>
          <p className="gate-body">{t.connectionBody}</p>
          {authError ? <p className="gate-error">{describeAuthError(authError, t)}</p> : null}
          <div className="gate-actions">
            <a className="primary-button" href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">
              {t.openTelegram} <ArrowRight size={17} />
            </a>
            <button type="button" className="ghost-button" onClick={retryAuth}>
              {t.refresh}
            </button>
          </div>
          <p className="fine-print">@{botUsername}</p>
        </div>
      </PageShell>
    );
  }

  // No Telegram `initData` and no stored session: the Mini App cannot be used.
  if (status === "outside-telegram" && !profile) {
    return (
      <PageShell>
        <div className="gate-screen">
          <span className="brand-mark gate-mark">
            <Moon size={24} />
          </span>
          <p className="eyebrow">{t.title}</p>
          <h1>{t.notInTelegram}</h1>
          <p className="gate-body">{t.connectionBody}</p>
          {authError && authError !== "init_data_missing" ? (
            <p className="gate-error">{describeAuthError(authError, t)}</p>
          ) : null}
          <div className="gate-actions">
            <a className="primary-button" href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">
              {t.openTelegram} <ArrowRight size={17} />
            </a>
            <button type="button" className="ghost-button" onClick={retryAuth}>
              {t.refresh}
            </button>
          </div>
          <p className="fine-print">@{botUsername}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <TopBar />
      <NoticeBar />
      <Suspense fallback={<Loader label={t.loading} />}>
        <HomeScreenWithRedirect />
      </Suspense>
      <footer className="app-footer">
        <span>
          <span className="footer-dot" /> {t.online}
        </span>
        <span>MAFIA · {new Date().getFullYear()}</span>
      </footer>
    </PageShell>
  );
}

function HomeScreenWithRedirect() {
  const [active, setActive] = useState<LobbyView | null>(null);
  if (active) return <CurrentLobbyRedirect lobby={active} />;
  return <HomeScreen onJoined={setActive} />;
}
