import { createSessionToken } from "@/lib/session";
import { parseTelegramInitData, verifyTelegramInitData } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({ initData: z.string().min(1).max(16_000) });

export async function POST(request: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "Telegram bot token sozlanmagan. .env.local faylini tekshiring." },
      { status: 503 },
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    return NextResponse.json(
      { error: "Server sessiya kaliti sozlanmagan." },
      { status: 503 },
    );
  }

  try {
    const body = requestSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Telegram ma’lumotlari noto‘g‘ri." }, { status: 400 });
    }
    const initData = body.data.initData;
    if (!verifyTelegramInitData(initData, botToken)) {
      return NextResponse.json({ error: "Telegram sessiyasi yaroqsiz yoki eskirgan." }, { status: 401 });
    }

    const params = parseTelegramInitData(initData);
    const user = params?.user ? JSON.parse(params.user) as {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    } : null;
    if (!user || !Number.isSafeInteger(user.id) || !user.id || !user.first_name) {
      return NextResponse.json({ error: "Telegram foydalanuvchisi aniqlanmadi." }, { status: 401 });
    }

    const session = {
      userId: String(user.id),
      username: user.username ?? "",
      displayName: [user.first_name, user.last_name].filter(Boolean).join(" "),
      avatar: user.photo_url ?? null,
    };
    const response = NextResponse.json({ success: true, session });
    response.cookies.set("session", createSessionToken(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (error) {
    console.error("Telegram authentication failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Telegram orqali kirishda xatolik yuz berdi." }, { status: 500 });
  }
}
