/** Cross-checks every className used in the app against globals.css. */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const css = fs.readFileSync(path.join(root, "app", "globals.css"), "utf8");

const cssClasses = new Set(
  [...css.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]),
);

const files = [];
for (const dir of ["app", "components"]) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, dir));
}

const IGNORED = new Set([
  // helpers that only appear inside template literals / expressions
  "is-active", "is-online", "is-offline", "is-me", "is-dead", "is-empty", "is-win",
  "is-loss", "is-top", "is-ally", "is-selected", "spin", "loadSpinner",
]);

const missing = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  // className="..." and className={`...`} both end up in one of these shapes
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const raw = `${match[1] ?? ""} ${match[2] ?? ""}`;
    for (const token of raw.split(/[\s'${}]+/)) {
      const name = token.trim();
      if (!name || /^[0-9]/.test(name) || IGNORED.has(name)) continue;
      if (cssClasses.has(name)) continue;
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(path.relative(root, file));
    }
  }
}

if (missing.size === 0) {
  console.log("every className in the app has a rule in globals.css");
} else {
  console.log(`${missing.size} class(es) used in the app but missing from globals.css:\n`);
  for (const [name, where] of missing) {
    console.log(`  .${name.padEnd(24)} used in ${[...where].join(", ")}`);
  }
}
