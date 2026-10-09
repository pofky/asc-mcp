#!/usr/bin/env node
/**
 * Keep `plugin/` in step with the things it copies.
 *
 * The plugin folder is what Anthropic's directory installs, and it may not
 * contain symlinks, so three of its files are copies of something that lives
 * elsewhere in this repo:
 *
 *   plugin/.claude-plugin/plugin.json   version + the exact npx pin, from package.json
 *   plugin/skills/                      from skills/
 *   plugin/LICENSE                      from LICENSE
 *
 * The directory blocks a launcher that is not pinned to an exact version, so
 * the pin has to move with every release: scripts/release.mjs runs this after
 * it sets the version. `--check` writes nothing and exits 1 on drift, which is
 * what the test suite runs.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const plugin = join(root, "plugin");
const manifestPath = join(plugin, ".claude-plugin", "plugin.json");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const drift = [];

// --- manifest: version and pin ----------------------------------------------

const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
manifest.version = pkg.version;
const server = manifest.mcpServers["asc-mcp"];
server.args = server.args.map((a) =>
  a.startsWith(`${pkg.name}@`) ? `${pkg.name}@${pkg.version}` : a,
);
if (!server.args.includes(`${pkg.name}@${pkg.version}`)) {
  console.error(`plugin.json: no "${pkg.name}@<version>" argument to pin`);
  process.exit(1);
}
const wantedManifest = JSON.stringify(manifest, null, 2) + "\n";
if (wantedManifest !== manifestText) {
  drift.push(relative(root, manifestPath));
  if (!check) writeFileSync(manifestPath, wantedManifest);
}

// --- copies -----------------------------------------------------------------

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path)];
  });
}

function sameTree(from, to) {
  const a = listFiles(from).sort();
  const b = listFiles(to).sort();
  return (
    a.length === b.length &&
    a.every((f, i) => f === b[i] && readFileSync(join(from, f)).equals(readFileSync(join(to, f))))
  );
}

const skillsFrom = join(root, "skills");
const skillsTo = join(plugin, "skills");
if (!sameTree(skillsFrom, skillsTo)) {
  drift.push("plugin/skills/");
  if (!check) {
    rmSync(skillsTo, { recursive: true, force: true });
    cpSync(skillsFrom, skillsTo, { recursive: true });
  }
}

const licenseFrom = join(root, "LICENSE");
const licenseTo = join(plugin, "LICENSE");
if (!existsSync(licenseTo) || !readFileSync(licenseFrom).equals(readFileSync(licenseTo))) {
  drift.push("plugin/LICENSE");
  if (!check) cpSync(licenseFrom, licenseTo);
}

// --- nothing else ------------------------------------------------------------

// Everything in plugin/ is installed on someone's machine and scanned by the
// directory, so a file nobody meant to ship is drift too. Never deleted here:
// a stray file is something a person put there.
const expected = (f) =>
  f === join(".claude-plugin", "plugin.json") ||
  f === "README.md" ||
  f === "LICENSE" ||
  f.startsWith("skills" + sep);
const strays = listFiles(plugin).filter((f) => !expected(f));
if (strays.length) {
  console.error(`plugin/ holds files that are not part of the plugin: ${strays.join(", ")}`);
  process.exit(1);
}

// --- report -----------------------------------------------------------------

if (!drift.length) {
  console.log(`plugin/ is in step with package.json ${pkg.version}`);
} else if (check) {
  console.error(`plugin/ is out of step: ${drift.join(", ")}\nRun: node scripts/sync-plugin.mjs`);
  process.exit(1);
} else {
  console.log(`plugin/ updated: ${drift.join(", ")}`);
}
