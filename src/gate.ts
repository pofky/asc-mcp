import type { Tier } from "./types.js";

export const UPGRADE_URL =
  "https://buy.polar.sh/polar_cl_Ta3OxEA1EbRyYNPFtSsRXgYWBCCtjwMxlbAeW35RLuu";

/**
 * Returns an upgrade message string when the tier is not Pro, otherwise null.
 * Write/control tools call this first and early-return the message.
 */
export function requirePro(tier: Tier, capability: string): string | null {
  if (tier === "pro") return null;
  return (
    `${capability} requires a Pro license ($9/mo).\n` +
    `Get your license at: ${UPGRADE_URL}\n\n` +
    "Set ASC_LICENSE_KEY in your MCP server config to unlock."
  );
}
