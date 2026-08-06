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

    if (!response.ok) {
      console.error(`License validation failed: ${response.status}`);
      return "free";
    }

    const status = (await response.json()) as LicenseStatus;
    cachedStatus = status;
    cachedAt = now;

    return status.valid ? status.tier : "free";
  } catch (err) {
    // Network error - fail open to free tier (don't block the user)
    console.error("License validation network error:", err);
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
