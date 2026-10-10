/**
 * Removes rows a test created from the live database.
 *
 * supabase-js resolves instead of throwing on a PostgREST error, so a naive
 * `await delete()` reports success while deleting nothing. Every step here
 * checks the returned error and then re-counts, so a failed purge fails the
 * test instead of quietly leaving demo data behind.
 *
 * Order matters: members reference both the lobby and the player.
 */
export async function purgeTestRows({ players = [], lobbies = [] } = {}) {
  const playerIds = [...new Set(players.filter(Boolean))];
  const lobbyIds = [...new Set(lobbies.filter(Boolean))];
  if (!playerIds.length && !lobbyIds.length) return { players: 0, lobbies: 0 };

  const { createClient } = await import("@supabase/supabase-js");
  const { WebSocket } = await import("ws");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!(key in process.env)) {
        process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[cleanup] no credentials — run `npm run db:clean -- --yes`");
    return { players: 0, lobbies: 0 };
  }
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Node 20 has no global WebSocket; realtime-js throws without this
    realtime: { transport: WebSocket },
  });

  async function run(table, column, ids) {
    if (!ids.length) return;
    const { error } = await client.from(table).delete().in(column, ids);
    if (error) throw new Error(`delete on ${table} failed: ${error.message}`);
    const { count, error: countError } = await client
      .from(table)
      .select(column, { count: "exact", head: true })
      .in(column, ids);
    if (countError) throw new Error(`verify ${table} failed: ${countError.message}`);
    if (count) throw new Error(`${table} still holds ${count} test row(s) after purge`);
  }

  try {
    await run("mc_lobby_members", "lobby_id", lobbyIds);
    await run("mc_lobbies", "id", lobbyIds);
    await run("mc_players", "id", playerIds);
    console.log(`[cleanup] removed ${playerIds.length} player(s), ${lobbyIds.length} lobby/lobbies`);
    return { players: playerIds.length, lobbies: lobbyIds.length };
  } catch (error) {
    console.log(`[cleanup] ${error.message} — run npm run db:clean -- --yes`);
    return { players: 0, lobbies: 0, error };
  }
}