/**
 * asc_guide - the orientation layer.
 *
 * The MCP has 30+ tools and a control plane with real, non-obvious limits
 * (atomic PATCH, V2 age rating, per-territory pricing, first-IAP-on-version,
 * ASC-UI-only privacy/trader). An agent that just sees a flat tool list will
 * stumble into those. This tool is the map: it returns the exact end-to-end
 * playbook for a given goal, with the manual ASC-website / Xcode interruptions
 * called out inline at the step where they bite.
 *
 * Free tier: orientation is never gated. Users should be able to read the flows
 * (and see what Pro unlocks) before paying.
 */

export type GuideTopic =
  | "overview"
  | "setup"
  | "first-app"
  | "update"
  | "screenshots"
  | "iap"
  | "subscriptions"
  | "reviews"
  | "testflight"
  | "binary"
  | "limitations";

export interface GuideArgs {
  topic?: GuideTopic;
}

interface Flow {
  title: string;
  when: string;
  /** Ordered steps. A step starting with "MANUAL:" is a hand-step in the ASC website / Xcode that no API can do. */
  steps: string[];
  /** Manual interruptions specific to this flow, restated so they are impossible to miss. */
  manual: string[];
}

const FLOWS: Record<Exclude<GuideTopic, "overview" | "limitations">, Flow> = {
  setup: {
    title: "One-time setup",
    when: "Before anything else, once per machine.",
    steps: [
      "Create an API key: App Store Connect > Users and Access > Integrations > App Store Connect API > generate a key with the App Manager role. Download the .p8 (one time only).",
      "Drop the .p8 into ~/.appstoreconnect/private_keys/ (Apple's standard path). The 10-char Key ID is read from the filename, so that one file is enough.",
      "Run `npx @pofky/asc-mcp init` in a terminal. It auto-detects the key, asks for your Issuer ID (the UUID at the top of the Integrations page) and an optional Pro license key, and prints a paste-ready MCP config block.",
      "Paste the block into your client config and restart the client. Claude Code global: ~/.claude.json. Claude Desktop: Library/Application Support/Claude/claude_desktop_config.json. Per project: .mcp.json in the project root. Or re-run `init --write` and let it write whichever you pick.",
      "Verify with `list_apps`. If it returns your apps, you are connected.",
    ],
    manual: [
      "MANUAL: generating the API key and downloading the .p8 is a one-time App Store Connect website action. The .p8 cannot be re-downloaded; if lost, revoke and make a new one.",
      "Free tier is read/intelligence only. To unlock every write/control tool, call `asc_start_trial` with the user's email: 7 days, no card, and it takes effect in the running session with no restart. After that it is $9/month (ASC_LICENSE_KEY).",
    ],
  },

  "first-app": {
    title: "Ship an app's FIRST release (1.0)",
    when: "Brand-new app, never been on the store. The hardest flow because of first-time-only Apple constraints.",
    steps: [
      "MANUAL: the app RECORD must already exist. `POST /v1/apps` is forbidden for API keys, so create the app (name, bundle ID, SKU, primary language) once in App Store Connect > Apps > +. App Groups are portal-only too.",
      "`list_apps` to get the numeric app_id.",
      "Build + upload a binary so a build exists to attach (see topic:binary), or upload via Xcode/Transporter. Then `wait_for_build` until VALID.",
      "`set_app_metadata` - primary/secondary category, copyright, content rights, export compliance (most apps: uses_non_exempt_encryption=false).",
      "`set_app_price` - price_usd:0 for free, or a tier. Required before submit.",
      "`update_version_metadata` - description, keywords, what's-new (note: what's-new is NOT editable on a first 1.0 with no prior release; the tool drops it and reports it skipped), promo text, marketing/support/privacy-policy URLs, name, subtitle. Char limits validated.",
      "`set_app_availability` - defaults to all ~175 territories; pass a subset to restrict.",
      "`set_age_rating` - pass only the declarations that apply; the tool fetches, merges the full V2 set, and submits (it is NOT a partial PATCH).",
      "`set_review_contact` - name, phone, email, demo account if the app needs login. Required before submit.",
      "`attach_build` - newest VALID build by default.",
      "`upload_screenshots` per display type (at minimum APP_IPHONE_67; APP_IPHONE_65 + APP_IPAD recommended). See topic:screenshots.",
      "MANUAL: App Privacy nutrition label. Not in the API. Run `set_privacy_nutrition` for the exact checklist + deep link, then set it in the ASC website.",
      "MANUAL: EU DSA trader status. Not in the API. Run `set_eu_trader_status` for steps + deep link; it's a legal decision, set it in the website.",
      "If the app has in-app purchases or subscriptions, create them now (topic:iap / topic:subscriptions). The FIRST ones must be submitted WITH the version (next step).",
      "`release_preflight` - fix every FAIL it reports. It tailors a 'manual steps to finish' list to this app's state.",
      "MANUAL (if first IAPs exist): the app's very first in-app purchases CANNOT be bundled with the version via the API. In the ASC website, open the version, Add for Review, tick the products, and submit them together. `submit_for_review` detects this and ABORTS rather than orphaning the version. After the first release is live, later IAPs submit via the API fine.",
      "`submit_for_review` with confirm:true (only if there are no first-IAPs blocking; otherwise submit in the website per the step above).",
      "After approval: `release_version` (confirm:true) to go live now, or `manage_phased_release` start for a 7-day rollout.",
    ],
    manual: [
      "App record + App Group creation - ASC website / Developer portal only.",
      "App Privacy nutrition label - ASC website only (`set_privacy_nutrition` gives the checklist).",
      "EU trader status - ASC website only, legal decision (`set_eu_trader_status` gives steps).",
      "First in-app purchases - must be submitted with the version in the ASC website; API cannot bundle them.",
      "Building the binary needs Xcode on a Mac (the API can't compile).",
    ],
  },

  update: {
    title: "Ship an UPDATE to an existing app",
    when: "App is already live; you're releasing a new version. Much simpler than 1.0.",
    steps: [
      "`app_details` to read current version + state.",
      "`create_version` with the next version number (e.g. 2.5.0) if there's no editable version yet.",
      "`update_version_metadata` - what's-new is editable now; update description/keywords/promo as needed.",
      "Upload the new build (`upload_binary` confirm:true, or Xcode/Transporter; see topic:binary), `wait_for_build` to VALID, then `attach_build`.",
      "`upload_screenshots` only if they changed.",
      "Later IAPs/subscriptions (not the first ever) can be created and will submit via the API.",
      "`release_preflight` - fix FAILs.",
      "`submit_for_review` confirm:true.",
      "After approval: `release_version` confirm:true, or `manage_phased_release` start.",
      "Use `metadata_diff` any time to see exactly what changed between live and pending across locales.",
    ],
    manual: [
      "Still no API for nutrition label or trader status, but these persist from the first release; only revisit if your data practices changed.",
      "Building the binary still needs Xcode.",
    ],
  },

  screenshots: {
    title: "Upload screenshots",
    when: "Adding or replacing App Store screenshots.",
    steps: [
      "Prepare PNG/JPEG files at the exact pixel size for the display type.",
      "`upload_screenshots` with display_type, an ordered files array, and locale. It runs Apple's 3-step reserve/PUT-chunks/commit flow for you.",
      "Common display types: APP_IPHONE_67 (6.7in, required), APP_IPHONE_65 (6.5in), APP_IPAD_PRO_129 (12.9in iPad).",
    ],
    manual: [
      "Capturing the screenshots from a simulator is not yet automated (capture_screenshots is on the roadmap). Produce the PNGs yourself, then upload via the tool.",
      "Apple requires correct exact dimensions per display type or the commit fails.",
    ],
  },

  iap: {
    title: "Create a one-time in-app purchase (non-consumable / consumable)",
    when: "Selling a lifetime unlock, consumable credits, etc.",
    steps: [
      "`create_iap` - product_id, reference name, display name (max 30), description (max 45), type, price_usd. It's idempotent: USA base price, auto-equalized across all territories, availability set. IAP state recomputes immediately on availability (unlike subscriptions, which need a nudge), so once price + availability + a review screenshot are set the product is READY_TO_SUBMIT.",
      "`set_iap_review_screenshot` - IAPs need an App Review screenshot to leave MISSING_METADATA. Upload one showing the paywall.",
      "For the FIRST IAP ever on the app: it must be submitted WITH the app version in the ASC website (see topic:first-app). After the first release is live, later IAPs submit via `submit_for_review`.",
    ],
    manual: [
      "First non-consumable / first IAP on a brand-new app: submit it together with the version in the ASC website. API can't bundle the first one.",
      "IAP localization description is capped at 45 chars.",
    ],
  },

  subscriptions: {
    title: "Create an auto-renewable subscription",
    when: "Recurring billing (monthly/yearly plans, free trials).",
    steps: [
      "`create_subscription` - group ref + display name, product_id, names, description (max 45), period, price_usd, optional free_trial, review_note. It is idempotent and handles the gnarly order Apple requires: availability FIRST, then USA base price, then equalize across ~175 territories, then per-territory free-trial intro offers, then a final no-op PATCH to force the state to recompute to READY_TO_SUBMIT.",
      "`set_iap_review_screenshot` - subscriptions also need a review screenshot of the paywall.",
      "First subscriptions on a brand-new app submit WITH the version in the website; later ones via the API.",
    ],
    manual: [
      "First subscriptions on a new app: submit with the version in the ASC website.",
      "Subscription state only recomputes on a subscription-level edit; create_subscription nudges it for you, but if you edit sub-resources by hand, expect a lag until a subscription PATCH.",
    ],
  },

  reviews: {
    title: "Triage and respond to customer reviews",
    when: "Managing your App Store reputation.",
    steps: [
      "`list_reviews` - filter by rating, sort, limit.",
      "`triage_reviews` - clusters recent reviews into 3-5 themes with counts and action buckets, using your own client's model via MCP Sampling (no extra cost from this server).",
      "`draft_review_response` - drafts a public reply in the review's locale. It NEVER auto-posts.",
      "MANUAL: post the approved reply text in App Store Connect yourself (the API does not expose posting public responses).",
    ],
    manual: [
      "Posting the public response is manual in the ASC website; the tool only drafts it.",
    ],
  },

  testflight: {
    title: "Distribute a TestFlight beta",
    when: "Getting a build to testers before App Review.",
    steps: [
      "Upload a build (topic:binary), `wait_for_build` to VALID.",
      "`list_beta_groups` to find or confirm a group.",
      "`assign_build_to_group` - newest VALID build by default.",
      "`invite_beta_tester` - email + name; Apple sends the TestFlight invite.",
    ],
    manual: [
      "Beta App Review (for external groups' first build) and the test-information form may need a one-time touch in the ASC website.",
    ],
  },

  binary: {
    title: "Build, sign, and upload the binary",
    when: "You need a build on App Store Connect and want to do it from the agent.",
    steps: [
      "MANUAL: an Apple Distribution certificate must already exist in your login keychain. Certificate creation and cloud signing are not available to least-privilege API keys.",
      "`setup_app_store_signing` - downloads the app's IOS_APP_STORE provisioning profiles (app + extensions), installs them, and writes a manual-signing ExportOptions.plist. This sidesteps the cloud-signing permission most API keys lack.",
      "`build_and_archive` - xcodebuild archive + export using that ExportOptions.plist. Requires Xcode on this Mac. Give it the .xcodeproj/.xcworkspace, scheme, and the generated plist.",
      "`upload_binary` confirm:true - uploads the .ipa via altool with your API key.",
      "`wait_for_build` until the build is VALID, then `attach_build`.",
    ],
    manual: [
      "Building requires the local Xcode toolchain; the API cannot compile.",
      "Distribution certificate must pre-exist in the keychain; API keys can't create certs or use cloud signing.",
    ],
  },
};

