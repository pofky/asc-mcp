/**
 * The version string and the trademark disclaimer are hand-copied into every
 * HTML file under site/, and twice now a release has updated one file and left
 * another a version behind. An SEO audit caught it the second time; this catches
 * it the next time, before a deploy rather than after.
 *
 * Run from the repo root: node scripts/check-site-strings.mjs
 * Exits non-zero and names the file and line on any drift.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const DISCLAIMER =
  "Not affiliated with, endorsed by or sponsored by Apple Inc. Apple, App Store, " +
  "App Store Connect, TestFlight, Xcode and iOS are trademarks of Apple Inc.";

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return path.endsWith(".html") ? [path] : [];
  });
}

const problems = [];
for (const file of htmlFiles("site")) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Any asc-mcp version mentioned in a page must be the one being shipped.
    for (const m of line.matchAll(/v?(\d+\.\d+\.\d+)/g)) {
      if (m[1] !== version && /ver">v|asc-mcp v|softwareVersion/.test(line)) {
        problems.push(`${file}:${i + 1} says ${m[1]}, package.json says ${version}`);
      }
    }
  });
  const text = lines.join("\n");
  if (/trademarks of Apple/.test(text) && !text.includes(DISCLAIMER)) {
    problems.push(`${file} carries a trademark line that is not the current wording`);
  }
}

if (problems.length) {
  console.error("Site string drift:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`site strings agree with package.json (${version})`);
