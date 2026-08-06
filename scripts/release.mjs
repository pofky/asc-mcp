#!/usr/bin/env node
/**
 * Cut a release end to end, from this machine, verifying every surface after it
 * is written.
 *
 * Deliberately does NOT depend on GitHub Actions. The registry publish used to
 * run only from a tag-triggered workflow, and on 6 August 2026 that workflow
 * failed before reaching our code ("Failed to resolve action download info,
 * Service Unavailable"), leaving npm at 1.9.1 and the registry at 1.9.0. A
 * release that can half-land is a release that will half-land. The workflow
 * still exists as a backstop, and publishing twice is harmless because the
 * registry rejects a version it already has.
 *
 * Usage: npm run release -- 1.9.2
 *        npm run release -- 1.9.2 --dry
 *
 * Prerequisites, both one-time:
 *   brew install mcp-publisher && mcp-publisher login github
 *   npm login && gh auth login
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

if (!version) {
  console.error("Usage: npm run release -- <version> [--dry]\nExample: npm run release -- 1.9.2");
  process.exit(1);
}

const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}`);
  if (dry && opts.mutating) {
    console.log("  (dry run, skipped)");
    return "";
  }
  return execFileSync(cmd, cmdArgs, { cwd: root, stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" });
};

const fail = (msg) => {
  console.error(`\nRELEASE ABORTED: ${msg}`);
  process.exit(1);
};

// --- preflight, before anything is written anywhere -------------------------

if (execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim() && !dry) {
  fail("working tree is dirty. Commit or stash first, so the tag points at what was tested.");
}
const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf8" }).trim();
if (branch !== "master") fail(`on branch ${branch}, expected master.`);

for (const [tool, probe] of [
  ["npm", ["whoami"]],
  ["gh", ["auth", "status"]],
  ["mcp-publisher", ["--version"]],
]) {
  try {
    execFileSync(tool, probe, { stdio: "ignore" });
  } catch {
    fail(`${tool} is not available or not authenticated. See the prerequisites in scripts/release.mjs.`);
  }
}

/**
 * Seconds of life left in the registry token, or 0 if there is no usable one.
 *
 * v1.9.2 published to npm and cut a GitHub release before `mcp-publisher
 * publish` failed with "Invalid or expired Registry JWT token", and the Actions
 * backstop happened to be down with Service Unavailable at the same moment. npm
 * was live at 1.9.2 while the registry, which every downstream directory
 * mirrors, sat at 1.9.1.
 *
 * The token turned out to last about five minutes, which is shorter than the
 * test and bundle gates take. So checking it once at startup proves nothing by
 * the time it is needed: it is checked again immediately before the irreversible
 * steps, and the login is offered there, at the only moment it is useful.
 */
