import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Tier } from "./types.js";
import { LICENSE_API_URL, lastLicenseStatus } from "./license.js";
import { isReadTool } from "./tool-meta.js";

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
 * How many Pro calls work on this machine with no licence, as a preview.
 *
 * Until 1.9.14 the gate came down on the second useful call: reviews, sales and
 * build status were all locked, so nobody on the free tier saw the product do
 * the thing it is for before being asked for an email. Five is the owner's
 * choice (9 October 2026): enough to read a real app's reviews, sales and a
 * preflight, short enough that the price comes up in the same sitting.
 */
export const PREVIEW_CALLS = 5;

/**
 * Pro tools that read but are not part of the preview. The first two work
 * through the client's own model (MCP sampling) and report a missing licence
 * inside a structured result rather than by returning the gate. The next two
 * return Apple's manual steps for a submission; they show nothing of the
 * product, and spending a preview call on a checklist would be a poor trade.
 * `wait_for_build` polls for up to an hour, which is a job, not a look.
 */
const NOT_PREVIEWED = new Set([
  "triage_reviews",
  "draft_review_response",
  "set_privacy_nutrition",
  "set_eu_trader_status",
  "wait_for_build",
]);

/** Whether a locked tool may be previewed: it reads, and never changes anything. */
function previewable(tool?: string): tool is string {
  return Boolean(tool) && isReadTool(tool!) && !NOT_PREVIEWED.has(tool!);
}

function previewPath(): string {
  return join(homedir(), ".asc-mcp", "preview.json");
}

function previewUsed(): number {
  try {
    const used = (JSON.parse(readFileSync(previewPath(), "utf-8")) as { used?: unknown }).used;
    return typeof used === "number" && used >= 0 ? Math.floor(used) : 0;
  } catch {
    return 0;
  }
}

/** False when the count could not be kept, in which case no preview is given. */
function setPreviewUsed(used: number): boolean {
  try {
    mkdirSync(dirname(previewPath()), { recursive: true, mode: 0o700 });
    writeFileSync(previewPath(), JSON.stringify({ used }) + "\n");
    return true;
  } catch {
    return false;
  }
}

/**
 * One tool call, and the preview the gate granted during it, if any.
 *
 * Scoped to the call rather than kept in a shared list, because an agent runs
 * tool calls side by side. With one list, whichever call finished first took
 * the notice: a free tool's reply announced the preview count, the previewed
 * reply said nothing, and a failed call's refund went to a different call.
 */
export const previewScope = new AsyncLocalStorage<{ grant: { tool: string; left: number } | null }>();

/**
 * What to tell the user about the preview call that just ran, and a way to give
 * it back. The tool wrapper appends `footer` to a successful reply and calls
 * `refund` when the call failed, so an Apple outage or a typo in an app id does
 * not spend someone's preview. Null for every call that was not a preview,
 * which is every call a Pro user ever makes.
 */
export function takePreviewNotice(): { footer: string; refund: () => void } | null {
  const call = previewScope.getStore();
  const preview = call?.grant;
  if (!call || !preview) return null;
  call.grant = null;
  const price = `Pro is $9/month, cancel any time: ${upgradeUrl(preview.tool)}`;
  return {
    footer:
      "\n\n---\n" +
      // The count on every preview reply; the price on the first and the
      // last only. Five replies in a row each ending in a price and a link
      // would be an advert stapled to a working tool.
      (preview.left > 0
        ? `Free preview: ${preview.left} of ${PREVIEW_CALLS} Pro calls left on this machine.` +
          (preview.left === PREVIEW_CALLS - 1 ? ` ${price}` : "")
        : `That was the last of your ${PREVIEW_CALLS} free Pro calls. ${price}\n` +
          "Or try everything free for 7 days, no card: call `asc_start_trial` with the user's email."),
    refund: () => {
      setPreviewUsed(Math.max(0, previewUsed() - 1));
    },
  };
}

/**
 * Returns an upgrade message when the tier is not Pro, otherwise null. Write and
 * control tools call this first and early-return the message.
 *
 * A read tool gets through `PREVIEW_CALLS` times first. After that, and for
 * anything that writes, the message leads with the price and offers the trial
 * second: the owner's call (9 October 2026), on the reasoning that someone who
 * has just watched it work on their own app is being asked for $9, not for a
 * leap of faith.
 */
export function requirePro(
  tier: Tier,
  capability: string,
  tool?: string,
): string | null {
  // First, and before anything else in this function: a Pro user, paying or on
  // a trial, is never counted, never shown a footer and never touches the disk.
  if (tier === "pro") return null;

  // Someone whose trial has already run out must not be told to start one. They
  // would call asc_start_trial, be refused, and reasonably conclude the thing is
  // broken. `reason` comes from the licence server's last verdict on their key.
  const spent = lastLicenseStatus()?.reason === "trial_expired";

  // A former subscriber must not be offered a free trial either. Someone whose
  // renewal was declined, or who cancelled, is refused by the trial endpoint
  // anyway, so the offer reads as broken at the exact moment they were willing
  // to pay. They get the same wording as a spent trial: the price and the link.
  const reason = lastLicenseStatus()?.reason;
  const lapsedPaid = reason === "revoked" || reason === "canceled" || reason === "inactive";

  // The preview is for someone who has not seen the product yet. A spent trial
  // or a lapsed subscription has, and gets the price.
  let previewSpent = false;
  // Only inside a call the wrapper is tracking: a preview that could not be
  // reported back, or refunded on failure, is not granted.
  const call = previewScope.getStore();
  if (call && !spent && !lapsedPaid && previewable(tool)) {
    const used = previewUsed();
    if (used < PREVIEW_CALLS && setPreviewUsed(used + 1)) {
      call.grant = { tool, left: PREVIEW_CALLS - used - 1 };
      return null;
    }
    previewSpent = used >= PREVIEW_CALLS;
  }

  return (
    `${capability} requires Pro.\n\n` +
    (spent || lapsedPaid
      ? (spent
          ? "Your 7-day trial has ended. "
          : "Your subscription is no longer active; a declined renewal is the usual cause. ") +
        "Pro is $9/month, cancel any time:\n" +
        `  ${upgradeUrl(tool)}\n` +
        `  (direct link: ${CHECKOUT_URL})\n\n` +
        "If you already subscribed, call `asc_start_trial` with the same email and it will fetch " +
        "your paid key and save it on this machine.\n"
      : (previewSpent ? `You have used the ${PREVIEW_CALLS} free Pro calls on this machine. ` : "") +
        "Pro is $9/month, cancel any time:\n" +
        `  ${upgradeUrl(tool)}\n` +
        `  (direct link: ${CHECKOUT_URL})\n\n` +
        "Or free for 7 days, no card: call the `asc_start_trial` tool with the user's email. " +
        "It unlocks all 41 tools in this session immediately, no restart.\n") +
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
    : process.env.ASC_INSTALL === "plugin"
      ? "Already have a key? Set it as the License key option in the asc-mcp plugin's settings."
      : "Already have a key? Set ASC_LICENSE_KEY in your MCP server config.";
}
