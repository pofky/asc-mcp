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
 * How the client should launch the server. The documented install path is
 * `npx @pofky/asc-mcp init`, which never puts an `asc-mcp` binary on PATH, so a
 * config saying `"command": "asc-mcp"` fails to start for everyone who did not
 * also `npm i -g`. npx works in both cases and matches the README.
 */
export const SERVER_LAUNCH = {
  command: "npx",
  args: ["-y", "@pofky/asc-mcp"],
} as const;

/** Known client MCP config files, in the order we offer them. */
function clientConfigCandidates(): { label: string; path: string }[] {
  const home = homedir();
  return [
    {
      label: "Claude Desktop",
      path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    },
    { label: "Claude Code (global)", path: join(home, ".claude.json") },
    { label: "Project-local (.mcp.json in this folder)", path: join(process.cwd(), ".mcp.json") },
  ];
}

/**
 * Merge the asc-mcp server block into an existing client config file without
 * clobbering other servers. Backs up the original to <path>.bak first. Returns a
 * status line for the user.
 */
export function writeServerBlock(path: string, env: Record<string, string>): string {
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      return `Could not parse ${path} (not valid JSON). Left it untouched; paste the block manually.`;
    }
    copyFileSync(path, `${path}.bak`);
  }
  const servers = (existing.mcpServers as Record<string, unknown>) ?? {};
  servers["appstore-connect"] = { ...SERVER_LAUNCH, env };
  existing.mcpServers = servers;
  writeFileSync(path, JSON.stringify(existing, null, 2) + "\n");
  return existsSync(`${path}.bak`)
    ? `Wrote ${path} (backup at ${path}.bak). Restart the client.`
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
      const launches =
        JSON.stringify(block.args ?? "").includes("@pofky/asc-mcp") ||
        String(block.command ?? "").includes("asc-mcp");
      if (!launches) continue;
      block.env = { ...(block.env ?? {}), ASC_LICENSE_KEY: key };
      touched = true;
    }

    if (!touched) continue;

    try {
      copyFileSync(path, `${path}.bak`);
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

/**
 * Interactive `asc-mcp init`: auto-detect the .p8, ask for the Issuer ID
 * (and optional license key), then print a paste-ready MCP server config.
 * Writes nothing to disk; the user pastes the block into their client config.
 */
export async function runInit(write = false): Promise<number> {
  process.stdout.write("\nApp Store Connect MCP setup\n");
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
    process.stdout.write(
      "Non-interactive shell. Set ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH manually.\n",
    );
    return discovered ? 0 : 1;
  }

  const keyId = discovered?.keyId || (await prompt("Key ID (10 chars): "));
  const privateKeyPath =
    discovered?.path || (await prompt("Path to .p8 file: "));
  const issuerId = await prompt(
    "Issuer ID (UUID at the top of the Integrations page): ",
  );
  const licenseKey = await prompt(
    "Pro license key (optional, press Enter to skip): ",
  );

  const env: Record<string, string> = {
    ASC_KEY_ID: keyId,
    ASC_ISSUER_ID: issuerId,
    ASC_PRIVATE_KEY_PATH: privateKeyPath,
  };
  if (licenseKey) env.ASC_LICENSE_KEY = licenseKey;

  const config = {
    mcpServers: {
      "appstore-connect": {
        ...SERVER_LAUNCH,
        env,
      },
    },
  };

  let wrote = false;
  if (write) {
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