const tokenPath = join(process.env.HOME ?? "", ".mcp_publisher_token");
function registryTokenSecondsLeft() {
  if (!existsSync(tokenPath)) return 0;
  try {
    const raw = JSON.parse(readFileSync(tokenPath, "utf8"));
    const jwt = raw.token ?? raw.access_token ?? "";
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64").toString("utf8"));
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

// --- version, in both files that carry it -----------------------------------

for (const file of ["package.json", "server.json"]) {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  if (json.packages) json.packages[0].version = version;
  if (!dry) writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}
console.log(`\nVersion set to ${version} in package.json and server.json`);

// --- gates ------------------------------------------------------------------

run("npm", ["run", "lint"]);
run("npm", ["test"]);
run("npm", ["run", "docs"]);
run("npm", ["run", "mcpb"]);

const bundle = join(root, "build", `asc-mcp-${version}.mcpb`);
if (!dry && !existsSync(bundle)) fail(`bundle was not produced at ${bundle}`);

// The version-drift bug of 1.8.6 shipped a server that announced the previous
// version to every client handshake, so the handshake is checked, not assumed.
if (!dry) {
  const handshake = execSync(
    `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}' | ASC_KEY_ID=x ASC_ISSUER_ID=x ASC_PRIVATE_KEY_PATH=/dev/null node dist/index.js 2>/dev/null | head -1`,
    { cwd: root, encoding: "utf8", shell: "/bin/bash" },
  );
  const reported = JSON.parse(handshake).result.serverInfo.version;
  if (reported !== version) fail(`server handshake reports ${reported}, expected ${version}`);
  console.log(`\nHandshake reports ${reported}`);
}

// --- publish ----------------------------------------------------------------

// Last honest moment to check. Everything below this line is irreversible, and
// the registry publish is at the end of it, so a token that is about to expire
// gets refreshed here rather than discovered three commands too late.
if (!dry) {
  let left = registryTokenSecondsLeft();
  if (left < 120) {
    console.log(
      `\nRegistry token has ${left}s left, which will not survive the publish sequence.` +
        "\nStarting the device login now. Approve it, and the release continues automatically.\n",
    );
    execFileSync("mcp-publisher", ["login", "github"], { cwd: root, stdio: "inherit" });
    left = registryTokenSecondsLeft();
    if (left < 120) fail("registry token is still not usable after login.");
  }
  console.log(`\nRegistry token good for ${left}s. Publishing.`);
}

run("git", ["add", "-A"], { mutating: true });
run("git", ["commit", "-m", `release: v${version}`], { mutating: true });
run("git", ["tag", "-a", `v${version}`, "-m", `v${version}`], { mutating: true });
run("git", ["push", "origin", "master"], { mutating: true });
run("git", ["push", "origin", `v${version}`], { mutating: true });

run("npm", ["publish", "--access", "public"], { mutating: true });

/**
 * Release notes are written by hand, into RELEASE_NOTES.md, and the release
 * refuses to proceed without them.
 *
 * v1.9.2 shipped with `--generate-notes`, which produced a body consisting
 * entirely of a compare link. Anyone landing on the release page to download the
 * bundle, which is now the primary install path for Claude Desktop, was told
 * nothing about what they were installing or whether they needed it.
 */
const notesPath = join(root, "RELEASE_NOTES.md");
if (!existsSync(notesPath)) {
  fail(
    "RELEASE_NOTES.md is missing. Write the notes for this version first: what changed, and whether an existing user needs it.",
  );
}
const notes = readFileSync(notesPath, "utf8").trim();
if (notes.length < 120) fail("RELEASE_NOTES.md is too short to be useful. Say what changed and who needs it.");
const title = notes.split("\n")[0].replace(/^#+\s*/, "").trim();
const body = notes.split("\n").slice(1).join("\n").trim();

run("gh", ["release", "create", `v${version}`, bundle, "--title", title, "--notes", body], {
  mutating: true,
});
// Local publish, not the workflow. See the header.
run("mcp-publisher", ["publish"], { mutating: true });

// --- verify every surface ---------------------------------------------------

if (dry) {
  console.log("\nDry run complete. Nothing was published.");
  process.exit(0);
}

const checks = [];
const npmVersion = execFileSync("npm", ["view", "@pofky/asc-mcp", "version"], { encoding: "utf8" }).trim();
checks.push(["npm", npmVersion === version, npmVersion]);

const assets = JSON.parse(
  execFileSync("gh", ["release", "view", `v${version}`, "--json", "assets"], { encoding: "utf8" }),
).assets;
checks.push(["release asset", assets.some((a) => a.name.endsWith(".mcpb")), assets.map((a) => a.name).join(",")]);

const registry = JSON.parse(
  execSync(
    `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.pofky/asc-mcp"`,
    { encoding: "utf8" },
  ),
);
const latest = registry.servers
  .filter((s) => s.server.name.includes("pofky"))
  .find((s) => s._meta["io.modelcontextprotocol.registry/official"].isLatest);
checks.push(["registry", latest?.server.version === version, latest?.server.version ?? "none"]);

console.log("\n--- release verification ---");
let ok = true;
for (const [name, pass, actual] of checks) {
  console.log(`${pass ? "OK  " : "FAIL"} ${name}: ${actual}`);
  if (!pass) ok = false;
}
if (!ok) {
  console.error(
    "\nOne or more surfaces did not update. This is the half-landed release the script exists to catch: fix the failing one before announcing.",
  );
  process.exit(1);
}
console.log(`\nv${version} is live on npm, the GitHub release and the MCP registry.`);