const LIMITATIONS: { item: string; why: string; doInstead: string }[] = [
  {
    item: "Create an app record",
    why: "POST /v1/apps is forbidden for API keys.",
    doInstead: "ASC website > Apps > + (one time).",
  },
  {
    item: "Delete or remove an app record",
    why: "DELETE /v1/apps is forbidden for API keys (probed live: apps allows GET and UPDATE only). Builds and appInfos cannot be deleted either.",
    doInstead:
      "First take it off sale everywhere, which IS automatable: set_app_availability with territories: [] turns all ~175 territories off (Apple requires this even for an app that was never released). Also remove any in-app purchases from sale. Then, in the ASC website: Apps > your app > App Information > Additional Information > Remove App. Needs the Account Holder or Admin role, and it will not appear while the app is in Ready for Review, Waiting for Review, In Review, Metadata Rejected or Rejected. Note the SKU can never be reused in the organisation, and the bundle ID cannot be reused if a build was ever uploaded.",
  },
  {
    item: "Create an App Group",
    why: "Portal-only; no API.",
    doInstead: "Apple Developer portal > Identifiers.",
  },
  {
    item: "App Privacy nutrition label",
    why: "appDataUsages is not in the public API.",
    doInstead: "ASC website. Run `set_privacy_nutrition` for the exact checklist + deep link.",
  },
  {
    item: "EU DSA trader status",
    why: "No public API attribute/resource.",
    doInstead: "ASC website. Run `set_eu_trader_status` for steps + deep link. Legal decision.",
  },
  {
    item: "Submit an app's FIRST in-app purchases / subscriptions",
    why: "First products return FIRST_NON_CONSUMABLE_MUST_BE_SUBMITTED_ON_VERSION; only the website bundles them with the version.",
    doInstead: "ASC website: open the version, Add for Review, tick the products, submit together. `submit_for_review` aborts to avoid orphaning. Later products submit via API.",
  },
  {
    item: "Create a signing certificate / use cloud signing",
    why: "Least-privilege API keys lack certificate rights; cloud signing fails with a permission error.",
    doInstead: "Have an Apple Distribution cert in the keychain, then `setup_app_store_signing` for manual-signing profiles + ExportOptions.plist.",
  },
  {
    item: "Compile the binary",
    why: "Building an .ipa needs the Xcode toolchain.",
    doInstead: "`build_and_archive` + `upload_binary` run locally on a Mac with Xcode.",
  },
  {
    item: "Post a public response to a review",
    why: "API exposes reading reviews, not posting public replies.",
    doInstead: "`draft_review_response` writes the reply; paste it in the ASC website.",
  },
  {
    item: "Capture simulator screenshots",
    why: "Not yet implemented (roadmap).",
    doInstead: "Produce PNGs yourself, then `upload_screenshots`.",
  },
];

