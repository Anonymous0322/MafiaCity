import { z } from "zod";
import {
  createLobby,
  getPlayerLobbies,
  joinLobby,
  leaveLobby,
  listPublicLobbies,
  presentLobby,
  startLobby,
  submitGameAction,
} from "@/lib/game-store";
import type { PlayerIdentity } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(32),
    mode: z.enum(["PUBLIC", "PRIVATE"]),
    maxPlayers: z.number().int().min(5).max(20),
  }),
  z.object({ action: z.literal("join"), code: z.string().trim().min(4).max(24) }),
  z.object({ action: z.literal("leave"), lobbyId: z.string().uuid() }),
  z.object({ action: z.literal("start"), lobbyId: z.string().uuid() }),
  z.object({
    action: z.enum(["night", "vote"]),
    lobbyId: z.string().uuid(),
    targetId: z.string().min(1),
  }),
]);

function getIdentity(request: NextRequest): PlayerIdentity | null {
  const session = verifySessionToken(request.cookies.get("session")?.value);
  if (session) {
    return {
      id: session.userId,
      name: session.displayName ?? "Telegram player",
      username: session.username ?? "",
      avatar: session.avatar ?? null,
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const identity = getIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Telegram orqali kirish kerak." }, { status: 401 });
  }
  const lobbies = listPublicLobbies().map((lobby) => presentLobby(lobby, identity.id));
  const current = getPlayerLobbies(identity.id).map((lobby) => presentLobby(lobby, identity.id));
  return NextResponse.json({ lobbies, current });
}

export async function POST(request: NextRequest) {
  const identity = getIdentity(request);
  if (!identity) {
    return NextResponse.json({ error: "Telegram orqali kirish kerak." }, { status: 401 });
  }

  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "So‘rov ma’lumotlari noto‘g‘ri." }, { status: 400 });
    }
    const input = parsed.data;
    let lobby;
    if (input.action === "create") {
      lobby = createLobby(identity, input);
    } else if (input.action === "join") {
      lobby = joinLobby(identity, input.code);
    } else if (input.action === "leave") {
      leaveLobby(input.lobbyId, identity.id);
      return NextResponse.json({ success: true });
    } else if (input.action === "start") {
      lobby = startLobby(input.lobbyId, identity.id);
    } else {
      lobby = submitGameAction(input.lobbyId, identity.id, input.action, input.targetId);
    }
    return NextResponse.json({ success: true, lobby: presentLobby(lobby, identity.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Amal bajarilmadi." },
      { status: 409 },
    );
  }
}

export async function DELETE() {
  return NextResponse.json({ error: "Bu amal mavjud emas." }, { status: 405 });
}
