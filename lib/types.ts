export type GameRole = "mafia" | "doctor" | "detective" | "citizen";
export type LobbyMode = "PUBLIC" | "PRIVATE";
export type GamePhase = "waiting" | "night" | "day" | "finished";
export type GameWinner = "mafia" | "town" | null;

export type GamePlayer = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  alive: boolean;
  role?: GameRole;
};

export type GameLobby = {
  id: string;
  code: string;
  name: string;
  mode: LobbyMode;
  hostId: string;
  hostName: string;
  players: GamePlayer[];
  maxPlayers: number;
  phase: GamePhase;
  round: number;
  winner: GameWinner;
  events: string[];
  ownRole?: GameRole;
  mafiaTeammates?: string[];
  ownActionDone?: boolean;
  ownInvestigation?: { playerId: string; isMafia: boolean } | null;
  lastUpdated: number;
};

export type PlayerIdentity = {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
};
