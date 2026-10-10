import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateTelegramInitData, resolveDisplayName } from "@/lib/telegram";
import { createSessionToken } from "@/lib/session";
import { upsertPlayer, toProfile } from "@/lib/db/repository";
import { isLanguage } from "@/lib/i18n";
import { SESSION_COOKIE } from "@/lib/api/auth";
import { clientKey, rateLimit } from "@/lib/api/rate-limit";
import { describeDbMisconfiguration } from "@/lib/db/client";

const requestSchema = z.object({
  initData: z.string().min(1).max(16_000),
  language: z.string().max(8).optional(),
});

const AUTH_LIMIT = 30;
const AUTH_WINDOW_MS = 60_000;

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || null;
}

/**
 * Log the environment state once per process so a misconfigured deployment is
 * obvious in the platform logs without having to reproduce it from a screenshot.
 */
const reportedConfig = (() => {
  const missing: string[] = [];
  if (!botToken()) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("SUPABASE_URL");
  }
  const dbProblem = describeDbMisconfiguration();
  if (missing.length === 0 && !dbProblem) return;

  console.warn(
    [
      "[startup] environment check",
      missing.length > 0 ? `  missing: ${missing.join(", ")}` : null,
      dbProblem ? `  ${dbProblem}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return true;
})();
void reportedConfig;

export async function POST(request: NextRequest) {
  const token = botToken();
  if (!token) {
    return NextResponse.json(
      { error: "Telegram bot token sozlanmagan. .env.local faylini tekshiring.", code: "not_configured" },
      { status: 503 },
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    return NextResponse.json(
      { error: "Server sessiya kaliti sozlanmagan.", code: "not_configured" },
      { status: 503 },
    );
  }

  // Fail loudly and specifically when the deployment is missing credentials.
  const misconfigured = describeDbMisconfiguration();
  if (misconfigured) {
    console.error(`[auth/telegram] ${misconfigured}`);
    return NextResponse.json(
      { error: "database_not_configured", code: "database_not_configured" },
      { status: 503 },
    );
  }

  // Brute-force / write-amplification guard: every accepted handshake writes to
  // the players table, so the endpoint is rate limited per client.
  const limit = rateLimit(`auth:${clientKey(request.headers)}`, AUTH_LIMIT, AUTH_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too_many_requests", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", code: "invalid" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", code: "invalid" }, { status: 400 });
  }

  // --- server-side verification (client identity is never trusted) ---------
  const auth = authenticateTelegramInitData(parsed.data.initData, token);
  if (!auth.ok) {
    const status = auth.reason === "invalid" ? 401 : 400;
    return NextResponse.json(
      {
        error: auth.reason === "invalid" ? "telegram_signature_invalid" : "telegram_user_invalid",
        code: auth.reason,
      },
      { status },
    );
  }

  const { user } = auth.data;
  const displayName = resolveDisplayName(user);
  const languageHint = isLanguage(parsed.data.language)
    ? parsed.data.language
    : isLanguage(user.language_code)
      ? user.language_code
      : "uz";

  try {
    const row = await upsertPlayer({
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName,
      photoUrl: user.photo_url,
      language: languageHint,
    });

    const session = createSessionToken({
      userId: row.id,
      username: row.username ?? "",
      displayName: row.display_name,
      avatar: row.photo_url ?? null,
    });

    const response = NextResponse.json({
      success: true,
      player: toProfile(row),
      startParam: auth.data.startParam ?? null,
    });
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("[auth/telegram] profile persistence failed:", reason);
    // The browser only ever sees a stable code; the detail stays in the logs.
    return NextResponse.json(
      { error: "profile_persist_failed", code: "database_unavailable" },
      { status: 503 },
    );
  }
}