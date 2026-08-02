#!/usr/bin/env node
/**
 * Point every surface at a different Polar checkout link.
 *
 *   node scripts/set-checkout-url.mjs https://buy.polar.sh/polar_cl_NEW
 *
 * Moving the product to another Polar organization mints a new link while the
 * old one keeps working, so a missed copy quietly keeps selling into the old
 * org. This rewrites all of them at once and prints what it touched.
 *
 * It does not deploy. After running: npm run docs && npm test, then publish the
 * package, deploy the worker, and deploy the site.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file that embeds the link, code and content alike. */
const TARGETS = [
  "src/gate.ts",
  "license-worker/src/index.ts",
  "site/index.html",
  "site/llms.txt",
  "README.md",
  "skills/asc-review-triage/SKILL.md",
];

const next = process.argv[2];
if (!next || !/^https:\/\/buy\.polar\.sh\/\S+$/.test(next)) {
  console.error("Usage: node scripts/set-checkout-url.mjs https://buy.polar.sh/polar_cl_...");
  process.exit(1);
}

const CURRENT = /https:\/\/buy\.polar\.sh\/polar_cl_[A-Za-z0-9]+/g;

let total = 0;
for (const rel of TARGETS) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, "utf-8");
  const hits = before.match(CURRENT)?.length ?? 0;
  if (!hits) {
    console.log(`  -  ${rel} (no link found)`);
    continue;
  }
  writeFileSync(path, before.replace(CURRENT, next));
  console.log(`  ${String(hits).padStart(2)} ${rel}`);
  total += hits;
}

console.log(`\n${total} link(s) now point at ${next}`);
console.log("Next: npm run docs && npm test, then publish, wrangler deploy, pages deploy.");
