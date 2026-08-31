import { readdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Apple's standard, tool-agnostic location for the App Store Connect API key. */
export const STANDARD_KEY_DIR = join(homedir(), ".appstoreconnect", "private_keys");

export interface DiscoveredKey {
  path: string;
  keyId: string;
}

/**
 * Scan the standard ~/.appstoreconnect/private_keys directory for an
 * AuthKey_XXXXXXXXXX.p8 file. The 10-char Key ID is encoded in the filename,
 * so a single dropped file is enough to derive both the path and the Key ID.
 */
export function discoverPrivateKey(dir = STANDARD_KEY_DIR): DiscoveredKey | null {
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const match = files.find((f) => /^AuthKey_[A-Z0-9]{10}\.p8$/i.test(f));
  if (!match) return null;
  const keyId = match.slice("AuthKey_".length, -".p8".length);
  return { path: join(dir, match), keyId };
}

/**
 * The Key ID encoded in a `.p8` filename, for a key that is NOT in the standard
 * directory.
 *
 * Apple names the download `AuthKey_XXXXXXXXXX.p8` wherever it lands, so a user
 * who points at their own path has already told us the Key ID. Without this,
 * anyone whose key lives outside `~/.appstoreconnect/private_keys` has to find
 * and type a 10-character string that is sitting in the filename they just
 * picked. That is the whole friction of the MCPB install, where the user
 * chooses the file with a native picker and never sees a path at all.
 */
export function keyIdFromPath(path: string): string | null {
  const base = path.split(/[\\/]/).pop() ?? "";
  const match = /^AuthKey_([A-Z0-9]{10})\.p8$/i.exec(base);
  return match ? match[1] : null;
}

/**
 * How the client should launch the server. The documented install path is
 * `npx @pofky/asc-mcp init`, which never puts an `asc-mcp` binary on PATH, so a
 * config saying `"command": "asc-mcp"` fails to start for everyone who did not
 * also `npm i -g`. npx works in both cases and matches the README.
 */
export const SERVER_LAUNCH = {
  command: "npx",
  args: ["-y", "@pofky/asc-mcp"],
} as const;

/**
 * Known client MCP config files, in the order we offer them.
 *
 * Claude Desktop stores its config in a different place on each platform, and
 * listing only the macOS one meant a Windows user running `init --write` was
 * never offered their real config and had no idea why. Every platform's path is
 * offered; ones that do not exist yet are still valid targets, since the point
 * of --write is to create the block.
 */
function clientConfigCandidates(): { label: string; path: string }[] {
  return clientConfigCandidatesForTest(process.platform, homedir(), process.env.APPDATA);
}

/** Same logic with the platform injected, so all three can be tested anywhere. */
export function clientConfigCandidatesForTest(
  platform: string,
  home: string,
  appDataEnv?: string,
): { label: string; path: string }[] {
  const appData = appDataEnv || join(home, "AppData", "Roaming");

  const desktop =
    platform === "win32"
      ? join(appData, "Claude", "claude_desktop_config.json")
      : platform === "darwin"
        ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : join(home, ".config", "Claude", "claude_desktop_config.json");

  return [
    { label: "Claude Desktop", path: desktop },
    { label: "Claude Code (global)", path: join(home, ".claude.json") },
    { label: "Project-local (.mcp.json in this folder)", path: join(process.cwd(), ".mcp.json") },
  ];
}

/**
 * Take a one-time backup of a config file.
 *
 * Deliberately refuses to overwrite an existing .bak. Re-running a command that
 * writes the config would otherwise replace the backup with an already-modified
 * copy, so by the second run the pristine original is gone and the backup is
 * worth nothing to someone trying to undo.
 */
function backupOnce(path: string): void {
  const bak = `${path}.bak`;
  if (!existsSync(bak)) copyFileSync(path, bak);
}

/**
 * Merge the asc-mcp server block into an existing client config file without
 * clobbering other servers. Backs the original up to <path>.bak first. Returns a
 * status line for the user.
 */
export function writeServerBlock(path: string, env: Record<string, string>): string {
  let existing: Record<string, unknown> = {};
  const hadFile = existsSync(path);
  if (hadFile) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      return `Could not parse ${path} (not valid JSON). Left it untouched; paste the block manually.`;
    }
    backupOnce(path);
  }
  const servers = (existing.mcpServers as Record<string, unknown>) ?? {};

  // Keep any env var already on the block that this run did not ask about.
  //
  // Replacing the block wholesale meant a paying customer who re-ran
  // `init --write` to correct their Issuer ID, and pressed Enter at the
  // optional licence-key prompt, silently lost ASC_LICENSE_KEY and dropped to
  // the free tier with no message saying so. Anything the user typed this time
  // wins; anything they did not is left alone.
  const previous = (servers["appstore-connect"] as { env?: Record<string, string> } | undefined)?.env;
  const merged = { ...(previous ?? {}), ...env };

  servers["appstore-connect"] = { ...SERVER_LAUNCH, env: merged };
  existing.mcpServers = servers;
  writeFileSync(path, JSON.stringify(existing, null, 2) + "\n");

  const kept = Object.keys(previous ?? {}).filter((k) => !(k in env));
  const keptNote = kept.length ? ` Kept your existing ${kept.join(", ")}.` : "";
  return hadFile
    ? `Wrote ${path} (backup at ${path}.bak).${keptNote} Restart the client.`
    : `Created ${path}. Restart the client.`;
}

