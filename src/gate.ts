import type { Tier } from "./types.js";
import { LICENSE_API_URL } from "./license.js";

/**
 * The direct Polar checkout link. Kept in the package even though the normal
 * path is the counted redirect below, so a licence-server outage costs us
 * attribution rather than the sale. Moving the product to a different Polar
 * organization changes it, and the old link keeps working, so a missed copy
 * silently sells into the wrong org: `scripts/set-checkout-url.mjs` rewrites
 * every embedded copy at once.
 */
export const CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_y86PS4ruc848PXevVvSYS49S8gZY8JYWF192v1UEgjj";

/**
 * Counted redirect to the same checkout. Which locked tool a person was reaching
 * for when they decided to pay is the one demand signal this product collects,
 * and it is collected here, from a link the user chooses to open, rather than
 * from a beacon inside the server process.
 */
export function upgradeUrl(tool?: string): string {
  const base = `${LICENSE_API_URL}/go`;
  return tool && /^[a-z0-9_]{1,64}$/.test(tool) ? `${base}?tool=${tool}` : base;
}

/** Back-compat export: the generic buy link, no tool attribution. */
export const UPGRADE_URL = upgradeUrl();

/**
 * Returns an upgrade message when the tier is not Pro, otherwise null. Write and
 * control tools call this first and early-return the message.
 *
 * The message leads with the trial, not the price. This fires at the moment a
 * user has just asked their agent to do something real to their app, which is
 * the worst possible moment to send them to a browser to enter a card for a
 * product they have not yet seen work.
 */
export function requirePro(
  tier: Tier,
  capability: string,
  tool?: string,
): string | null {
  if (tier === "pro") return null;
  return (
    `${capability} requires Pro.\n\n` +
    `Free for 7 days, no card: call the \`asc_start_trial\` tool with the user's email. ` +
    `It unlocks all 41 tools in this session immediately, no restart.\n\n` +
    `Or subscribe now, $9/month: ${upgradeUrl(tool)}\n` +
    `(direct link: ${CHECKOUT_URL})\n\n` +
    `Already have a key? Set ASC_LICENSE_KEY in your MCP server config.`
  );
}
