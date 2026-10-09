import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type {
  GameLobby,
  GamePlayer,
  GameRole,
  LobbyMode,
  PlayerIdentity,
} from "@/lib/types";

type InternalPlayer = GamePlayer & { role?: GameRole };
type InternalLobby = Omit<GameLobby, "players" | "ownRole" | "ownInvestigation"> & {
  players: InternalPlayer[];
  nightActions: {
    mafiaVotes: Record<string, string>;
    doctorTarget?: string;
    detectiveTarget?: string;
  };
  votes: Record<string, string>;
  investigations: Record<string, { playerId: string; isMafia: boolean }>;
};
type Store = { lobbies: InternalLobby[] };

const globalStore = globalThis as typeof globalThis & { mafiaGameStore?: Store };
const store = (globalStore.mafiaGameStore ??= { lobbies: [] });

function createCode() {
  let code: string;
  do {
    code = `MAF-${randomBytes(3).toString("hex").toUpperCase()}`;
  } while (store.lobbies.some((lobby) => lobby.code === code));
  return code;
}

function getLobby(key: string) {
  return store.lobbies.find(
    (lobby) => lobby.id === key || lobby.code.toLowerCase() === key.toLowerCase(),
  );
}

function requirePlayer(lobby: InternalLobby, playerId: string) {
  const player = lobby.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error("Bu xonada emassiz.");
  return player;
}

function checkWinner(lobby: InternalLobby) {
  const mafia = lobby.players.filter((player) => player.alive && player.role === "mafia").length;
  const town = lobby.players.filter((player) => player.alive && player.role !== "mafia").length;
  if (mafia === 0) {
    lobby.phase = "finished";
    lobby.winner = "town";
    lobby.events.unshift("Shahar aholisi mafiyani fosh qildi. Shahar g‘alaba qozondi!");
  } else if (mafia >= town) {
    lobby.phase = "finished";
    lobby.winner = "mafia";
    lobby.events.unshift("Mafiya shaharda nazoratni qo‘lga oldi. Mafiya g‘alaba qozondi!");
  }
}

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function assignRoles(lobby: InternalLobby) {
  const count = lobby.players.length;
  const mafiaCount = count >= 10 ? 3 : count >= 7 ? 2 : 1;
  const roles: GameRole[] = [
    ...Array.from({ length: mafiaCount }, () => "mafia" as const),
    "doctor",
    "detective",
    ...Array.from({ length: count - mafiaCount - 2 }, () => "citizen" as const),
  ];
  shuffle(roles);
  lobby.players.forEach((player, index) => {
    player.role = roles[index];
    player.alive = true;
  });
}

function resolveNight(lobby: InternalLobby) {
  const { mafiaVotes, doctorTarget, detectiveTarget } = lobby.nightActions;
  lobby.investigations = {};
  const totals = new Map<string, number>();
  Object.values(mafiaVotes).forEach((targetId) => totals.set(targetId, (totals.get(targetId) ?? 0) + 1));
  const topVotes = Math.max(0, ...totals.values());
  const leaders = [...totals.entries()].filter(([, count]) => count === topVotes);
  const mafiaTarget = leaders.length === 1 ? leaders[0][0] : null;
  if (mafiaTarget && mafiaTarget !== doctorTarget) {
    const victim = lobby.players.find((player) => player.id === mafiaTarget);
    if (victim?.alive) {
      victim.alive = false;
      lobby.events.unshift(`${victim.name} tunda o‘yindan chiqdi.`);
    }
  } else if (mafiaTarget && mafiaTarget === doctorTarget) {
    lobby.events.unshift("Shifokor nishonni qutqardi. Kechasi hech kim o‘yindan chiqmadi.");
  } else if (Object.keys(mafiaVotes).length > 1) {
    lobby.events.unshift("Mafiyaning ovozlari teng bo‘ldi. Kechasi hech kim nishonga olinmadi.");
  }

  if (detectiveTarget) {
    const target = lobby.players.find((player) => player.id === detectiveTarget);
    const detective = lobby.players.find((player) => player.role === "detective" && player.alive);
    if (target && detective) {
      lobby.investigations[detective.id] = {
        playerId: target.id,
        isMafia: target.role === "mafia",
      };
    }
  }

  lobby.nightActions = { mafiaVotes: {} };
  checkWinner(lobby);
  if (lobby.phase !== "finished") lobby.phase = "day";
}