/**
 * Add ASC_LICENSE_KEY to an already-configured asc-mcp server block, in every
 * client config that has one.
 *
 * Deliberately narrower than `writeServerBlock`, which replaces the whole block:
 * this runs unattended from inside a tool call, so it must not be able to drop
 * an env var someone set by hand. It only ever adds one key, only to a block
 * that already launches this package, and only after taking a .bak. A config it
 * cannot parse, or that has no asc-mcp block, is left alone and reported.
 */
export function injectLicenseKey(
  key: string,
  candidates = clientConfigCandidates(),
): { updated: string[]; skipped: string[] } {
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const { path } of candidates) {
    if (!existsSync(path)) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      skipped.push(`${path} (not valid JSON)`);
      continue;
    }

    const servers = parsed.mcpServers as Record<string, any> | undefined;
    if (!servers || typeof servers !== "object") continue;

    let touched = false;
    for (const block of Object.values(servers)) {
      if (!block || typeof block !== "object") continue;
      // Match the command exactly, or as the final path segment. A substring
      // test wrote the licence key into any unrelated server whose binary path
      // merely contained "asc-mcp" (a wrapper, a proxy, a local checkout),
      // handing a paid key to a process that has no business holding it.
      const command = String(block.command ?? "");
      const binary = command.split(/[\\/]/).pop() ?? "";
      const launches =
        JSON.stringify(block.args ?? "").includes("@pofky/asc-mcp") ||
        binary === "asc-mcp" ||
        binary === "appstore-connect-mcp";
      if (!launches) continue;
      block.env = { ...(block.env ?? {}), ASC_LICENSE_KEY: key };
      touched = true;
    }

    if (!touched) continue;

    try {
      backupOnce(path);
      writeFileSync(path, JSON.stringify(parsed, null, 2) + "\n");
      updated.push(path);
    } catch {
      skipped.push(`${path} (not writable)`);
    }
  }

  return { updated, skipped };
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Options for `asc-mcp init`, parsed from the command line. */
export interface InitOptions {
  write?: boolean;
  issuerId?: string;
  keyId?: string;
  keyPath?: string;
  licenseKey?: string;
  configPath?: string;
}

/**
 * Parse the flags `init` accepts. Every value it would otherwise have to ask a
 * human for can be passed on the command line, because the documented install
 * path runs through a coding agent, and an agent has no terminal to type into.
 */
