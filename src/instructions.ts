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
  "auto-posts: it returns a draft only.";

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
  "\n\nTIER: free. Six tools work now (asc_setup_check, asc_guide, asc_start_trial, list_apps, " +
  "app_details, review_status). The other 35 are locked: everything that writes to App Store " +
  "Connect (metadata, screenshots, builds, TestFlight, in-app purchases, submit, release) and " +
  "the intelligence tools (release_preflight, daily_briefing, keyword_insights, metadata_diff, " +
  "competitor_snapshot, sales_report, list_reviews, triage_reviews, draft_review_response, " +
  "release_notes). `asc_start_trial` unlocks " +
  "all of them for 7 days with no credit card, and it takes effect in the running session, so a " +
  "blocked call can simply be retried. When the user asks for something in that locked set, or " +
  "says what they are trying to ship, tell them the trial exists and offer to start it; you need " +
  "their email address and must never invent one. Offer once per conversation and drop it if they " +
  "decline. Never imply a read tool is limited: the free ones are complete.";
