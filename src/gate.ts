import type { Tier } from "./types.js";
import { LICENSE_API_URL, lastLicenseStatus } from "./license.js";

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

  // Someone whose trial has already run out must not be told to start one. They
  // would call asc_start_trial, be refused, and reasonably conclude the thing is
  // broken. `reason` comes from the licence server's last verdict on their key.
  const spent = lastLicenseStatus()?.reason === "trial_expired";

  return (
    `${capability} requires Pro.\n\n` +
    (spent
      ? "Your 7-day trial has ended. Pro is $9/month, cancel any time:\n" +
        `  ${upgradeUrl(tool)}\n` +
        `  (direct link: ${CHECKOUT_URL})\n\n` +
        "If you already subscribed, call `asc_start_trial` with the same email and it will fetch " +
        "your paid key and put it in your config.\n"
      : "Free for 7 days, no card: call the `asc_start_trial` tool with the user's email. " +
        "It unlocks all 41 tools in this session immediately, no restart.\n\n" +
        `Or subscribe now, $9/month: ${upgradeUrl(tool)}\n` +
        `(direct link: ${CHECKOUT_URL})\n`) +
    `\n${keyAdvice()}`
  );
}

/**
 * The last line of the gate message.
 *
 * A key that is set but never validated means the licence server could not be
 * reached, and validation fails open to the free tier. Telling that person to
 * "set ASC_LICENSE_KEY" sends a paying customer to check a config that is
 * already correct, during an outage that is ours.
 */
function keyAdvice(): string {
  const keySet = Boolean(process.env.ASC_LICENSE_KEY);
  if (keySet && lastLicenseStatus() === null) {
    return (
      "ASC_LICENSE_KEY is set but could not be checked, so the license server is probably " +
      "unreachable from here. Your key is fine. Retry in a moment, or check status at " +
      `${LICENSE_API_URL}/health`
    );
  }
  // A one-click install has no server block in any client config file, so
  // "set ASC_LICENSE_KEY in your MCP server config" sends a bundle user hunting
  // for JSON that does not exist. Same split as the trial tool's persistence
  // message: the manifest sets ASC_INSTALL, and that is the only way to tell
  // the two populations apart from inside the process.
  return process.env.ASC_INSTALL === "mcpb"
    ? "Already have a key? Paste it into Claude Settings > Extensions > asc-mcp > Configure > License key, then Save."
    : "Already have a key? Set ASC_LICENSE_KEY in your MCP server config.";
}
