import { NextResponse } from "next/server";
import { checkDatabase, isDatabaseConfigured } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/**
 * Liveness + real readiness. Unlike the previous stub this actually touches
 * the database, so a platform health check fails when persistence is broken.
 */
export async function GET() {
  const db = isDatabaseConfigured() ? await checkDatabase() : null;
  const healthy = Boolean(db?.reachable && db.tablesReady);

  return NextResponse.json(
    {
      ok: healthy,
      service: "mafia-city",
      status: healthy ? (db?.privileged ? "healthy" : "healthy_readonly_key") : "degraded",
      database: db ?? { configured: false, reachable: false, tablesReady: false, privileged: false },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
