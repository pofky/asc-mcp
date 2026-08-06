/**
 * Self-diagnosis for setup. The #1 newbie failure mode is "it doesn't work" with
 * no idea why: missing .p8, wrong Issuer ID, a key without the right role, or an
 * unset license. `runDoctor` checks each link in the chain and, for every
 * failure, prints the exact next step. Powers both `npx @pofky/asc-mcp doctor` (CLI, runs
 * before the server is even configured) and the free `asc_setup_check` MCP tool.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getToken, clearTokenCache } from "./auth.js";
import { validateLicense, LICENSE_API_URL } from "./license.js";
import { discoverPrivateKey } from "./setup.js";
import { UPGRADE_URL } from "./gate.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** true when no check failed (warnings are allowed). */
  healthy: boolean;
}

const INTEGRATIONS_URL =
  "https://appstoreconnect.apple.com/access/integrations/api";

function resolvePath(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

/**
 * Run the full setup diagnosis. Reads env + the standard .p8 path, then attempts
 * a real authenticated API call so "looks configured" and "actually works" are
 * never confused.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. Private key (.p8) discovery / path.
  const discovered = discoverPrivateKey();
  const keyPath = process.env.ASC_PRIVATE_KEY_PATH || discovered?.path;
  if (!keyPath) {
    checks.push({
      name: "API key file (.p8)",
      status: "fail",
      detail: "No .p8 found in ~/.appstoreconnect/private_keys/ and ASC_PRIVATE_KEY_PATH is unset.",
      fix: `Create a key at ${INTEGRATIONS_URL} (role: App Manager), download the .p8 once, and drop it into ~/.appstoreconnect/private_keys/.`,
    });
  } else if (!existsSync(resolvePath(keyPath))) {
    checks.push({
      name: "API key file (.p8)",
      status: "fail",
      detail: `Path is set but the file does not exist: ${keyPath}`,
      fix: "Check the path, or move the .p8 to ~/.appstoreconnect/private_keys/ and unset ASC_PRIVATE_KEY_PATH to auto-detect it.",
    });
  } else {
    checks.push({
      name: "API key file (.p8)",
      status: "ok",
      detail: `Found ${keyPath}`,
    });
  }

  // 2. Key ID.
  const keyId = process.env.ASC_KEY_ID || discovered?.keyId;
  if (!keyId) {
    checks.push({
      name: "Key ID",
      status: "fail",
      detail: "No Key ID. It is normally read from the .p8 filename (AuthKey_XXXXXXXXXX.p8).",
      fix: "Either name the file AuthKey_<KeyID>.p8 in the standard folder, or set ASC_KEY_ID.",
    });
  } else {
    checks.push({ name: "Key ID", status: "ok", detail: keyId });
  }

  // 3. Issuer ID.
  const issuerId = process.env.ASC_ISSUER_ID;
  if (!issuerId) {
    checks.push({
      name: "Issuer ID",
      status: "fail",
      detail: "ASC_ISSUER_ID is unset.",
      fix: `Copy the Issuer ID (a UUID at the top of ${INTEGRATIONS_URL}) and set ASC_ISSUER_ID. Run \`npx @pofky/asc-mcp init\` to generate the config.`,
    });
  } else {
    checks.push({ name: "Issuer ID", status: "ok", detail: issuerId });
  }

  // 4. Live authentication: only attempt if the three inputs are present.
  if (keyId && issuerId && keyPath && existsSync(resolvePath(keyPath))) {
    try {
      clearTokenCache();
      const token = await getToken(keyId, issuerId, keyPath);
      const res = await fetch(
        "https://api.appstoreconnect.apple.com/v1/apps?limit=1",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        checks.push({
          name: "Live connection",
          status: "ok",
          detail: "Authenticated against App Store Connect and listed apps.",
        });
      } else if (res.status === 401) {
        checks.push({
          name: "Live connection",
          status: "fail",
          detail: "Apple rejected the credentials (401).",
          fix: "Issuer ID, Key ID, or .p8 mismatch. Recheck the Issuer ID UUID and confirm the .p8 matches the Key ID. Regenerate the key if unsure.",
        });
      } else if (res.status === 403) {
        checks.push({
          name: "Live connection",
          status: "fail",
          detail: "Authenticated but not authorized (403).",
          fix: "The key's role is too low. Give it App Manager (or higher) at the Integrations page, or generate a new key with that role.",
        });
      } else {
        checks.push({
          name: "Live connection",
          status: "fail",
          detail: `App Store Connect returned ${res.status}.`,
          fix: "Transient Apple error or network issue. Retry; if it persists, regenerate the key.",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        name: "Live connection",
        status: "fail",
        detail: `Could not sign or send the request: ${msg}`,
        fix: "Usually a malformed .p8 (must be the downloaded PKCS#8 file, unchanged) or no network. Re-download the key if needed.",
      });
    }
  } else {
    checks.push({
      name: "Live connection",
      status: "warn",
      detail: "Skipped: fix the credential checks above first.",
    });
  }

  // 5. License tier.
  //
  // Whether the trial can be offered here depends on whether the server is in
  // setup mode. With no credentials only asc_setup_check and asc_guide are
  // registered, so telling that user to call `asc_start_trial` names a tool
  // their client cannot see, and the agent relaying it hits "no such tool".
  const credentialsPresent = checks.every(
    (c) => c.name === "License" || c.status !== "fail",
  );
  const licenseKey = process.env.ASC_LICENSE_KEY;
  if (!licenseKey) {
    checks.push({
      name: "License",
      status: "warn",
      detail: "Free tier: the read tools (list_apps, app_details, review_status) work. The write, control and intelligence tools need Pro.",
      fix: credentialsPresent
        ? "Run `asc_start_trial` for 7 days of everything, no card. It unlocks write/control " +
          "(metadata, screenshots, builds, submit, IAP/subs) in this session, no restart. " +
          "Or subscribe at " + UPGRADE_URL + " and set ASC_LICENSE_KEY."
        : "Fix the credential problems above first. Once the server restarts with working " +
          "credentials, `asc_start_trial` will be available for 7 days of everything, no card.",
    });
  } else {
    const tier = await validateLicense(licenseKey);
    if (tier === "pro") {
      checks.push({ name: "License", status: "ok", detail: "Pro: all tools unlocked." });
    } else {
      checks.push({
        name: "License",
        status: "fail",
        detail: "A license key is set but did not validate as Pro.",
        fix:
          `Check the key (retrieve it at ${LICENSE_API_URL}/key). ` +
          "If the key is right, the license server may be unreachable: validation falls back to " +
          "the free tier on a network error, so retry once you are online.",
      });
    }
  }

  const healthy = !checks.some((c) => c.status === "fail");
  return { checks, healthy };
}

const ICON: Record<CheckStatus, string> = { ok: "[OK]  ", warn: "[WARN]", fail: "[FAIL]" };

/** Human-readable report for the CLI and the MCP tool. */
export function formatDoctor(report: DoctorReport): string {
  const lines = ["asc-mcp setup check", "=".repeat(40), ""];
  for (const c of report.checks) {
    lines.push(`${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.fix && c.status !== "ok") lines.push(`        Fix: ${c.fix}`);
  }
  lines.push("");
  lines.push(
    report.healthy
      ? "Ready. Try `list_apps`, then `asc_guide` (topic:overview) to see every flow."
      : "Not ready yet. Fix the [FAIL] lines above, then run this again.",
  );
  return lines.join("\n");
}
