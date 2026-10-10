/**
 * Applies every SQL file in supabase/migrations to the target Postgres database.
 *
 *   npm run db:migrate
 *
 * Connection resolution order:
 *   1. DATABASE_URL                        (full connection string)
 *   2. SUPABASE_DB_PASSWORD                + SUPABASE_URL -> host/db.<ref>.supabase.co
 *   3. SUPABASE_DB_URL                     (explicit host form)
 *
 * Nothing is printed except migration names and success/failure, never credentials.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, source: "DATABASE_URL" };
  if (process.env.SUPABASE_DB_URL) {
    return { url: process.env.SUPABASE_DB_URL, source: "SUPABASE_DB_URL" };
  }
  const password = process.env.SUPABASE_DB_PASSWORD;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    const encoded = encodeURIComponent(password);
    return {
      url: `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`,
      source: "SUPABASE_DB_PASSWORD",
    };
  }
  return null;
}

const connection = resolveConnectionString();
if (!connection) {
  console.error(
    "\n[db:migrate] No database connection configured.\n" +
      "Set one of:\n" +
      "  DATABASE_URL=postgresql://user:pass@host:5432/postgres\n" +
      "  SUPABASE_DB_PASSWORD=<project db password>   (with SUPABASE_URL already set)\n" +
      "  SUPABASE_DB_URL=postgresql://...\n",
  );
  process.exit(1);
}

const migrationsDir = path.join(root, "supabase", "migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("[db:migrate] No migrations found.");
  process.exit(0);
}

const client = new Client({
  connectionString: connection.url,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`[db:migrate] connected via ${connection.source}`);

  await client.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query("select name from public.schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[db:migrate] = ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`[db:migrate] > ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`[db:migrate]   applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  console.log("[db:migrate] done");
  process.exit(0);
} catch (error) {
  console.error("[db:migrate] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
