"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Crown,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  Skull,
  Sparkles,
  Sun,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GameLobby, GameRole, LobbyMode, PlayerIdentity } from "@/lib/types";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: { impactOccurred: (style: "light" | "medium" | "heavy") => void };
      };
    };
  }
}

type Language = "uz" | "ru" | "en";

const copy = {
  uz: {
    title: "TUNGI SHAHAR",
    subtitle: "Kimga ishonasan?",
    play: "O‘yinga kirish",
    create: "Xona ochish",
    join: "Kod bilan kirish",
    publicRooms: "Ochiq xonalar",
    empty: "Hozircha ochiq xona yo‘q",
    emptyHelp: "Do‘stlaringizni yig‘ing va birinchi xonani oching.",
    createTitle: "Yangi xona",
    roomName: "Xona nomi",
    mode: "Xona turi",
    public: "Ochiq",
    private: "Yopiq",
    players: "O‘yinchilar soni",
    codePlaceholder: "Xona kodini kiriting",
    enter: "Kirish",
    host: "Xona egasi",
    start: "O‘yinni boshlash",
    waiting: "O‘yinchilar kutilmoqda",
    minPlayers: "Boshlash uchun kamida 5 o‘yinchi kerak",
    night: "TUN",
    day: "KUN",
    finished: "O‘YIN TUGADI",
    role: "Sizning rolingiz",
    choose: "Nishonni tanlang",
    actionDone: "Harakatingiz qabul qilindi. Boshqalar kutilmoqda…",
    vote: "Ovoz berish",
    playersList: "O‘yinchilar",
    events: "Shahar xabarlari",
    leave: "Xonadan chiqish",
    won: "G‘ALABA",
    lost: "MAG‘LUBIYAT",
    town: "Shahar",
    mafia: "Mafiya",
    citizen: "Oddiy fuqaro",
    doctor: "Shifokor",
    detective: "Tergovchi",
    mafiaDesc: "Tun qorong‘usida bir o‘yinchini tanlang.",
    doctorDesc: "Har kecha bir kishini himoya qiling.",
    detectiveDesc: "Bir o‘yinchini tekshirib, uning mafiyaligini biling.",
    citizenDesc: "Kunduzi kuzating va shubhali o‘yinchiga ovoz bering.",
    howTo: "Qanday o‘ynaladi",
    howDescription: "Mafiyani toping, tunda omon qoling va shaharingizni himoya qiling.",
    invite: "Kodni ulashish",
    copied: "Kod nusxalandi",
    online: "Telegram Mini App",
    loading: "Xonalar yuklanmoqda…",
    openTelegram: "Telegramda ochish",
    authHint: "O‘yinni bot orqali Telegram ichida oching.",
    close: "Yopish",
    createButton: "Xonani yaratish",
    refresh: "Yangilash",
    dead: "O‘yindan chiqdi",
    alive: "Tirik",
    investigated: "Tekshiruv natijasi",
    isMafia: "Bu o‘yinchi — mafiya.",
    notMafia: "Bu o‘yinchi mafiya emas.",
    allies: "Mafiyadagi sheriklar",
    gameRules: "5–20 o‘yinchi · Harakatlar maxfiy · Teng ovozda hech kim chiqmaydi",
  },
  ru: {
    title: "НОЧНОЙ ГОРОД",
    subtitle: "Кому ты доверяешь?",
    play: "Играть",
    create: "Создать комнату",
    join: "Войти по коду",
    publicRooms: "Открытые комнаты",
    empty: "Пока нет открытых комнат",
    emptyHelp: "Соберите друзей и создайте первую комнату.",
    createTitle: "Новая комната",
    roomName: "Название комнаты",
    mode: "Тип комнаты",
    public: "Открытая",
    private: "Закрытая",
    players: "Игроков",
    codePlaceholder: "Введите код комнаты",
    enter: "Войти",
    host: "Ведущий",
    start: "Начать игру",
    waiting: "Ожидание игроков",
    minPlayers: "Для начала нужно минимум 5 игроков",
    night: "НОЧЬ",
    day: "ДЕНЬ",
    finished: "ИГРА ОКОНЧЕНА",
    role: "Ваша роль",
    choose: "Выберите цель",
    actionDone: "Действие принято. Ожидаем остальных…",
    vote: "Голосовать",
    playersList: "Игроки",
    events: "Новости города",
    leave: "Покинуть комнату",
    won: "ПОБЕДА",
    lost: "ПОРАЖЕНИЕ",
    town: "Город",
    mafia: "Мафия",
    citizen: "Мирный житель",
    doctor: "Доктор",
    detective: "Детектив",
    mafiaDesc: "Выберите игрока для ночного устранения.",
    doctorDesc: "Каждую ночь защищайте одного игрока.",
    detectiveDesc: "Проверьте игрока и узнайте, мафия ли он.",
    citizenDesc: "Наблюдайте днём и голосуйте против подозреваемого.",
    howTo: "Как играть",
    howDescription: "Найдите мафию, переживите ночь и защитите свой город.",
    invite: "Поделиться кодом",
    copied: "Код скопирован",
    online: "Telegram Mini App",
    loading: "Загрузка комнат…",
    openTelegram: "Открыть в Telegram",
    authHint: "Откройте игру в Telegram через бота.",
    close: "Закрыть",
    createButton: "Создать комнату",
    refresh: "Обновить",
    dead: "Выбыл",
    alive: "В игре",
    investigated: "Результат проверки",
    isMafia: "Этот игрок — мафия.",
    notMafia: "Этот игрок не мафия.",
    allies: "Сообщники",
    gameRules: "5–20 игроков · Тайные действия · При равенстве голосов никто не выбывает",
  },
  en: {
    title: "THE NIGHT CITY",
    subtitle: "Who do you trust?",
    play: "Play",
    create: "Create a room",
    join: "Join with code",
    publicRooms: "Open rooms",
    empty: "No open rooms yet",
    emptyHelp: "Gather your friends and create the first room.",
    createTitle: "New room",
    roomName: "Room name",
    mode: "Room type",
    public: "Public",
    private: "Private",
    players: "Players",
    codePlaceholder: "Enter room code",
    enter: "Join",
    host: "Host",
    start: "Start game",
    waiting: "Waiting for players",
    minPlayers: "At least 5 players are needed",
    night: "NIGHT",
    day: "DAY",
    finished: "GAME OVER",
    role: "Your role",
    choose: "Choose a target",
    actionDone: "Action received. Waiting for others…",
    vote: "Vote",
    playersList: "Players",
    events: "City news",
    leave: "Leave room",
    won: "VICTORY",
    lost: "DEFEAT",
    town: "Town",
    mafia: "Mafia",
    citizen: "Citizen",
    doctor: "Doctor",
    detective: "Detective",
    mafiaDesc: "Choose a player to eliminate tonight.",
    doctorDesc: "Protect one player each night.",
    detectiveDesc: "Investigate a player to learn if they are mafia.",
    citizenDesc: "Observe during the day and vote for a suspect.",
    howTo: "How to play",
    howDescription: "Find the mafia, survive the night, and protect your city.",
    invite: "Share room code",
    copied: "Code copied",
    online: "Telegram Mini App",
    loading: "Loading rooms…",
    openTelegram: "Open in Telegram",
    authHint: "Open the game inside Telegram using the bot.",
    close: "Close",
    createButton: "Create room",
    refresh: "Refresh",
    dead: "Eliminated",
    alive: "Alive",
    investigated: "Investigation result",
    isMafia: "This player is mafia.",
    notMafia: "This player is not mafia.",
    allies: "Mafia teammates",
    gameRules: "5–20 players · Secret actions · Ties mean no elimination",
  },
} satisfies Record<Language, Record<string, string>>;