export function parseInitArgs(argv: string[]): InitOptions {
  const opts: InitOptions = { write: argv.includes("--write") };
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const next = argv[i + 1];
    return next && !next.startsWith("--") ? next : undefined;
  };
  opts.issuerId = value("--issuer");
  opts.keyId = value("--key-id");
  opts.keyPath = value("--key-path");
  opts.licenseKey = value("--license");
  opts.configPath = value("--config");
  return opts;
}

/** The paste-ready client config block for a set of environment variables. */
function configBlock(env: Record<string, string>) {
  return { mcpServers: { "appstore-connect": { ...SERVER_LAUNCH, env } } };
}

/**
 * `asc-mcp init` without a terminal, which is how most people actually run it:
 * they ask their coding agent to install this server, and the agent runs the
 * command in a pipe.
 *
 * This used to print one line of advice and exit, writing nothing and printing
 * no config, even when the `.p8` had been found and `ASC_ISSUER_ID` was already
 * set, which is precisely the case where everything needed is known. The user
 * ended up with no server block, and the failure looked like the package.
 *
 * Nothing here is guessed. The Issuer ID comes from `--issuer` or the
 * environment, never from a placeholder, and a `--write` with more than one
 * existing client config prints the block and asks which, rather than picking
 * one for the user.
 */
function runInitNonInteractive(
  opts: InitOptions,
  discovered: DiscoveredKey | null,
): number {
  const keyPath = opts.keyPath || process.env.ASC_PRIVATE_KEY_PATH || discovered?.path;
  const keyId =
    opts.keyId ||
    process.env.ASC_KEY_ID ||
    (keyPath ? keyIdFromPath(keyPath) : null) ||
    discovered?.keyId;
  const issuerId = opts.issuerId || process.env.ASC_ISSUER_ID;
  const licenseKey = opts.licenseKey || process.env.ASC_LICENSE_KEY;

  const missing: string[] = [];
  if (!keyPath) missing.push("the .p8 path (--key-path, or ASC_PRIVATE_KEY_PATH)");
  if (!keyId) missing.push("the Key ID (--key-id, or ASC_KEY_ID)");
  if (!issuerId) missing.push("the Issuer ID (--issuer, or ASC_ISSUER_ID)");

  if (missing.length) {
    process.stdout.write(
      "Non-interactive shell, so nothing can be asked. Still needed: " +
        missing.join(", ") +
        ".\nRe-run with the values, for example:\n" +
        "  npx @pofky/asc-mcp init --write --issuer <uuid>\n",
    );
    return 1;
  }

  const env: Record<string, string> = {
    ASC_KEY_ID: keyId!,
    ASC_ISSUER_ID: issuerId!,
    ASC_PRIVATE_KEY_PATH: keyPath!,
  };
  if (licenseKey) env.ASC_LICENSE_KEY = licenseKey;

  let wrote = false;
  if (opts.write) {
    const candidates = clientConfigCandidates();
    const target =
      opts.configPath ||
      (candidates.filter((c) => existsSync(c.path)).length === 1
        ? candidates.find((c) => existsSync(c.path))!.path
        : null);

    if (target) {
      process.stdout.write(`\n${writeServerBlock(target, env)}\n`);
      wrote = true;
    } else {
      const existing = candidates.filter((c) => existsSync(c.path));
      process.stdout.write(
        existing.length
          ? "\nMore than one client config exists, so none was chosen for you. Re-run with one of:\n" +
              existing.map((c) => `  --config ${c.path}\n`).join("")
          : "\nNo client config exists yet, so none was written. Re-run with --config <path>, or paste the block below.\n",
      );
    }
  }

  process.stdout.write(
    (wrote
      ? "\nThe same block, in case you want it elsewhere:\n\n"
      : "\nPaste this into your client's MCP config:\n\n") +
      JSON.stringify(configBlock(env), null, 2) +
      "\n\n",
  );
  process.stdout.write(
    (licenseKey
      ? "Pro license set, all control tools unlocked.\n"
      : "Free tier. Ask your agent to run `asc_start_trial` for 7 days of everything, no card.\n") +
      (wrote ? "Restart your MCP client, then run `asc_setup_check`.\n" : ""),
  );
  return 0;
}