function resolveVotes(lobby: InternalLobby) {
  const totals = new Map<string, number>();
  Object.values(lobby.votes).forEach((target) => totals.set(target, (totals.get(target) ?? 0) + 1));
  const maxVotes = Math.max(0, ...totals.values());
  const leaders = [...totals.entries()].filter(([, votes]) => votes === maxVotes);

  if (leaders.length === 1 && maxVotes > 0) {
    const eliminated = lobby.players.find((player) => player.id === leaders[0][0]);
    if (eliminated?.alive) {
      eliminated.alive = false;
      lobby.events.unshift(`${eliminated.name} ovoz berish orqali o‘yindan chiqdi.`);
    }
  } else {
    lobby.events.unshift("Ovozlar teng bo‘ldi. Bu safar hech kim chiqarilmadi.");
  }

  lobby.votes = {};
  checkWinner(lobby);
  if (lobby.phase !== "finished") {
    lobby.round += 1;
    lobby.phase = "night";
  }
}

export function listPublicLobbies() {
  return store.lobbies.filter((lobby) => lobby.mode === "PUBLIC" && lobby.phase === "waiting");
}

export function getPlayerLobbies(playerId: string) {
  return store.lobbies.filter((lobby) => lobby.players.some((player) => player.id === playerId));
}

export function createLobby(
  identity: PlayerIdentity,
  input: { name: string; mode: LobbyMode; maxPlayers: number },
) {
  if (getPlayerLobbies(identity.id).length > 0) {
    throw new Error("Avval joriy xonangizdan chiqing.");
  }
  const lobby: InternalLobby = {
    id: randomUUID(),
    code: createCode(),
    name: input.name.trim(),
    mode: input.mode,
    hostId: identity.id,
    hostName: identity.name,
    players: [{ ...identity, alive: true }],
    maxPlayers: input.maxPlayers,
    phase: "waiting",
    round: 0,
    winner: null,
    events: [],
    nightActions: { mafiaVotes: {} },
    votes: {},
    investigations: {},
    lastUpdated: Date.now(),
  };
  store.lobbies.unshift(lobby);
  return lobby;
}

export function joinLobby(identity: PlayerIdentity, key: string) {
  const lobby = getLobby(key.trim());
  if (!lobby || (lobby.mode === "PRIVATE" && lobby.code.toLowerCase() !== key.trim().toLowerCase())) {
    throw new Error("Xona kodi topilmadi.");
  }
  if (lobby.phase !== "waiting") throw new Error("O‘yin allaqachon boshlangan.");
  if (lobby.players.some((player) => player.id === identity.id)) return lobby;
  if (getPlayerLobbies(identity.id).length > 0) {
    throw new Error("Bir vaqtning o‘zida faqat bitta xonada bo‘lish mumkin.");
  }
  if (lobby.players.length >= lobby.maxPlayers) throw new Error("Xona to‘la.");
  lobby.players.push({ ...identity, alive: true });
  lobby.lastUpdated = Date.now();
  return lobby;
}

export function leaveLobby(lobbyId: string, playerId: string) {
  const lobby = getLobby(lobbyId);
  if (!lobby) throw new Error("Xona topilmadi.");
  requirePlayer(lobby, playerId);
  if (lobby.phase !== "waiting" && lobby.phase !== "finished") {
    throw new Error("O‘yin boshlanganidan keyin xonadan chiqib bo‘lmaydi.");
  }
  lobby.players = lobby.players.filter((player) => player.id !== playerId);
  if (lobby.players.length === 0) {
    store.lobbies = store.lobbies.filter((entry) => entry.id !== lobby.id);
  } else if (lobby.hostId === playerId) {
    lobby.hostId = lobby.players[0].id;
    lobby.hostName = lobby.players[0].name;
  }
}

export function startLobby(lobbyId: string, playerId: string) {
  const lobby = getLobby(lobbyId);
  if (!lobby) throw new Error("Xona topilmadi.");
  requirePlayer(lobby, playerId);
  if (lobby.hostId !== playerId) throw new Error("Faqat xona egasi o‘yinni boshlashi mumkin.");
  if (lobby.phase !== "waiting") throw new Error("O‘yin allaqachon boshlangan.");
  if (lobby.players.length < 5) throw new Error("O‘yinni boshlash uchun kamida 5 o‘yinchi kerak.");
  assignRoles(lobby);
  lobby.phase = "night";
  lobby.round = 1;
  lobby.events.unshift("Tun tushdi. Har bir rol o‘z harakatini bajarsin.");
  lobby.lastUpdated = Date.now();
  return lobby;
}

