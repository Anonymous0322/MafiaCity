/**
 * Checks a live deployment and says exactly what is missing.
 *
 *   npm run check:deploy
 *   npm run check:deploy -- https://your-app.vercel.app
 */
const base = (process.argv[2] ?? process.env.WEBAPP_URL ?? "").replace(/\/$/, "");

if (!base) {
  console.error("[check:deploy] pass a URL, e.g. npm run check:deploy -- https://app.vercel.app");
  process.exit(1);
}

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

async function main() {
  console.log(`[check:deploy] ${base}\n`);

  let health;
  try {
    const response = await fetch(`${base}/api/health`, { cache: "no-store" });
    health = { status: response.status, body: await response.json() };
  } catch (error) {
    console.log(`${RED}✗ the site is not reachable: ${error.message}${OFF}`);
    process.exit(1);
  }

  const body = health.body ?? {};
  const db = body.database ?? {};

  console.log(`${DIM}HTTP ${health.status}${OFF}`);
  console.log(`status        : ${body.status}`);
  console.log(`ok            : ${body.ok}`);
  console.log(`db configured : ${db.configured}`);
  console.log(`db reachable  : ${db.reachable}`);
  console.log(`tables ready  : ${db.tablesReady}`);
  console.log(`service role  : ${db.privileged}`);
  if (db.detail) console.log(`detail        : ${db.detail}`);

  if (body.misconfiguration) {
    console.log(`\n${RED}✗ ${body.misconfiguration}${OFF}`);
  }

  console.log("");
  let problems = 0;

  if (!db.privileged) {
    problems += 1;
    console.log(
      `${RED}✗ SUPABASE_SERVICE_ROLE_KEY is not set on the server${OFF}\n` +
        `  .env.local only configures your computer. The live site reads Vercel's\n` +
        `  own environment, so the key must be added there too:\n\n` +
        `    Vercel -> <project> -> Settings -> Environment Variables\n` +
        `      Name : SUPABASE_SERVICE_ROLE_KEY\n` +
        `      Value: the service_role key (Supabase -> Project Settings -> API Keys)\n` +
        `      Tick : Production${OFF}\n\n` +
        `  Then redeploy: Deployments -> (⋯) -> Redeploy\n\n` +
        `  Or let the script do it:  npm run deploy:env\n`,
    );
  }

  const deniedByRls = /permission denied/i.test(String(db.detail ?? ""));

  if (deniedByRls) {
    // The schema is fine; the anon key simply cannot read it. Saying
    // "run db:migrate" here would send the user chasing a problem that
    // does not exist.
    console.log(
      `${DIM}  The mc_* tables exist and are correct — this is an access problem,\n` +
        `  not a missing schema. Do not re-run db:migrate.${OFF}`,
    );
  }

  if (!db.tablesReady && !deniedByRls) {
    problems += 1;
    console.log(
      `${RED}✗ the mc_* tables are not reachable${OFF}\n` +
        `  Apply the schema once:  npm run db:migrate  then  npm run db:check\n`,
    );
  }

  if (!db.reachable && !deniedByRls) {
    problems += 1;
    console.log(`${RED}✗ the database is not reachable from the server${OFF}\n`);
  }

  if (problems === 0) {
    console.log(`${GREEN}✓ deployment is healthy — the app should work${OFF}`);
    console.log(`${DIM}  Open the Mini App from Telegram to confirm.${OFF}`);
  }

  process.exit(problems === 0 ? 0 : 1);
}

await main();
