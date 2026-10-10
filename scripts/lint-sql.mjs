/**
 * Parses every migration with the real PostgreSQL grammar (libpg_query via
 * WASM) so a syntax error is caught here instead of on the live database.
 *
 *   npm run db:lint
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "pgsql-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

let failed = 0;

// sanity check: the parser must actually reject broken SQL
try {
  await parse("selct 1 from;");
  console.error("FAIL  parser self-test — broken SQL was accepted, parser unusable");
  process.exit(1);
} catch {
  console.log("PASS  parser self-test — invalid SQL is correctly rejected");
}

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  try {
    const result = await parse(sql);
    const statements =
      result?.parse_tree?.stmts ?? result?.stmts ?? result?.parse_tree?.statements ?? [];
    const count = Array.isArray(statements) ? statements.length : "unknown";
    console.log(`PASS  ${file} — ${count} statement(s), ${sql.split("\n").length} lines`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${file}`);
    const details = error?.sqlDetails ?? {};
    console.error(`      ${error?.message ?? String(error)}`);
    if (details.cursorPosition !== undefined) {
      const cursor = details.cursorPosition;
      console.error(
        `      near: ${sql.slice(Math.max(0, cursor - 60), cursor + 60).replace(/\s+/g, " ")}`,
      );
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
