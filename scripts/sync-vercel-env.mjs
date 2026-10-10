/**
 * Pushes the required server secrets from .env.local to a Vercel project.
 *
 *   VERCEL_TOKEN=… npm run deploy:env
 *
 * Why this exists: .env.local only configures *this machine*. A Vercel
 * deployment reads its own environment, so a key added to .env.local has no
 * effect on the live site until it is also present in Vercel and the project
 * is redeployed. This removes the copy-paste step.
 *
 * Secrets are read from .env.local and sent straight to the Vercel API. They
 * are never printed, never written to a file, and never passed on a command
 * line.
 *
 * Create a token at: Vercel -> Account Settings -> Tokens
 * Find the project id in: Vercel -> your project -> Settings -> General
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The variables the server genuinely needs. NEXT_PUBLIC_* stay in the repo. */
const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "SESSION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME",
  "DATABASE_URL",
];

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
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
    values[key] = value;
  }
  return values;
}

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error(
    "\n[deploy:env] VERCEL_TOKEN is not set.\n\n" +
      "  1. Vercel -> Account Settings -> Tokens -> Create Token (scope: your teams)\n" +
      "  2. In PowerShell:\n" +
      "       $env:VERCEL_TOKEN = \"your_token\"\n" +
      "  3. Re-run:  npm run deploy:env\n",
  );
  process.exit(1);
}

const local = readEnvFile(path.join(root, ".env.local"));
const projectId =
  process.env.VERCEL_PROJECT_ID ??
  process.argv.find((arg) => arg.startsWith("prj_"))?.slice(4);

if (!projectId) {
  console.error(
    "\n[deploy:env] VERCEL_PROJECT_ID is not set.\n\n" +
      "  Vercel -> your project -> Settings -> General -> Project ID\n" +
      "  then:  $env:VERCEL_PROJECT_ID = \"prj_…\"\n",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const existing = await api(`/v9/projects/${projectId}/env`);
if (existing.status !== 200) {
  console.error(`[deploy:env] cannot read the project env (HTTP ${existing.status})`);
  console.error("  check that the token has access to this project");
  process.exit(1);
}

const byKey = new Map((existing.body?.envs ?? []).map((entry) => [entry.key, entry]));
console.log(`[deploy:env] project ${projectId} has ${byKey.size} variable(s) today\n`);

let created = 0;
let updated = 0;
let skipped = 0;

for (const key of REQUIRED) {
  const value = local[key];
  if (!value) {
    console.log(`  skip    ${key.padEnd(32)} not present in .env.local`);
    continue;
  }

  const current = byKey.get(key);
  if (!current) {
    // production + preview so both the site and preview builds work
    for (const target of ["production", "preview"]) {
      const created1 = await api(`/v10/projects/${projectId}/env`, {
        method: "POST",
        body: JSON.stringify({ key, value, type: "plain", target }),
      });
      if (created1.status >= 400) {
        console.log(`  ERROR   ${key} [${target}] HTTP ${created1.status} ${created1.body?.error?.message ?? ""}`);
      }
    }
    created += 1;
    console.log(`  add     ${key.padEnd(32)} (production + preview)`);
    continue;
  }

  // The API never returns a stored value, so only overwrite when asked.
  if (process.argv.includes("--force")) {
    for (const target of current.target ?? ["production", "preview"]) {
      await api(`/v9/projects/${projectId}/env/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ value, target: [target] }),
      });
    }
    updated += 1;
    console.log(`  update  ${key.padEnd(32)} (forced)`);
    continue;
  }

  skipped += 1;
  console.log(
    `  exists  ${key.padEnd(32)} targets=${(current.target ?? []).join(",") || "production"}` +
      (current.value ? " (encrypted)" : ""),
  );
}

console.log(`\n[deploy:env] ${created} added, ${updated} updated, ${skipped} left untouched.`);
if (skipped > 0) {
  console.log("  re-run with --force to overwrite the existing values from .env.local");
}

console.log("\n[deploy:env] Environment changes only apply to a NEW deployment.");
console.log("  Vercel -> Deployments -> (⋯) -> Redeploy");
console.log("  then: npm run check:deploy\n");
