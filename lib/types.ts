export type GameRole = "mafia" | "doctor" | "detective" | "citizen";
export type LobbyMode = "PUBLIC" | "PRIVATE";
export type GamePhase = "waiting" | "night" | "day" | "finished";
export type LobbyStatus = "waiting" | "starting" | "playing" | "completed" | "cancelled";
export type GameWinner = "mafia" | "town";
export type Language = "uz" | "ru" | "en";

/** Public identity of a player as seen by other players. */
export type PublicPlayer = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
};

/**
 * Engine-internal player shape. Never sent to clients directly — the
 * repository projects it into `SeatView` with roles filtered out.
 */
export type GamePlayer = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  alive: boolean;
  role?: GameRole;
};

/**
 * Seat as delivered to a client. `role` is only populated when the game rules
 * allow that client to see it (own role, or the whole table after the game).
 */
export type SeatView = PublicPlayer & {
  alive: boolean;
  host: boolean;
  connected: boolean;
  role?: GameRole;
};

/** One line of the match log, stored as key + params so it can be translated. */
export type GameEventView = {
  id: number;
  round: number;
  phase: GamePhase;
  kind: string;
  key: string;
  params: Record<string, string | number | boolean | string[]>;
};

export type InvestigationView = {
  playerId: string;
  playerName: string;
  isMafia: boolean;
  round: number;
};

export type LobbySummary = {
  id: string;
  code: string;
  name: string;
  mode: LobbyMode;
  status: LobbyStatus;
  phase: GamePhase;
  round: number;
  hostId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
  version: number;
  createdAt: string;
};

export type LobbyView = LobbySummary & {
  players: SeatView[];
  me: {
    id: string;
    isHost: boolean;
    role?: GameRole;
    alive: boolean;
    canStart: boolean;
    actionDone: boolean;
  };
  /** Populated only for the requesting player's own role. */
  allies: PublicPlayer[];
  investigation: InvestigationView | null;
  events: GameEventView[];
  winner: GameWinner | null;
  /** unchanged responses let the client skip re-rendering */
  version: number;
};

export type PlayerProfile = PublicPlayer & {
  telegramId: string;
  firstName: string;
  lastName: string | null;
  language: Language;
};

export type PlayerStats = {
  playerId: string;
  rating: number;
  peakRating: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number;
  mafiaGames: number;
  mafiaWins: number;
  mafiaWinRate: number;
  townGames: number;
  townWins: number;
  townWinRate: number;
  survived: number;
  survivalRate: number;
  rank: number | null;
  rankDelta?: number | null;
};

export type MatchHistoryEntry = {
  gameId: string;
  playedAt: string;
  role: GameRole;
  won: boolean;
  survived: boolean;
  ratingDelta: number;
  ratingAfter: number | null;
  winner: GameWinner | null;
  rounds: number;
  playerCount: number;
};

export type LeaderboardRow = {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  photoUrl: string | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  mafiaWins: number;
  townWins: number;
  winRate: number;
  isMe?: boolean;
};

export type LeaderboardView = {
  players: LeaderboardRow[];
  total: number;
  page: number;
  pageSize: number;
  me: LeaderboardRow | null;
};

/** Authoritative, server-only game document persisted in `lobbies.state`. */
export type LobbyState = {
  nightActions: {
    mafiaVotes: Record<string, string>;
    doctorTarget?: string;
    detectiveTarget?: string;
  };
  votes: Record<string, string>;
  phaseStartedAt?: string;
  investigations: Record<string, InvestigationView>;
};
