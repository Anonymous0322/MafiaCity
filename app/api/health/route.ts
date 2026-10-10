import { NextResponse } from "next/server";
import { checkDatabase, isDatabaseConfigured } from "@/lib/db/repository";
import { describeDbMisconfiguration } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Liveness + real readiness. Unlike a stub this actually touches the
 * database, so a platform health check fails when persistence is broken —
 * and it names the exact environment variable that is missing.
 */
export async function GET() {
  const misconfiguration = describeDbMisconfiguration();
  const db = isDatabaseConfigured() ? await checkDatabase() : null;
  const healthy = Boolean(db?.reachable && db.tablesReady);

  return NextResponse.json(
    {
      ok: healthy,
      service: "mafia-city",
      status: healthy
        ? db?.privileged
          ? "healthy"
          : "healthy_without_service_role_key"
        : "degraded",
      misconfiguration,
      database: db ?? { configured: false, reachable: false, tablesReady: false, privileged: false },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
