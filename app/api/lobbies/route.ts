import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requirePlayerId } from "@/lib/api/auth";
import {
  AppError,
  createLobby,
  enforcePhaseDeadline,
  getActiveLobbyForPlayer,
  getLobbyById,
  joinLobby,
  leaveLobby,
  listOpenLobbies,
  MAX_PLAYERS,
  MIN_PLAYERS,
  presentLobby,
  presentLobbySummaries,
  startLobbyGame,
  submitGameAction,
  touchPresence,
} from "@/lib/db/repository";
import { publishLobbyChange } from "@/lib/game/realtime";
import type { LobbyMode } from "@/lib/types";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(32),
    mode: z.enum(["PUBLIC", "PRIVATE"]),
    maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS),
  }),
  z.object({ action: z.literal("join"), reference: z.string().trim().min(3).max(40) }),
  z.object({ action: z.literal("leave"), lobbyId: z.string().uuid() }),
  z.object({ action: z.literal("start"), lobbyId: z.string().uuid() }),
  z.object({
    action: z.enum(["night", "vote"]),
    lobbyId: z.string().uuid(),
    targetId: z.string().uuid(),
  }),
]);

export const dynamic = "force-dynamic";

/**
 * GET /api/lobbies
 *   ?current=1  -> { lobby: LobbyView } for the lobby the player sits in
 *   ?id=<uuid>  -> { lobby: LobbyView } for one lobby
 *   ?since=<v>  -> 304 when nothing changed (cheap polling)
 *   default     -> { lobbies: LobbySummary[], current: LobbySummary|null }
 */
export async function GET(request: NextRequest) {
  try {
    const playerId = await requirePlayerId(request);
    await touchPresence(playerId);

    const params = request.nextUrl.searchParams;
    const lobbyId = params.get("id");

    if (lobbyId) {
      const lobby = await getLobbyById(lobbyId);
      if (!lobby) throw new AppError("not_found", "lobby_not_found", 404);
      // A phase that has outlived its window is force-resolved on read, so an
      // abandoned table always makes progress.
      await enforcePhaseDeadline(lobby);
      const current = (await getLobbyById(lobbyId)) ?? lobby;
      const view = await presentLobby(current, playerId);
      const since = Number(params.get("since"));
      if (Number.isFinite(since) && since === view.version) {
        return new NextResponse(null, { status: 304 });
      }
      return NextResponse.json({ lobby: view, serverTime: Date.now() });
    }

    if (params.get("current")) {
      const active = await getActiveLobbyForPlayer(playerId);
      if (!active) return NextResponse.json({ lobby: null });
      await enforcePhaseDeadline(active);
      const current = (await getLobbyById(active.id)) ?? active;
      return NextResponse.json({ lobby: await presentLobby(current, playerId) });
    }

    const [open, current] = await Promise.all([
      listOpenLobbies(),
      getActiveLobbyForPlayer(playerId),
    ]);
    const [summaries, currentSummary] = await Promise.all([
      presentLobbySummaries(open),
      current ? presentLobbySummaries([current]) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      lobbies: summaries,
      current: currentSummary[0] ?? null,
      serverTime: Date.now(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let playerId: string;
  try {
    playerId = await requirePlayerId(request);
  } catch (error) {
    return errorResponse(error);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", code: "invalid" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", code: "invalid" }, { status: 400 });
  }
  const input = parsed.data;

  try {
    await touchPresence(playerId);

    switch (input.action) {
      case "create": {
        // one live lobby per player
        const active = await getActiveLobbyForPlayer(playerId);
        if (active) {
          throw new AppError("conflict", "player_in_other_lobby", 409);
        }
        const lobby = await createLobby({
          hostId: playerId,
          name: input.name,
          mode: input.mode as LobbyMode,
          maxPlayers: input.maxPlayers,
        });
        await joinLobby(lobby.id, playerId);
        const created = (await getLobbyById(lobby.id))!;
        const view = await presentLobby(created, playerId);
        void publishLobbyChange(created.id, view.version, "created");
        return NextResponse.json({ success: true, lobby: view }, { status: 201 });
      }
      case "join": {
        const lobby = await joinLobby(input.reference, playerId);
        const view = await presentLobby(lobby, playerId);
        void publishLobbyChange(lobby.id, view.version, "joined");
        return NextResponse.json({ success: true, lobby: view });
      }
      case "leave": {
        const before = await getLobbyById(input.lobbyId);
        await leaveLobby(input.lobbyId, playerId);
        if (before) void publishLobbyChange(before.id, Date.now(), "left");
        return NextResponse.json({ success: true });
      }
      case "start": {
        const lobby = await startLobbyGame(input.lobbyId, playerId);
        const view = await presentLobby(lobby, playerId);
        void publishLobbyChange(lobby.id, view.version, "started");
        return NextResponse.json({ success: true, lobby: view });
      }
      default: {
        const view = await submitGameAction(input.lobbyId, playerId, {
          action: input.action,
          targetId: input.targetId,
        });
        void publishLobbyChange(view.id, view.version, input.action);
        return NextResponse.json({ success: true, lobby: view });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
