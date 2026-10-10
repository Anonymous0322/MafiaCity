import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, type SessionPayload } from "@/lib/session";
import { AppError } from "@/lib/db/repository";

export const SESSION_COOKIE = "session";

/**
 * Resolves the signed, HttpOnly session cookie to a session payload.
 * The cookie payload is only used to *locate* the player row; all profile
 * data served to clients comes from the database.
 */
export function readSession(request: NextRequest): SessionPayload | null {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function requirePlayerId(request: NextRequest): Promise<string> {
  const session = readSession(request);
  if (!session?.userId) {
    throw new AppError("unauthorized", "unauthorized", 401);
  }
  return session.userId;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error) {
    console.error("[api] unexpected failure:", error.message);
  }
  return NextResponse.json({ error: "internal_error", code: "unknown" }, { status: 500 });
}