function renderFlow(f: Flow): string {
  // MANUAL lines are interleaved callouts, not numbered steps, so they must not
  // consume a step number (otherwise the visible numbering skips).
  let n = 0;
  const steps = f.steps
    .map((s) => (s.startsWith("MANUAL:") ? `   ${s}` : `${++n}. ${s}`))
    .join("\n");
  const manual = f.manual.map((m) => `- ${m}`).join("\n");
  return (
    `## ${f.title}\n\n` +
    `When: ${f.when}\n\n` +
    `Steps:\n${steps}\n\n` +
    `Manual interruptions you must do yourself:\n${manual}\n`
  );
}

function renderOverview(): string {
  const lines = [
    "# asc-mcp guide (App Store Connect)",
    "",
    "Call `asc_guide` with a `topic` for the exact playbook. Manual steps (things no API can do) are flagged inline so you never get blocked mid-flow.",
    "",
    "Topics:",
    "- setup - one-time machine setup (.p8, init, config)",
    "- first-app - ship a brand-new app's 1.0 (the hardest flow)",
    "- update - ship an update to a live app",
    "- screenshots - upload App Store screenshots",
    "- iap - create a one-time in-app purchase",
    "- subscriptions - create an auto-renewable subscription",
    "- reviews - triage and reply to customer reviews",
    "- testflight - distribute a beta",
    "- binary - build, sign, upload the binary (needs Xcode)",
    "- limitations - everything the API can't do + the manual workaround",
    "",
    "Golden rule: when a step says MANUAL, stop and do it in the App Store Connect website (or Xcode). The agent should hand the user the deep link and exact steps, not pretend the API can do it.",
    "",
    "Outward-facing tools (submit_for_review, release_version, upload_binary) require confirm:true. Always confirm with the human first.",
  ];
  return lines.join("\n");
}

function renderLimitations(): string {
  const rows = LIMITATIONS.map(
    (l) => `### ${l.item}\nWhy: ${l.why}\nDo instead: ${l.doInstead}`,
  ).join("\n\n");
  return (
    "# Limitations and manual interruptions\n\n" +
    "Everything here is impossible via the App Store Connect API and must be done by hand. " +
    "The MCP either returns the exact steps (privacy, trader) or detects and aborts (first IAPs) so nothing is left half-done.\n\n" +
    rows
  );
}

export async function ascGuide(args: GuideArgs): Promise<string> {
  const topic = args.topic ?? "overview";
  if (topic === "overview") return renderOverview();
  if (topic === "limitations") return renderLimitations();
  const flow = FLOWS[topic];
  if (!flow) return renderOverview();
  return renderFlow(flow);
}

/** Exposed so docs generation and tests can reuse the same source of truth. */
export { FLOWS, LIMITATIONS, renderFlow, renderOverview, renderLimitations };
