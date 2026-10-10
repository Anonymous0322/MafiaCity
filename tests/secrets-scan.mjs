/**
 * Scans everything that would be committed for credential patterns.
 *
 *   node tests/secrets-scan.mjs
 *
 * Also asserts that the local `.env*` files are properly git-ignored, so a
 * future `git add -A` cannot publish a real credential.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ALLOW = new Set([".env.example"]);

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const committed = git(["ls-files", "--cached", "--others", "--exclude-standard"]);
const localEnvFiles = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--", ".env*"]);

/** Values that are obviously placeholders rather than live credentials. */
const PLACEHOLDER = /(\$\{|\{\{|your[_-]|example|placeholder|xxxx|<|changeme|process\.env|process\.env\b)/i;

const PATTERNS = [
  { name: "Telegram bot token", regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/ },
  { name: "Supabase secret key", regex: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase service JWT", regex: /\beyJ[A-Za-z0-9_-]{60,}\./ },
  { name: "Postgres URL with password", regex: /postgres(?:ql)?:\/\/[^:/\s]+:[^@\s]+@/ },
  { name: "Long secret assignment", regex: /^[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*\S{32,}\s*$/m },
];

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|css|html|txt)$/i;

let leaks = 0;
const scanned = committed.filter((file) => TEXT.test(file) && !ALLOW.has(file));

for (const file of scanned) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, "utf8");
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(content);
    if (!match) continue;
    if (PLACEHOLDER.test(match[0])) continue;
    console.error(`  LEAK  ${name} in ${file}`);
    console.error(`        ${match[0].slice(0, 40)}…`);
    leaks += 1;
  }
}

// .env.example is documentation: it must exist and must not hold real values
const examplePath = path.join(root, ".env.example");
if (fs.existsSync(examplePath)) {
  const example = fs.readFileSync(examplePath, "utf8");
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(example);
    if (match && !PLACEHOLDER.test(match[0])) {
      console.error(`  LEAK  ${name} in .env.example`);
      leaks += 1;
    }
  }
}

let problems = 0;
console.log(`[secrets] scanned ${scanned.length} commit-eligible file(s)`);
if (localEnvFiles.length === 0) {
  if (fs.existsSync(path.join(root, ".env.local"))) {
    console.error("  LEAK  .env.local exists but is not git-ignored");
    problems += 1;
  }
} else {
  console.log(`[secrets] git-ignored local env file(s): ${localEnvFiles.join(", ")}`);
}

console.log(
  leaks === 0 && problems === 0
    ? "[secrets] PASS — no credentials in commit-eligible files"
    : `[secrets] FAIL — ${leaks} leak(s), ${problems} hygiene problem(s)`,
);
process.exit(leaks === 0 && problems === 0 ? 0 : 1);
