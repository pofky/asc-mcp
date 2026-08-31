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
/**
 * Which route will publish to the registry.
 *
 * Never launch `mcp-publisher login` from here. It blocks on a device-code
 * approval in a browser, and run non-interactively that wait never ends: the
 * release hangs holding a dirty tree with the version already bumped, which is
 * exactly what happened cutting 1.9.3 the first time.
 *
 * A stale token is not a reason to abandon the release, because the tag also
 * triggers a workflow that publishes via OIDC and needs no local token. So the
 * local token is used when it is healthy, and the workflow is waited on and
 * verified when it is not. Either way the registry is checked at the end, so a
 * half-landed release still fails loudly.
 */
const registryRoute = dry
  ? "dry"
  : registryTokenSecondsLeft() >= 120
    ? "local"
    : "workflow";
if (!dry) {
  console.log(
    registryRoute === "local"
      ? `\nRegistry: publishing locally, token good for ${registryTokenSecondsLeft()}s.`
      : "\nRegistry: local token is stale, so the tag-triggered workflow will publish it." +
        "\nFor a faster, more reliable release next time: mcp-publisher login github, then release within five minutes.",
  );
}

run("git", ["add", "-A"], { mutating: true });
run("git", ["commit", "-m", `release: v${version}`], { mutating: true });
run("git", ["tag", "-a", `v${version}`, "-m", `v${version}`], { mutating: true });
run("git", ["push", "origin", "master"], { mutating: true });

/**
 * npm first, then the tag.
 *
 * The registry refuses to register a version that npm does not have yet: it
 * checks the package and answers "version X was not found (status: 404)". The
 * tag push starts the registry workflow, so pushing the tag before publishing
 * raced our own npm publish and lost. On 1.9.6 the workflow ran, failed that
 * check, and the release half-landed with a GitHub release and a tag but
 * nothing on npm or the registry.
 *
 * Publishing first also means a failed publish stops the release before a tag
 * exists, which is the cheaper failure: a tag that points at an unpublished
 * version has to be deleted by hand.
 */
run("npm", ["publish", "--access", "public"], { mutating: true });

// npm's CDN can answer with the previous version for a few seconds after a
// publish, and the registry's check reads through it. Give it a moment before
// the tag starts the workflow.
if (!dry) {
  const settle = 20_000;
  console.log(`\nWaiting ${settle / 1000}s for npm to serve ${version} before tagging.`);
  await new Promise((r) => setTimeout(r, settle));
}

run("git", ["push", "origin", `v${version}`], { mutating: true });

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
if (registryRoute === "local") {
  run("mcp-publisher", ["publish"], { mutating: true });
} else if (!dry) {
  // The tag push above already started the workflow. Wait for it, and re-run it
  // once if it fails, because it has failed twice today on GitHub's own
  // "Failed to resolve action download info, Service Unavailable" before
  // reaching any of our code. That is worth one retry, not a lost release.
  console.log("\nWaiting for the tag-triggered registry workflow...");
  /**
   * The run for THIS tag, matched on headBranch, not `--limit 1`.
   *
   * Taking the newest run raced the queue: cutting 1.9.3 it picked up the run
   * from 1.9.2, waited on that run's old failure, re-ran the wrong workflow, and
   * cancelled the real one as collateral. Poll until the run for this tag
   * actually appears.
   */
  const runId = () => {
    for (let i = 0; i < 12; i++) {
      const id = execSync(
        `gh run list --workflow=publish-mcp-registry.yml --limit 15 --json databaseId,headBranch ` +
          `--jq '[.[] | select(.headBranch=="v${version}")][0].databaseId // empty'`,
        { cwd: root, encoding: "utf8" },
      ).trim();
      if (id) return id;
      execSync("sleep 10");
    }
    return "";
  };
  const waitFor = (id) => {
    for (let i = 0; i < 60; i++) {
      const st = execSync(`gh run view ${id} --json status,conclusion --jq '.status+" "+(.conclusion//"")'`, {
        cwd: root,
        encoding: "utf8",
      }).trim();
      if (st.startsWith("completed")) return st;
      execSync("sleep 10");
    }
    return "timeout";
  };
  execSync("sleep 15");
  const id = runId();
  if (!id) {
    console.log(
      "  no workflow run appeared for this tag. The registry check below will fail;\n" +
        "  publish it by hand with: mcp-publisher login github && mcp-publisher publish",
    );
  }
  let verdict = id ? waitFor(id) : "missing";
  console.log(`  workflow ${id}: ${verdict}`);
  if (id && !verdict.includes("success")) {
    console.log("  retrying once");
    execSync(`gh run rerun ${id}`, { cwd: root, stdio: "inherit" });
    execSync("sleep 15");
    verdict = waitFor(id);
    console.log(`  workflow ${id}: ${verdict}`);
  }
}

// --- verify every surface ---------------------------------------------------

if (dry) {
  console.log("\nDry run complete. Nothing was published.");
  process.exit(0);
}

const checks = [];

/**
 * npm, with a retry.
 *
 * `npm view` reads through a cache and a CDN, and right after a publish it can
 * still answer with the previous version. Cutting 1.9.5 it reported 1.9.4
 * seconds after a successful publish, and the registry had 1.9.5 the moment it
 * was asked directly. A verification step that reports a false failure is worse
 * than none, because the next real half-landed release gets waved through.
 */
const npmVersion = (() => {
  for (let i = 0; i < 6; i++) {
    const direct = execSync(`curl -s https://registry.npmjs.org/@pofky/asc-mcp`, { encoding: "utf8" });
    try {
      const latest = JSON.parse(direct)["dist-tags"].latest;
      if (latest === version) return latest;
    } catch {
      // fall through to the retry
    }
    if (i < 5) execSync("sleep 10");
  }
  return execFileSync("npm", ["view", "@pofky/asc-mcp", "version"], { encoding: "utf8" }).trim();
})();
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
