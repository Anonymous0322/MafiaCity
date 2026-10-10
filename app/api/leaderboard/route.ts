import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePlayerId } from "@/lib/api/auth";
import { getLeaderboard } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * GET /api/leaderboard?page=1
 * Rankings are computed by Postgres (`leaderboard` / `leaderboard_rank`); the
 * client cannot influence its own position because no client input reaches
 * the ordering expression.
 */
export async function GET(request: NextRequest) {
  try {
    const playerId = await requirePlayerId(request);
    const rawPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const view = await getLeaderboard({ page, pageSize: PAGE_SIZE, viewerId: playerId });
    return NextResponse.json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