function Avatar({ name, avatar, size = "normal" }: { name: string; avatar?: string | null; size?: "normal" | "small" }) {
  return (
    <span
      aria-label={name}
      className={`avatar ${size === "small" ? "avatar-small" : ""}`}
      style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
    >
      {!avatar && name.slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

function roleLabel(role: GameRole | undefined, t: Record<string, string>) {
  if (!role) return "";
  return t[role] ?? t.citizen;
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("uz");
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [rooms, setRooms] = useState<GameLobby[]>([]);
  const [current, setCurrent] = useState<GameLobby | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("Tungi shahar");
  const [mode, setMode] = useState<LobbyMode>("PUBLIC");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [busy, setBusy] = useState(false);
  const [outsideTelegram, setOutsideTelegram] = useState(true);
  const t = copy[language];

  const refreshRooms = useCallback(async () => {
    if (!identity) return;
    try {
      const response = await fetch("/api/lobbies", { cache: "no-store" });
      const payload = await response.json() as { lobbies?: GameLobby[]; current?: GameLobby[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Xonalar yuklanmadi.");
      setRooms(payload.lobbies ?? []);
      setCurrent(payload.current?.[0] ?? null);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Telegram orqali")) {
        setOutsideTelegram(true);
      } else {
        setNotice(error instanceof Error ? error.message : "Server bilan aloqa uzildi.");
      }
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const webApp = await new Promise<
        NonNullable<NonNullable<Window["Telegram"]>["WebApp"]> | undefined
      >((resolve) => {
        if (window.Telegram?.WebApp) {
          resolve(window.Telegram.WebApp);
          return;
        }
        const finish = () => {
          window.removeEventListener("telegram-webapp-ready", onReady);
          window.removeEventListener("telegram-webapp-unavailable", onUnavailable);
          window.clearTimeout(timeoutId);
        };
        const onReady = () => {
          finish();
          resolve(window.Telegram?.WebApp);
        };
        const onUnavailable = () => {
          finish();
          resolve(undefined);
        };
        const timeoutId = window.setTimeout(onUnavailable, 5000);
        window.addEventListener("telegram-webapp-ready", onReady, { once: true });
        window.addEventListener("telegram-webapp-unavailable", onUnavailable, { once: true });
      });
      webApp?.ready();
      webApp?.expand();
      webApp?.setHeaderColor?.("#151310");
      webApp?.setBackgroundColor?.("#151310");

      if (webApp?.initData) {
        try {
          const response = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: webApp.initData }),
          });
          const payload = await response.json() as { session?: PlayerIdentity; error?: string };
          if (!response.ok || !payload.session) throw new Error(payload.error || "Telegram tekshiruvi o‘tmadi.");
          if (active) {
            setIdentity(payload.session);
            setOutsideTelegram(false);
          }
          return;
        } catch (error) {
          if (active) {
            setNotice(error instanceof Error ? error.message : "Telegram tekshiruvi o‘tmadi.");
            setOutsideTelegram(true);
          }
          return;
        }
      }
      if (active) setOutsideTelegram(true);
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!identity) return;
    void refreshRooms();
    const timer = window.setInterval(() => void refreshRooms(), 5000);
    return () => window.clearInterval(timer);
  }, [identity, refreshRooms]);

  async function performAction(body: Record<string, unknown>) {
    if (!identity) return;
    setBusy(true);
    try {
      const response = await fetch("/api/lobbies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { lobby?: GameLobby; error?: string };
      if (!response.ok) throw new Error(payload.error || "Amalni bajarib bo‘lmadi.");
      if (body.action === "leave") return;
      setNotice("");
      if (payload.lobby) setCurrent(payload.lobby);
      await refreshRooms();
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
      return payload.lobby;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Telegram orqali")) {
        setOutsideTelegram(true);
      }
      setNotice(error instanceof Error ? error.message : "Amalni bajarib bo‘lmadi.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    const lobby = await performAction({
      action: "create",
      name: roomName,
      mode,
      maxPlayers,
    });
    if (lobby) setShowCreate(false);
  }

  async function joinRoom(code: string) {
    if (!code.trim()) {
      setNotice("Xona kodini kiriting.");
      return;
    }
    await performAction({ action: "join", code: code.trim() });
    setJoinCode("");
  }

  async function copyCode() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.code);
      setNotice(t.copied);
    } catch {
      setNotice(`Xona kodi: ${current.code}`);
    }
  }

  async function leaveRoom() {
    if (!current) return;
    const result = await performAction({ action: "leave", lobbyId: current.id });
    if (result === undefined) {
      setCurrent(null);
      await refreshRooms();
    }
  }

  const botUrl = `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "mafiauz_robot"}`;
  const aliveCount = current?.players.filter((player) => player.alive).length ?? 0;
  const isHost = Boolean(current && identity && current.hostId === identity.id);
  const roleDescription: Record<GameRole, string> = {
    mafia: t.mafiaDesc,
    doctor: t.doctorDesc,
    detective: t.detectiveDesc,
    citizen: t.citizenDesc,
  };
  const roleIcon: Record<GameRole, typeof Shield> = {
    mafia: Skull,
    doctor: Shield,
    detective: Sparkles,
    citizen: UsersRound,
  };

  // if (outsideTelegram) {
  //   return (
  //     <main className="outside-screen">
  //       <div className="outside-card">
  //         <span className="brand-mark"><Moon size={25} /></span>
  //         <p className="eyebrow">{t.title}</p>
  //         <h1>{t.authHint}</h1>
  //         {notice && <p className="auth-error" role="alert">{notice}</p>}
  //         <a className="primary-button" href={botUrl} target="_blank" rel="noreferrer">
  //           {t.openTelegram}<ArrowRight size={17} />
  //         </a>
  //         <p className="fine-print">@{process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "mafiauz_robot"}</p>
  //       </div>
  //     </main>
  //   );
  // }

  return (
    <main className="app-background">
      <div className="game-app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark"><Moon size={19} /></span>
            <div><p className="eyebrow">{t.title}</p><span>{t.subtitle}</span></div>
          </div>
          <div className="top-actions">
            <select
              aria-label="Language"
              className="language-select"
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="uz">UZ</option><option value="ru">RU</option><option value="en">EN</option>
            </select>
          </div>
        </header>

        <section className="hero">
          <div className="hero-texture" />
          <div className="hero-content">
            <span className="hero-kicker"><span className="live-dot" /> {t.online}</span>
            <h1>{identity?.name || "…"}</h1>
            <p>{t.howDescription}</p>
            <button className="primary-button hero-button" onClick={() => setShowCreate(true)}>
              <Plus size={17} /> {t.create}
            </button>
          </div>
          <div className="moon-art"><Moon size={95} strokeWidth={0.8} /></div>
          <span className="hero-number">01 / 03</span>
        </section>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label={t.close} onClick={() => setNotice("")}><X size={16} /></button>
          </div>
        )}

        {current ? (
          <section className="room-panel">
            <div className="section-heading room-heading">
              <div>
                <div className={`phase-badge phase-${current.phase}`}>
                  {current.phase === "waiting" ? <UsersRound size={14} /> : current.phase === "night" ? <Moon size={14} /> : current.phase === "day" ? <Sun size={14} /> : <Check size={14} />}
                  {current.phase === "waiting" ? t.waiting : current.phase === "night" ? t.night : current.phase === "day" ? t.day : t.finished}
                </div>
                <h2>{current.name}</h2>
                <p>{current.players.length}/{current.maxPlayers} {t.players.toLowerCase()} <span className="separator-dot">·</span> {t.host}: {current.hostName}</p>
              </div>
              {current.phase === "waiting" && (
                <button className="icon-button" aria-label={t.invite} onClick={() => void copyCode()}><Copy size={17} /></button>
              )}
            </div>

            {current.phase === "waiting" ? (
              <>
                <div className="invite-code" onClick={() => void copyCode()} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && void copyCode()}>
                  <span><small>ROOM CODE</small><strong>{current.code}</strong></span>
                  <Copy size={17} />
                </div>
                <div className="member-grid">
                  {current.players.map((player) => (
                    <div className="member-card" key={player.id}>
                      <Avatar name={player.name} avatar={player.avatar} />
                      <span>{player.name}{player.id === current.hostId && <Crown size={12} />}</span>
                    </div>
                  ))}
                  {Array.from({ length: Math.min(4, current.maxPlayers - current.players.length) }, (_, index) => (
                    <div className="member-card empty-seat" key={`empty-${index}`}><span>+</span><small>{t.waiting}</small></div>
                  ))}
                </div>
                <div className="room-footer">
                  {!isHost && <p className="muted-copy">{t.minPlayers}</p>}
                  {isHost && current.players.length < 5 && <p className="muted-copy">{t.minPlayers}</p>}
                  {isHost && (
                    <button
                      className="primary-button"
                      disabled={busy || current.players.length < 5}
                      onClick={() => void performAction({ action: "start", lobbyId: current.id })}
                    >
                      <Sparkles size={16} /> {t.start}
                    </button>
                  )}
                  <button className="text-button" onClick={() => void leaveRoom()}>{t.leave}</button>
                </div>
              </>
            ) : (
              <div className="match-content">
                {current.phase === "finished" ? (
                  <div className={`result-banner ${current.winner === (current.ownRole === "mafia" ? "mafia" : "town") ? "result-win" : "result-loss"}`}>
                    <Sparkles size={22} />
                    <strong>{current.winner === (current.ownRole === "mafia" ? "mafia" : "town") ? t.won : t.lost}</strong>
                    <span>{current.winner === "mafia" ? t.mafia : t.town}</span>
                  </div>
                ) : (
                  <div className={`round-banner ${current.phase === "night" ? "round-night" : "round-day"}`}>
                    {current.phase === "night" ? <Moon size={20} /> : <Sun size={20} />}
                    <div><strong>{current.phase === "night" ? t.night : t.day} {current.round}</strong><span>{current.phase === "night" ? "Shahar jimjitlikka cho‘mdi" : "Shahar aholisining yig‘ilishi"}</span></div>
                    <span className="alive-pill">{aliveCount} <UsersRound size={13} /></span>
                  </div>
                )}

                {current.ownRole && (
                  <div className={`role-card role-${current.ownRole}`}>
                    {(() => {
                      const Icon = roleIcon[current.ownRole!];
                      return <span className="role-icon"><Icon size={19} /></span>;
                    })()}
                    <div>
                      <small>{t.role}</small><strong>{roleLabel(current.ownRole, t)}</strong>
                      <p>{roleDescription[current.ownRole]}</p>
                      {current.mafiaTeammates && current.mafiaTeammates.length > 0 && <p>{t.allies}: {current.mafiaTeammates.join(", ")}</p>}
                    </div>
                  </div>
                )}

                {current.ownInvestigation && (
                  <div className="investigation-result">
                    <Sparkles size={16} />
                    <span><strong>{t.investigated}:</strong> {current.players.find((p) => p.id === current.ownInvestigation?.playerId)?.name} — {current.ownInvestigation.isMafia ? t.isMafia : t.notMafia}</span>
                  </div>
                )}

                {current.phase !== "finished" && !current.ownActionDone && (
                  <div className="action-box">
                    <p className="action-label">{current.phase === "night" ? t.choose : t.vote}</p>
                    <div className="target-list">
                      {current.players.filter((player) => player.alive && (current.ownRole === "doctor" || player.id !== identity?.id)).map((player) => (
                        <button
                          className="target-button"
                          disabled={busy}
                          key={player.id}
                          onClick={() => void performAction({
                            action: current.phase === "night" ? "night" : "vote",
                            lobbyId: current.id,
                            targetId: player.id,
                          })}
                        >
                          <Avatar name={player.name} avatar={player.avatar} size="small" />
                          <span>{player.name}</span><ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {current.ownActionDone && current.phase !== "finished" && (
                  <div className="waiting-action"><Check size={17} />{t.actionDone}</div>
                )}

                <div className="players-block">
                  <div className="section-heading"><h3>{t.playersList}</h3><span>{aliveCount}/{current.players.length}</span></div>
                  <div className="game-player-list">
                    {current.players.map((player) => (
                      <div className={`game-player ${player.alive ? "" : "player-dead"}`} key={player.id}>
                        <Avatar name={player.name} avatar={player.avatar} size="small" />
                        <span className="player-name">{player.name}{player.id === current.hostId && <Crown size={12} />}</span>
                        <span className="player-state">{player.alive ? t.alive : t.dead}</span>
                        {current.phase === "finished" && player.role && <span className="revealed-role">{roleLabel(player.role, t)}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="events-block">
                  <div className="section-heading"><h3>{t.events}</h3></div>
                  {current.events.length === 0 ? <p className="muted-copy">—</p> : current.events.map((event, index) => <p className="event-line" key={`${index}-${event}`}>{event}</p>)}
                </div>
                {current.phase === "finished" && (
                  <button className="primary-button full-button" onClick={() => void leaveRoom()}><ArrowLeft size={16} /> {t.leave}</button>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="quick-actions">
              <button className="quick-card quick-card-main" onClick={() => setShowCreate(true)}>
                <span className="quick-icon"><Plus size={20} /></span><span><strong>{t.create}</strong><small>{t.howDescription}</small></span><ArrowRight size={18} />
              </button>
              <form className="join-form" onSubmit={(event) => { event.preventDefault(); void joinRoom(joinCode); }}>
                <span className="join-icon"><ArrowRight size={18} /></span>
                <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder={t.codePlaceholder} aria-label={t.codePlaceholder} />
                <button type="submit" disabled={busy}>{t.enter}</button>
              </form>
            </section>

            <section className="public-section">
              <div className="section-heading">
                <div><p className="eyebrow">MULTIPLAYER</p><h2>{t.publicRooms}</h2></div>
                <button className="icon-button" onClick={() => void refreshRooms()} aria-label={t.refresh}><RefreshCw size={16} /></button>
              </div>
              {loading ? (
                <div className="empty-state"><span className="loader" />{t.loading}</div>
              ) : rooms.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon"><Moon size={22} /></span>
                  <strong>{t.empty}</strong><p>{t.emptyHelp}</p>
                  <button className="text-button" onClick={() => setShowCreate(true)}>{t.create} <ArrowRight size={14} /></button>
                </div>
              ) : (
                <div className="room-list">
                  {rooms.map((lobby) => (
                    <article className="public-room" key={lobby.id}>
                      <span className="room-symbol"><Moon size={18} /></span>
                      <div className="room-details"><strong>{lobby.name}</strong><span>{t.host}: {lobby.hostName}</span></div>
                      <span className="room-count"><UsersRound size={14} />{lobby.players.length}/{lobby.maxPlayers}</span>
                      <button className="join-room-button" disabled={busy} onClick={() => void joinRoom(lobby.id)}>{t.enter}</button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="how-card">
              <div className="how-title"><CircleHelp size={18} /><strong>{t.howTo}</strong></div>
              <p>{t.howDescription}</p>
              <span>{t.gameRules}</span>
            </section>
          </>
        )}

        <footer className="app-footer">
          <span><span className="footer-dot" /> {t.online}</span>
          <span>MAFIA · {new Date().getFullYear()}</span>
        </footer>

        {showCreate && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}>
            <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-heading">
              <div className="modal-heading"><div><p className="eyebrow">{t.title}</p><h2 id="create-heading">{t.createTitle}</h2></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label={t.close}><X size={18} /></button></div>
              <label className="field-label">{t.roomName}<input maxLength={32} minLength={2} value={roomName} onChange={(event) => setRoomName(event.target.value)} /></label>
              <label className="field-label">{t.mode}<select value={mode} onChange={(event) => setMode(event.target.value as LobbyMode)}><option value="PUBLIC">{t.public}</option><option value="PRIVATE">{t.private}</option></select></label>
              <label className="field-label">{t.players}<div className="stepper"><button type="button" onClick={() => setMaxPlayers((value) => Math.max(5, value - 1))}>−</button><strong>{maxPlayers}</strong><button type="button" onClick={() => setMaxPlayers((value) => Math.min(20, value + 1))}>+</button></div></label>
              <p className="modal-note">{t.gameRules}</p>
              <button className="primary-button full-button" disabled={busy || roomName.trim().length < 2} onClick={() => void createRoom()}><Plus size={17} />{t.createButton}</button>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
