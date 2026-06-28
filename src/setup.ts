import { readdirSync, existsSync } from "node:fs";
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
export async function runInit(): Promise<number> {
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
        command: "asc-mcp",
        env,
      },
    },
  };

  process.stdout.write(
    "\nDone. Paste this into ~/.claude/settings.json (or your client's MCP config):\n\n",
  );
  process.stdout.write(JSON.stringify(config, null, 2) + "\n\n");
  process.stdout.write(
    licenseKey
      ? "Pro license set, all control tools unlocked.\n"
      : "Free tier (read-only). Add ASC_LICENSE_KEY later to unlock write/control tools.\n",
  );
  return 0;
}
