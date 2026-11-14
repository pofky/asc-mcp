/**
 * One number for "N tools": TOOL_NAMES.length. src/ strings import it; the
 * public docs are static text, so this test fails when they drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_COUNT, TOOL_NAMES } from "../src/tool-meta.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITING = readdirSync(join(ROOT, "site", "writing")).map((d) => `site/writing/${d}/index.html`);
const DOCS = [
  "README.md",
  "package.json",
  "scripts/build-mcpb.mjs",
  "site/llms.txt",
  "site/index.html",
  "license-worker/src/logic.ts",
  "license-worker/src/index.ts",
  ...WRITING,
];
const CLAIM = /\b(\d+) (?:tools|opinionated tools|job-shaped tools)\b|\b[Aa]ll (\d+) tools\b|\bof the (\d+) tools\b/g;

describe("tool count", () => {
  it("TOOL_COUNT is the registered set", () => {
    expect(TOOL_COUNT).toBe(TOOL_NAMES.length);
  });

  it.each(DOCS)("%s quotes the real count", (file) => {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      return; // a page that does not exist in this checkout makes no claim
    }
    for (const m of text.matchAll(CLAIM)) {
      // A competitor row ("... github.com/x/y ...: free, MIT, 890 tools") is not our count.
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      if (/github\.com\//.test(text.slice(lineStart, m.index))) continue;
      const n = Number(m[1] ?? m[2] ?? m[3]);
      // "6 tools" (the free set) and "N tools" for a subset are not the total.
      if (n < 20) continue;
      expect(n, `${file}: "${m[0]}"`).toBe(TOOL_COUNT);
    }
  });
});