export function submitGameAction(
  lobbyId: string,
  playerId: string,
  action: "night" | "vote",
  targetId: string,
) {
  const lobby = getLobby(lobbyId);
  if (!lobby) throw new Error("Xona topilmadi.");
  const actor = requirePlayer(lobby, playerId);
  const target = requirePlayer(lobby, targetId);
  if (!actor.alive) throw new Error("O‘yindan chiqqan o‘yinchi harakat qila olmaydi.");
  if (!target.alive) throw new Error("O‘yindan chiqqan o‘yinchini tanlab bo‘lmaydi.");
  if (actor.id === target.id && actor.role !== "doctor") {
    throw new Error("O‘zingizni nishon qilib tanlay olmaysiz.");
  }

  if (action === "night") {
    if (lobby.phase !== "night") throw new Error("Hozir tun harakati vaqti emas.");
    if (actor.role === "mafia") {
      if (target.role === "mafia") throw new Error("Mafiya o‘z guruhidagi o‘yinchini tanlay olmaydi.");
      if (lobby.nightActions.mafiaVotes[actor.id]) throw new Error("Siz allaqachon nishon tanlagansiz.");
      lobby.nightActions.mafiaVotes[actor.id] = target.id;
    } else if (actor.role === "doctor") {
      if (lobby.nightActions.doctorTarget) throw new Error("Shifokor harakati allaqachon bajarilgan.");
      lobby.nightActions.doctorTarget = target.id;
    } else if (actor.role === "detective") {
      if (lobby.nightActions.detectiveTarget) throw new Error("Tergovchi harakati allaqachon bajarilgan.");
      lobby.nightActions.detectiveTarget = target.id;
    } else {
      throw new Error("Bu rolda tungi harakat yo‘q.");
    }
    const mafiaAlive = lobby.players.some((player) => player.alive && player.role === "mafia");
    const doctorAlive = lobby.players.some((player) => player.alive && player.role === "doctor");
    const detectiveAlive = lobby.players.some((player) => player.alive && player.role === "detective");
    if (
      (!mafiaAlive || lobby.players.filter((player) => player.alive && player.role === "mafia").every((player) => lobby.nightActions.mafiaVotes[player.id])) &&
      (!doctorAlive || lobby.nightActions.doctorTarget) &&
      (!detectiveAlive || lobby.nightActions.detectiveTarget)
    ) {
      resolveNight(lobby);
    }
  } else {
    if (lobby.phase !== "day") throw new Error("Hozir ovoz berish vaqti emas.");
    if (lobby.votes[actor.id]) throw new Error("Siz allaqachon ovoz berdingiz.");
    lobby.votes[actor.id] = target.id;
    const livingPlayers = lobby.players.filter((player) => player.alive).length;
    if (Object.keys(lobby.votes).length === livingPlayers) resolveVotes(lobby);
  }
  lobby.lastUpdated = Date.now();
  return lobby;
}

export function presentLobby(lobby: InternalLobby, playerId: string): GameLobby {
  const player = lobby.players.find((entry) => entry.id === playerId);
  return {
    id: lobby.id,
    code: lobby.code,
    name: lobby.name,
    mode: lobby.mode,
    hostId: lobby.hostId,
    hostName: lobby.hostName,
    players: lobby.players.map(({ id, name, username, avatar, alive }) => ({
      id,
      name,
      username,
      avatar,
      alive,
      ...(lobby.phase === "finished"
        ? { role: lobby.players.find((entry) => entry.id === id)?.role }
        : {}),
    })),
    maxPlayers: lobby.maxPlayers,
    phase: lobby.phase,
    round: lobby.round,
    winner: lobby.winner,
    events: lobby.events.slice(0, 8),
    ownRole: player?.role,
    mafiaTeammates:
      player?.role === "mafia"
        ? lobby.players
            .filter((entry) => entry.role === "mafia" && entry.id !== player.id && entry.alive)
            .map((entry) => entry.name)
        : undefined,
    ownActionDone:
      lobby.phase === "night"
        ? player?.role === "mafia"
          ? Boolean(lobby.nightActions.mafiaVotes[player.id])
          : player?.role === "doctor"
            ? Boolean(lobby.nightActions.doctorTarget)
            : player?.role === "detective"
              ? Boolean(lobby.nightActions.detectiveTarget)
              : true
        : lobby.phase === "day"
          ? Boolean(lobby.votes[playerId])
          : false,
    ownInvestigation: lobby.investigations[playerId] ?? null,
    lastUpdated: lobby.lastUpdated,
  };
}

export function getLobbyForPlayer(lobbyId: string, playerId: string) {
  const lobby = getLobby(lobbyId);
  if (!lobby) throw new Error("Xona topilmadi.");
  requirePlayer(lobby, playerId);
  return lobby;
}
