/**
 * The server instructions string, which every MCP client hands the model at the
 * start of every conversation.
 *
 * Its own module because it is the highest-leverage text in the product and
 * `index.ts` boots a server on import, so nothing could test it in place.
 */

/** What every client is told about this server, in both tiers. */
export const BASE_INSTRUCTIONS =
  "asc-mcp, an MCP server for Apple's App Store Connect API. Tools query that API. " +
  "Slash-command Prompts seed multi-tool workflows. triage_reviews and draft_review_response " +
  "use MCP Sampling (your own client's model, zero extra cost). draft_review_response never " +
  "auto-posts: it returns a draft only. When you know the app's local Xcode project folder, pass it " +
  "to release_preflight as project_path. When a tool fails, its reply ends with a Next: line saying " +
  "what to do and whether you or the user does it: follow it, and tell the user any step only they " +
  "can do (Apple's website, a key file, their email) in plain words. When unsure what is wrong, call " +
  "asc_setup_check.";

/**
 * The free tier's half, and the only place a free user learns what they have.
 *
 * Instructions reach the model on every conversation, which makes this the one
 * line in the product that a person who never trips a paywall will still hear
 * about. Until 1.9.9 it said nothing about tiers, so someone who installed the
 * server and asked it to read things got answers, learned nothing about the
 * other 35 tools, and never had a reason to try them. Roughly one install in
 * forty started a trial.
 *
 * It tells the model to offer once, on intent, and then stop. Anything pushier
 * turns a working read tool into an advert, which is how a free tier loses the
 * trust that makes the trial worth offering at all.
 */
export const FREE_TIER_INSTRUCTIONS =
  "\n\nTIER: free. Six tools work now with no limit (asc_setup_check, asc_guide, asc_start_trial, " +
  "list_apps, app_details, review_status). The other 35 need Pro. Ten of those only read " +
  "(list_reviews, sales_report, release_preflight, daily_briefing, release_notes, keyword_insights, " +
  "competitor_snapshot, metadata_diff, list_builds, list_beta_groups) and work 5 times in total on " +
  "this machine as a free preview with no license and no email: when the user asks for one, just " +
  "call it, and tell them how many preview calls are left, which the last line of the reply " +
  "states. The preview is not offered once a trial or subscription has ended on this machine. " +
  "Everything that writes to App Store Connect (metadata, screenshots, builds, TestFlight, in-app " +
  "purchases, submit, release), and triage_reviews, draft_review_response and wait_for_build, are " +
  "not part of the preview. `asc_start_trial` unlocks all 41 tools for 7 days with no credit card, " +
  "and it takes effect in the running session, so a refused call can simply be retried. When a " +
  "call is refused, tell the user the price and that the trial exists, and offer to start it; you " +
  "need their email address and must never invent one. Mention the price or the trial once per " +
  "conversation and drop it if they decline. The six free tools are complete; never describe them " +
  "as limited.";

/**
 * A license that ended, or a key that got no answer, must not be pitched a trial
 * the server will refuse. The model only knows what this says.
 */
export const ENDED_LICENSE_INSTRUCTIONS =
  "\n\nTIER: free, because this machine's trial or subscription has ended. Six tools still work " +
  "(asc_setup_check, asc_guide, asc_start_trial, list_apps, app_details, review_status). The other 35 " +
  "need Pro, and no free trial or preview is available here. When a call is refused, tell the user the " +
  "price it states. If they have already subscribed, asc_start_trial with their subscription's address " +
  "emails them their key.";

export const UNCHECKED_LICENSE_INSTRUCTIONS =
  "\n\nTIER: unknown for now. A license key is set and the license server gave no answer, which says " +
  "nothing about the key. Pro tools are locked until it answers. Do not offer a trial or a price; tell " +
  "the user to retry shortly.";

export function instructionsFor(tier: string, reason: string | undefined, keyUnchecked: boolean): string {
  if (tier === "pro") return BASE_INSTRUCTIONS;
  if (keyUnchecked) return BASE_INSTRUCTIONS + UNCHECKED_LICENSE_INSTRUCTIONS;
  if (reason === "trial_expired" || reason === "revoked" || reason === "canceled" || reason === "inactive") {
    return BASE_INSTRUCTIONS + ENDED_LICENSE_INSTRUCTIONS;
  }
  return BASE_INSTRUCTIONS + FREE_TIER_INSTRUCTIONS;
}
