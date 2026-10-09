import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "mafia-city",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
}
