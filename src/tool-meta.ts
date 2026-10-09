import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Every tool's display title and whether it changes anything, in one place.
 *
 * A client reads these to decide what it may run without asking. A read tool is
 * announced as `readOnlyHint: true`. Everything else is announced as
 * `destructiveHint: true`, with no finer grade on purpose: each write here acts
 * on a live App Store account, a tester's inbox, the keychain or a config file
 * on this machine, and "additive, so it may run unprompted" is not a promise
 * this server should make on anyone's behalf.
 *
 * Anthropic's directory refuses a tool that has no title or neither hint, so a
 * tool registered without a row here fails at startup rather than at review.
 */
type Effect = "read" | "write";

const TOOL_META = {
  // Orientation and licence
  asc_setup_check: ["Check setup and connection", "read"],
  asc_guide: ["Get the playbook for a release task", "read"],
  asc_start_trial: ["Start a free 7-day Pro trial", "write"],

  // Reading the account
  list_apps: ["List apps", "read"],
  app_details: ["Get app details", "read"],
  review_status: ["Check App Review status", "read"],
  list_reviews: ["List customer reviews", "read"],
  sales_report: ["Get sales and downloads summary", "read"],
  release_preflight: ["Audit a version before submission", "read"],
  daily_briefing: ["Get a briefing across all apps", "read"],
  release_notes: ["Collect commits for release notes", "read"],
  keyword_insights: ["Analyze keyword competition", "read"],
  competitor_snapshot: ["Look up an app on the App Store", "read"],
  metadata_diff: ["Compare live and pending metadata", "read"],
  triage_reviews: ["Triage reviews into themes", "read"],
  draft_review_response: ["Draft a reply to a review", "read"],
  list_builds: ["List builds", "read"],
  wait_for_build: ["Wait for a build to finish processing", "read"],
  list_beta_groups: ["List TestFlight groups", "read"],

  // Guidance for the steps Apple keeps on its website: these return a
  // checklist and a link, and write nothing.
  set_privacy_nutrition: ["Get the App Privacy label steps", "read"],
  set_eu_trader_status: ["Get the EU trader status steps", "read"],

  // Writes to the App Store Connect account
  update_version_metadata: ["Edit version metadata", "write"],
  create_version: ["Create a new app version", "write"],
  submit_for_review: ["Submit a version for App Review", "write"],
  attach_build: ["Attach a build to a version", "write"],
  upload_screenshots: ["Upload screenshots", "write"],
  release_version: ["Release an approved version", "write"],
  manage_phased_release: ["Control a phased release", "write"],
  assign_build_to_group: ["Send a build to a TestFlight group", "write"],
  invite_beta_tester: ["Invite a TestFlight tester", "write"],
  upload_binary: ["Upload a build to App Store Connect", "write"],
  set_age_rating: ["Set the age rating", "write"],
  create_subscription: ["Create a subscription", "write"],
  create_iap: ["Create an in-app purchase", "write"],
  set_iap_review_screenshot: ["Upload an in-app purchase review screenshot", "write"],
  set_app_metadata: ["Set categories, copyright and compliance", "write"],
  set_app_price: ["Set the app price", "write"],
  set_review_contact: ["Set the App Review contact", "write"],
  set_app_availability: ["Set country availability", "write"],

  // Writes to this machine
  build_and_archive: ["Build and archive with Xcode", "write"],
  setup_app_store_signing: ["Install App Store signing profiles", "write"],
} as const satisfies Record<string, readonly [title: string, effect: Effect]>;

export type ToolName = keyof typeof TOOL_META;

export const TOOL_NAMES = Object.keys(TOOL_META) as ToolName[];

/** The `title` and `annotations` a registration needs, for a tool by name. */
export function toolMeta(name: ToolName): { title: string; annotations: ToolAnnotations } {
  const [title, effect] = TOOL_META[name];
  return {
    title,
    annotations:
      effect === "read"
        ? { title, readOnlyHint: true }
        : { title, readOnlyHint: false, destructiveHint: true },
  };
}

/** Whether a tool only reads. False for a name that is not a tool. */
export function isReadTool(name: string): boolean {
  return name in TOOL_META && TOOL_META[name as ToolName][1] === "read";
}
