import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePlayerId } from "@/lib/api/auth";
import { getMatchHistory, getPlayerById, getStats, toProfile } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/** GET /api/profile — identity, aggregate statistics and recent matches. */
export async function GET(request: NextRequest) {
  try {
    const playerId = await requirePlayerId(request);
    const [player, stats, history] = await Promise.all([
      getPlayerById(playerId),
      getStats(playerId),
      getMatchHistory(playerId, 15),
    ]);
    if (!player) {
      return NextResponse.json({ error: "player_not_found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ profile: toProfile(player), stats, history });
  } catch (error) {
    return errorResponse(error);
  }
}
