import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export function getDbConfig(): DbConfig | null {
  if (cachedConfig) return cachedConfig;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_DB_KEY;
  const key = secret ?? process.env.SUPABASE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = { url, key, privileged: Boolean(secret) };
  return cachedConfig;
}

export function isDatabaseConfigured(): boolean {
  return getDbConfig() !== null;
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
  });
  return cachedClient;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in .env.local");
    this.name = "DatabaseNotConfiguredError";
  }
}

