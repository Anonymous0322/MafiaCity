import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

/**
 * Supabase configuration is read from the environment only, never from the
 * browser bundle. `SUPABASE_KEY` is intentionally NOT prefixed with NEXT_PUBLIC_
 * so it can never leak into a client build.
 */

export type DbConfig = {
  url: string;
  key: string;
  /** true when a server-only secret key is available (bypasses RLS) */
  privileged: boolean;
};

let cachedConfig: DbConfig | null = null;

/**
 * Environment variables can be present but empty (a blank value pasted into a
 * dashboard field). `??` would accept `""` and break every lookup, so empty
 * values are treated as absent.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveDbConfig(): DbConfig | null {
  if (cachedConfig) return cachedConfig;
  const url = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
  const secret = env("SUPABASE_SERVICE_ROLE_KEY") ?? env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_DB_KEY");
  const key = secret ?? env("SUPABASE_KEY") ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = { url, key, privileged: Boolean(secret) };
  return cachedConfig;
}

const getDbConfig = resolveDbConfig;

export { getDbConfig };
export function isDatabaseConfigured(): boolean {
  return getDbConfig() !== null;
}

/** True only when a server-only secret key is present (bypasses RLS). */
export function hasServiceRoleKey(): boolean {
  return getDbConfig()?.privileged ?? false;
}

/**
 * Human-readable reason the database cannot be used, or `null` when it can.
 * Surfaced by /api/health and the auth handshake so a misconfigured deployment
 * says what to fix instead of showing an opaque error code.
 */
export function describeDbMisconfiguration(): string | null {
  const config = getDbConfig();
  if (!config) {
    return "SUPABASE_URL is not set on the server.";
  }
  if (!config.privileged) {
    return (
      "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so requests fall back to the " +
      "public anon key. Every table is protected by Row Level Security, so the anon key " +
      "is denied: permission denied for table mc_players. Add the service-role key to the " +
      "deployment environment and redeploy."
    );
  }
  return null;
}

/**
 * Node 20 has no global WebSocket, and @supabase/realtime-js throws from the
 * client *constructor* when it cannot find one — which made every server-side
 * call fail before it even reached the network. Handing it `ws` fixes that and
 * keeps the app working on the Node version the project pins.
 */
function serverRealtimeOptions() {
  return { transport: WebSocket as unknown as typeof globalThis.WebSocket };
}

let cachedClient: SupabaseClient | null = null;

/** Server-side Supabase client. Never import this from a Client Component. */
export function getSupabase(): SupabaseClient {
  const config = getDbConfig();
  if (!config) throw new DatabaseNotConfiguredError();
  if (cachedClient) return cachedClient;
  cachedClient = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "mafia-city" } },
    realtime: serverRealtimeOptions(),
  });
  return cachedClient;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    this.name = "DatabaseNotConfiguredError";
  }
}
