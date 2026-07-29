#!/usr/bin/env node
/**
 * Generate USER_GUIDE.md and LIMITATIONS.md from the single source of truth in
 * src/tools/guide.ts (compiled to dist). Keeps docs and the in-MCP `asc_guide`
 * tool from drifting. Run: npm run build && node scripts/gen-docs.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FLOWS, renderFlow, renderOverview, renderLimitations } from "../dist/tools/guide.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = "<!-- GENERATED from src/tools/guide.ts by scripts/gen-docs.mjs. Do not edit by hand. -->\n\n";

const order = ["setup", "first-app", "update", "screenshots", "iap", "subscriptions", "reviews", "testflight", "binary"];

const userGuide =
  stamp +
  renderOverview() +
  "\n\n---\n\n" +
  order.map((t) => renderFlow(FLOWS[t])).join("\n---\n\n");

writeFileSync(join(root, "USER_GUIDE.md"), userGuide.trimEnd() + "\n");
writeFileSync(join(root, "LIMITATIONS.md"), stamp + renderLimitations().trimEnd() + "\n");

console.log("Wrote USER_GUIDE.md and LIMITATIONS.md");