/**
 * `asc-mcp init`: auto-detect the .p8, collect the Issuer ID (and optional
 * license key), then write or print a paste-ready MCP server config.
 *
 * Interactive when there is a terminal to ask questions in, and fully
 * non-interactive otherwise, driven by flags and the environment.
 */
export async function runInit(options: InitOptions | boolean = {}): Promise<number> {
  const opts: InitOptions = typeof options === "boolean" ? { write: options } : options;
  const write = Boolean(opts.write);
  process.stdout.write("\nasc-mcp setup\n");
  process.stdout.write("─".repeat(40) + "\n\n");

  const discovered = discoverPrivateKey();
  if (discovered) {
    process.stdout.write(`Found API key: ${discovered.path}\n`);
    process.stdout.write(`Key ID:        ${discovered.keyId}\n\n`);
  } else {
    process.stdout.write(
      "No .p8 found in the standard location.\n" +
        `  1. App Store Connect > Users and Access > Integrations > App Store Connect API\n` +
        `  2. Generate an API key with the App Manager role and Download the .p8 (one-time).\n` +
        `  3. Move it to: ${STANDARD_KEY_DIR}/\n\n`,
    );
  }

  if (!process.stdin.isTTY) {
    return runInitNonInteractive(opts, discovered);
  }

  const keyId =
    opts.keyId || discovered?.keyId || (await prompt("Key ID (10 chars): "));
  const privateKeyPath =
    opts.keyPath || discovered?.path || (await prompt("Path to .p8 file: "));
  const issuerId =
    opts.issuerId ||
    (await prompt("Issuer ID (UUID at the top of the Integrations page): "));
  const licenseKey =
    opts.licenseKey ||
    (await prompt("Pro license key (optional, press Enter to skip): "));

  const env: Record<string, string> = {
    ASC_KEY_ID: keyId,
    ASC_ISSUER_ID: issuerId,
    ASC_PRIVATE_KEY_PATH: privateKeyPath,
  };
  if (licenseKey) env.ASC_LICENSE_KEY = licenseKey;

  const config = configBlock(env);

  let wrote = false;
  if (write && opts.configPath) {
    process.stdout.write(`\n${writeServerBlock(opts.configPath, env)}\n`);
    wrote = true;
  } else if (write) {
    const candidates = clientConfigCandidates();
    process.stdout.write("\nWhich client config should I write to?\n");
    candidates.forEach((c, i) => {
      const exists = existsSync(c.path) ? " (exists)" : "";
      process.stdout.write(`  ${i + 1}. ${c.label}: ${c.path}${exists}\n`);
    });
    process.stdout.write("  0. Skip (just print the block)\n");
    const choice = await prompt("Choice [0]: ");
    const idx = parseInt(choice, 10);
    if (idx >= 1 && idx <= candidates.length) {
      const status = writeServerBlock(candidates[idx - 1].path, env);
      process.stdout.write(`\n${status}\n`);
      wrote = true;
    }
  }

  if (!wrote) {
    process.stdout.write(
      "\nDone. Paste this into your client's MCP config (e.g. Claude Desktop config, or ~/.claude.json):\n\n",
    );
    process.stdout.write(JSON.stringify(config, null, 2) + "\n\n");
  }
  process.stdout.write(
    licenseKey
      ? "Pro license set, all control tools unlocked.\n"
      : "Free tier (read-only). Add ASC_LICENSE_KEY later to unlock write/control tools.\n",
  );

  process.stdout.write(
    "\nNext steps:\n" +
      (wrote
        ? "  1. Restart your MCP client.\n"
        : "  1. Paste the block above, then restart your MCP client.\n") +
      "  2. Ask your agent to run `asc_setup_check` (or `npx @pofky/asc-mcp doctor`) to confirm everything is wired.\n" +
      "  3. Then `list_apps`, and `asc_guide` (topic:overview) for the map of every flow.\n" +
      "  4. Optional: `npx @pofky/asc-mcp install-skill` adds the bundled review-triage Claude Skill.\n",
  );
  return 0;
}
