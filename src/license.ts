import type { LicenseStatus, Tier } from "./types.js";

const LICENSE_API_URL =
  process.env.ASC_LICENSE_API_URL || "https://asc-mcp-license.remewdy.workers.dev";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedStatus: LicenseStatus | null = null;
let cachedAt = 0;

/**
 * Validate the license key against the remote license server.
 * Returns the user's tier (free or pro).
 * Results are cached for 24 hours to avoid per-call latency.
 */
export async function validateLicense(licenseKey?: string): Promise<Tier> {
  if (!licenseKey) return "free";

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

/** Clear the cached license status (for tests). */
export function clearLicenseCache(): void {
  cachedStatus = null;
  cachedAt = 0;
}
