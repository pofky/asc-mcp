import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LicenseStatus, Tier } from "./types.js";

export const LICENSE_API_URL =
  process.env.ASC_LICENSE_API_URL || "https://asc-mcp-license.remewdy.workers.dev";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedStatus: LicenseStatus | null = null;
let cachedAt = 0;

/**
 * Whether a key is worth sending to the license server at all.
 *
 * The `.mcpb` bundle declares the license key as an optional user config field,
 * and an optional field the user leaves blank can reach the process as the
 * literal `${user_config.asc_license_key}` rather than as an absent variable.
 * Posting that to /validate is a guaranteed-invalid round trip on every start,
 * and it puts a nonsense row in the license server's rate limiter for someone
 * who has simply not bought anything yet.
 */
function usableKey(key?: string): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.length > 0 && !trimmed.includes("${");
}

/**
 * Validate the license key against the remote license server.
 * Returns the user's tier (free or pro).
 * Results are cached for 24 hours to avoid per-call latency.
 */
export async function validateLicense(licenseKey?: string): Promise<Tier> {
  if (!usableKey(licenseKey)) return "free";

  const now = Date.now();
  if (cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus.tier;
  }

  try {
    const response = await fetch(`${LICENSE_API_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: licenseKey }),
    });

    // A 5xx is our server failing, not a verdict on their key. Treating it as
    // "not Pro" demotes a paying customer for the whole session, and because
    // the only cache was in memory, every new session during an outage demoted
    // them again. A 4xx IS a verdict and is honoured.
    if (response.status >= 500) {
      console.error(`License server error ${response.status}; using the last known verdict.`);
      return offlineTier(licenseKey);
    }

    if (!response.ok) {
      console.error(`License validation failed: ${response.status}`);
      return "free";
    }

    const status = (await response.json()) as LicenseStatus;
    cachedStatus = status;
    cachedAt = now;
    if (status.valid && status.tier === "pro") rememberPro(licenseKey, status);

    return status.valid ? status.tier : "free";
  } catch (err) {
    console.error("License validation network error:", err);
    return offlineTier(licenseKey);
  }
}

/**
 * How long a previously-confirmed Pro key keeps working while the licence
 * server cannot be reached.
 *
 * Deliberately generous, and deliberately one-directional: only a verdict of
 * Pro is ever remembered, so this can extend a paying customer through an
 * outage but can never grant Pro to a key the server has not already approved.
 * The same reasoning as the server's own renewal grace window: our plumbing
 * failing must not cost someone access they paid for.
 */
const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

function offlineCachePath(): string {
  return join(homedir(), ".asc-mcp", "last-verdict.json");
}

/** Fingerprint of the key, so the cache file never contains the key itself. */
function keyDigest(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

function rememberPro(key: string, status: LicenseStatus): void {
  try {
    const path = offlineCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ key: keyDigest(key), tier: "pro", expires: status.expires ?? null, at: Date.now() }),
      { mode: 0o600 },
    );
  } catch {
    // A read-only or sandboxed home is not a reason to fail a validation.
  }
}

/**
 * The tier to use when the licence server could not give an answer. Free unless
 * this exact key was confirmed Pro recently and its own expiry has not passed.
 */
function offlineTier(key: string): Tier {
  try {
    const cached = JSON.parse(readFileSync(offlineCachePath(), "utf-8")) as {
      key?: string;
      tier?: string;
      expires?: string | null;
      at?: number;
    };
    if (cached.tier !== "pro" || cached.key !== keyDigest(key)) return "free";
    if (!cached.at || Date.now() - cached.at > OFFLINE_GRACE_MS) return "free";
    if (cached.expires && new Date(cached.expires).getTime() < Date.now()) return "free";

    console.error("asc-mcp: license server unreachable, honouring the last confirmed Pro verdict.");
    cachedStatus = { valid: true, tier: "pro", expires: cached.expires ?? undefined } as LicenseStatus;
    cachedAt = Date.now();
    return "pro";
  } catch {
    return "free";
  }
}

/**
 * The cached validation result, or null if nothing has been validated yet.
 *
 * Tier alone cannot answer "is this person paying?", because a live trial also
 * reports pro. `asc_start_trial` needs the difference: a subscriber must be told
 * there is nothing to trial, while a trial user asking again just wants to know
 * how many days are left.
 */
export function lastLicenseStatus(): LicenseStatus | null {
  return cachedStatus;
}

/** Clear the cached license status (for tests). */
export function clearLicenseCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}
