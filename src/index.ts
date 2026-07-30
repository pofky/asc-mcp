#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ASCClient } from "./client.js";
import { validateLicense } from "./license.js";
import { registerPrompts } from "./prompts.js";
import { installSkill, uninstallSkill } from "./skill-installer.js";
import type { ASCConfig, Tier } from "./types.js";

import { listApps } from "./tools/list-apps.js";
import { appDetails } from "./tools/app-details.js";
import { reviewStatus } from "./tools/review-status.js";
import { listReviews } from "./tools/list-reviews.js";
import { salesReport } from "./tools/sales-report.js";
import { releasePreflight } from "./tools/release-preflight.js";
import { dailyBriefing } from "./tools/daily-briefing.js";
import { releaseNotes } from "./tools/release-notes.js";
import { keywordInsights } from "./tools/keyword-insights.js";
import { competitorSnapshot } from "./tools/competitor-snapshot.js";
import { metadataDiff } from "./tools/metadata-diff.js";
import { triageReviews, formatTriageForAgent } from "./tools/triage-reviews.js";
import { draftReviewResponse, formatDraftForAgent } from "./tools/draft-review-response.js";
import { updateVersionMetadata } from "./tools/update-version-metadata.js";
import { createVersion, submitForReview } from "./tools/version-control.js";
import { listBuilds, attachBuild, waitForBuild } from "./tools/builds.js";
import { uploadScreenshots } from "./tools/screenshots.js";
import { releaseVersion, managePhasedRelease } from "./tools/release-control.js";
import { listBetaGroups, assignBuildToGroup, inviteBetaTester } from "./tools/testflight.js";
import { buildAndArchive, uploadBinary } from "./tools/local-build.js";
import { setAgeRating } from "./tools/age-rating.js";
import { setPrivacyNutrition } from "./tools/privacy.js";
import { setEUTraderStatus } from "./tools/eu-trader.js";
import { createSubscription, createIAP } from "./tools/iap.js";
import { setIapReviewScreenshot } from "./tools/review-screenshot.js";
import { setAppMetadata, setAppPrice, setReviewContact } from "./tools/submission.js";
import { setAppAvailability } from "./tools/availability.js";
import { setupAppStoreSigning } from "./tools/signing.js";
import { ascGuide } from "./tools/guide.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { discoverPrivateKey, runInit } from "./setup.js";

const SERVER_VERSION = "1.8.3";

const MISSING_CREDS_MESSAGE =
  "Missing App Store Connect credentials.\n\n" +
  "Fastest path: run `asc-mcp init` (auto-detects your .p8, prints a paste-ready config).\n\n" +
  "Or set manually:\n" +
  "  ASC_KEY_ID       - Your API key ID (auto-detected from a .p8 in ~/.appstoreconnect/private_keys)\n" +
  "  ASC_ISSUER_ID    - Your team's issuer ID\n" +
  "  ASC_PRIVATE_KEY_PATH - Path to your .p8 (auto-detected from the standard path)\n\n" +
  "Create an API key at:\n" +
  "  https://appstoreconnect.apple.com/access/integrations/api";

function getConfig(): ASCConfig | null {
  // Auto-discover the .p8 in Apple's standard path so a dropped key + Issuer ID
  // is enough - no need to hand-set ASC_KEY_ID / ASC_PRIVATE_KEY_PATH.
  const discovered = discoverPrivateKey();
  const keyId = process.env.ASC_KEY_ID || discovered?.keyId;
  const issuerId = process.env.ASC_ISSUER_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH || discovered?.path;

  if (!keyId || !issuerId || !privateKeyPath) return null;

  return {
    keyId,
    issuerId,
    privateKeyPath,
    licenseKey: process.env.ASC_LICENSE_KEY,
  };
}

/**
 * Credential-less start: connect anyway with the two free orientation tools so
 * the client shows a working server that can explain the fix, instead of a
 * "server disconnected" with the reason buried in a log file.
 */
async function runSetupMode() {
  console.error(`asc-mcp ${SERVER_VERSION}: setup mode. ${MISSING_CREDS_MESSAGE}`);

  const server = new McpServer(
    { name: "asc-mcp", version: SERVER_VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        "App Store Connect MCP, running in SETUP MODE: no credentials found, so only asc_setup_check and asc_guide are available. Call asc_setup_check first and relay the fix it prints, then the user restarts this server to get all 40 tools.",
    },
  );

  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  server.tool(
    "asc_setup_check",
    "Diagnose your setup: checks the .p8 key, Key ID, Issuer ID, a LIVE authenticated connection to App Store Connect, and your license tier. For anything wrong, returns the exact fix. Run this first if something isn't working. Free.",
    {},
    async () => text(formatDoctor(await runDoctor())),
  );

  server.tool(
    "asc_guide",
    "START HERE. Returns the exact end-to-end playbook for an App Store task, with every manual ASC-website/Xcode step that no API can do flagged inline. Free.",
    { topic: z.string().optional().describe("Which playbook. Omit for the overview + topic list.") },
    async (args: { topic?: string }) => text(await ascGuide(args as any)),
  );

  await server.connect(new StdioServerTransport());
}

async function main() {
  const config = getConfig();
  if (!config) return runSetupMode();
  const client = new ASCClient(config);
  const tier: Tier = await validateLicense(config.licenseKey);

  if (tier === "pro") {
    console.error(`asc-mcp ${SERVER_VERSION}: Pro license active. All tools available.`);
  } else {
    console.error(
      `asc-mcp ${SERVER_VERSION}: Free tier. Read/intelligence tools active; write/control tools require Pro. Upgrade at https://buy.polar.sh/polar_cl_Ta3OxEA1EbRyYNPFtSsRXgYWBCCtjwMxlbAeW35RLuu`,
    );
  }

  const server = new McpServer(
    {
      name: "asc-mcp",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
      instructions:
        "App Store Connect MCP. Tools query the ASC API. Slash-command Prompts seed multi-tool workflows. triage_reviews and draft_review_response use MCP Sampling (your own client's model, zero extra cost). draft_review_response never auto-posts: it returns a draft only.",
    },
  );

  // --- Free tools ---

  /** Wrap a tool handler so API errors return messages instead of crashing. */
  function safe(fn: (...a: any[]) => Promise<string>) {
    return async (...a: any[]) => {
      try {
        return { content: [{ type: "text" as const, text: await fn(...a) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    };
  }

  server.tool(
    "asc_guide",
    "START HERE. Returns the exact end-to-end playbook for an App Store task, with every manual ASC-website/Xcode step that no API can do flagged inline. Call with topic to orient before any multi-step flow. Free.",
    {
      topic: z
        .enum([
          "overview",
          "setup",
          "first-app",
          "update",
          "screenshots",
          "iap",
          "subscriptions",
          "reviews",
          "testflight",
          "binary",
          "limitations",
        ])
        .optional()
        .describe("Which playbook. Omit for the overview + topic list."),
    },
    safe((args) => ascGuide(args)),
  );

  server.tool(
    "asc_setup_check",
    "Diagnose your setup: checks the .p8 key, Key ID, Issuer ID, a LIVE authenticated connection to App Store Connect, and your license tier. For anything wrong, returns the exact fix. Run this first if something isn't working. Free.",
    {},
    safe(async () => formatDoctor(await runDoctor())),
  );

  server.tool(
    "list_apps",
    "List all apps in your App Store Connect account with name, bundle ID, and platform.",
    { limit: z.number().optional().describe("Max apps to return (default 50, max 200)") },
    safe((args) => listApps(client, args)),
  );

  server.tool(
    "app_details",
    "Get detailed info about an app including versions, build status, and release state.",
    { app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID (use list_apps to find it)") },
    safe((args) => appDetails(client, args)),
  );

  server.tool(
    "review_status",
    "Check the current App Store review status - in review, waiting, approved, or rejected.",
    { app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID") },
    safe((args) => reviewStatus(client, args)),
  );

  // --- Pro tools (gated) ---

  server.tool(
    "list_reviews",
    "List customer reviews for an app. Filter by rating. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      rating: z.number().min(1).max(5).optional().describe("Filter by star rating (1-5)"),
      limit: z.number().optional().describe("Max reviews (default 20, max 100)"),
      sort: z.enum(["newest", "oldest", "rating_high", "rating_low"]).optional()
        .describe("Sort order (default: newest)"),
    },
    safe((args) => listReviews(client, args, tier)),
  );

  server.tool(
    "sales_report",
    "Download sales/downloads summary. Shows units, proceeds, territory. Pro feature.",
    {
      vendor_number: z.string().optional()
        .describe("Vendor number (8-9 digits) from App Store Connect > Sales and Trends. Omit to be told where to find it."),
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional()
        .describe("Report frequency (default: DAILY)"),
      report_date: z.string().optional()
        .describe("Date in YYYY-MM-DD (daily) or YYYY-MM (monthly). Default: yesterday."),
    },
    safe((args) => salesReport(client, args, tier)),
  );

  // --- Intelligence tools (Pro) ---

  server.tool(
    "release_preflight",
    "Pre-submission audit: checks metadata, character limits, screenshots, build status. Catches rejection causes before you submit.",
    { app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID") },
    safe((args) => releasePreflight(client, args, tier)),
  );

  server.tool(
    "daily_briefing",
    "Morning briefing across all apps: version status, recent reviews, rejections, action items. One call for full situational awareness.",
    { days: z.number().optional().describe("Look back N days for reviews (default 3)") },
    safe((args) => dailyBriefing(client, args, tier)),
  );

  server.tool(
    "release_notes",
    "Extract git commits since last tag and return structured data for writing App Store 'What's New' text. Categorizes changes and provides writing guidelines.",
    {
      project_path: z.string().optional().describe("Path to git project (default: current directory)"),
      since_tag: z.string().optional().describe("Git tag to diff from (default: latest tag)"),
      max_commits: z.number().optional().describe("Max commits to include (default 50)"),
    },
    safe((args) => releaseNotes(args, tier)),
  );

  server.tool(
    "keyword_insights",
    "Analyze your app's keywords against search competition. Shows difficulty, competing apps, and budget usage. Uses iTunes Search API.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      extra_keywords: z.string().optional().describe("Extra comma-separated keywords to analyze beyond current metadata"),
    },
    safe((args) => keywordInsights(client, args, tier)),
  );

  server.tool(
    "competitor_snapshot",
    "Look up any app on the App Store: ratings, reviews, version, price, category, release notes. Search by name or App Store ID.",
    {
      query: z.string().describe('App name (e.g. "Medisafe") or numeric App Store ID'),
      country: z.string().optional().describe("Two-letter country code (default: us)"),
    },
    safe((args) => competitorSnapshot(args, tier)),
  );

  server.tool(
    "metadata_diff",
    "Compare metadata between your live and pending app versions. Shows what changed in descriptions, keywords, and release notes across locales.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
    },
    safe((args) => metadataDiff(client, args, tier)),
  );

  // --- Sampling-powered tools (Pro) ---
  server.registerTool(
    "triage_reviews",
    {
      title: "Triage reviews into themes (Sampling)",
      description:
        "Pull recent App Store reviews and use MCP Sampling to cluster them into 3 to 5 themes with counts, representative quotes, and action buckets (bug, missing_feature, pricing, ux, content). Sampling uses your own MCP client's model, so there is no extra cost from this server. Pro feature.",
      inputSchema: {
        app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
        rating: z.number().min(1).max(5).optional().describe("Filter by star rating (1 to 5). Omit for all."),
        limit: z.number().min(1).max(30).optional().describe("Max reviews (default 30, hard cap 30)"),
        days: z.number().min(1).max(90).optional().describe("Look-back window in days (default 30)"),
      },
    },
    async (args) => {
      try {
        const result = await triageReviews(server, client, args, tier);
        return {
          content: [{ type: "text" as const, text: formatTriageForAgent(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    "draft_review_response",
    {
      title: "Draft a public response to a review (Sampling + Elicitation)",
      description:
        "Draft a public reply to a single App Store review via MCP Sampling, in the review's locale. Uses Elicitation (if your client supports it) to ask for tone. NEVER auto-posts. Always returns a draft that you must post via App Store Connect yourself. Pro feature.",
      inputSchema: {
        app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
        review_id: z.string().min(1).describe("Customer review ID (from list_reviews)"),
        tone: z.enum(["apologetic", "factual", "promotional", "curious"]).optional()
          .describe("Tone; if omitted and the client supports Elicitation, the user will be asked interactively."),
        include_support_link: z.boolean().optional()
          .describe("Mention that users can reach support (no phone/email, per Apple guideline 1.2)."),
        context_note: z.string().max(500).optional()
          .describe("Optional context to weave in (e.g. 'fix ships in v2.5')."),
      },
    },
    async (args) => {
      try {
        const result = await draftReviewResponse(server, client, args, tier);
        return {
          content: [{ type: "text" as const, text: formatDraftForAgent(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );

  // --- Control / write tools (Pro, gated) ---

  server.tool(
    "update_version_metadata",
    "Edit App Store metadata on the editable version: description, keywords, what's-new, promotional text, marketing/support/privacy-policy URLs, plus app name and subtitle. Validates Apple character limits before writing. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      locale: z.string().optional().describe("Locale to edit (e.g. en-US). Default: first/primary locale."),
      description: z.string().optional().describe("App description (max 4000 chars)"),
      keywords: z.string().optional().describe("Comma-separated keywords (max 100 chars total)"),
      whats_new: z.string().optional().describe("What's New / release notes (max 4000 chars)"),
      promotional_text: z.string().optional().describe("Promotional text (max 170 chars)"),
      marketing_url: z.string().optional().describe("Marketing URL"),
      support_url: z.string().optional().describe("Support URL"),
      name: z.string().optional().describe("App name (max 30 chars)"),
      subtitle: z.string().optional().describe("App subtitle (max 30 chars)"),
      privacy_policy_url: z.string().optional().describe("Privacy policy URL (shown on the App Store listing)"),
    },
    safe((args) => updateVersionMetadata(client, args, tier)),
  );

  server.tool(
    "create_version",
    "Create a new editable App Store version to prepare your next release. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      version_string: z.string().describe("Version number, e.g. 2.5.0"),
      platform: z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]).optional().describe("Platform (default IOS)"),
      copyright: z.string().optional().describe("Copyright line, e.g. 2026 Your Company"),
    },
    safe((args) => createVersion(client, args, tier)),
  );

  server.tool(
    "submit_for_review",
    "Submit the editable version to Apple App Review. First submits any READY_TO_SUBMIT in-app purchases/subscriptions, then the version. If the app's FIRST in-app purchase is detected (which Apple requires be bundled with the version in the website), it ABORTS without submitting and returns the manual steps, so nothing is orphaned. Outward-facing action: requires confirm:true. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      platform: z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]).optional().describe("Platform (default IOS)"),
      confirm: z.boolean().optional().describe("Must be true to actually submit to App Review."),
    },
    safe((args) => submitForReview(client, args, tier)),
  );

  server.tool(
    "list_builds",
    "List recent builds for an app with processing state (VALID = ready to use). Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      limit: z.number().optional().describe("Max builds (default 10, max 50)"),
    },
    safe((args) => listBuilds(client, args, tier)),
  );

  server.tool(
    "wait_for_build",
    "Poll until the newest uploaded build finishes processing (VALID), so the ship flow is one call. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      max_wait_seconds: z.number().optional().describe("Max seconds to wait (default 1800, cap 3600)"),
      poll_seconds: z.number().optional().describe("Seconds between polls (default 30, min 10)"),
    },
    safe((args) => waitForBuild(client, args, tier)),
  );

  server.tool(
    "attach_build",
    "Attach a build to the editable version (defaults to the newest processed build). Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      build_id: z.string().optional().describe("Specific build ID (from list_builds). Omit for newest VALID build."),
    },
    safe((args) => attachBuild(client, args, tier)),
  );

  server.tool(
    "upload_screenshots",
    "Upload screenshots to a version localization for a device display type (e.g. APP_IPHONE_67). Handles Apple's reserve/upload/commit flow. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      display_type: z.string().describe("Device display type, e.g. APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_129"),
      files: z.array(z.string()).describe("Absolute paths to PNG/JPEG screenshot files, in order"),
      locale: z.string().optional().describe("Locale (e.g. en-US). Default: first/primary locale."),
    },
    safe((args) => uploadScreenshots(client, args, tier)),
  );

  server.tool(
    "release_version",
    "Release an approved version (state PENDING_DEVELOPER_RELEASE) to the public App Store. Outward-facing: requires confirm:true. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      confirm: z.boolean().optional().describe("Must be true to actually release."),
    },
    safe((args) => releaseVersion(client, args, tier)),
  );

  server.tool(
    "manage_phased_release",
    "Control the 7-day phased rollout: start, pause, resume, or complete (release to 100%). Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      action: z.enum(["start", "pause", "resume", "complete"]).describe("Phased release action"),
    },
    safe((args) => managePhasedRelease(client, args, tier)),
  );

  server.tool(
    "list_beta_groups",
    "List TestFlight beta groups for an app. Pro feature.",
    { app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID") },
    safe((args) => listBetaGroups(client, args, tier)),
  );

  server.tool(
    "assign_build_to_group",
    "Assign a build to a TestFlight beta group so testers can install it (defaults to newest processed build). Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      group_id: z.string().describe("Beta group ID (from list_beta_groups)"),
      build_id: z.string().optional().describe("Specific build ID. Omit for newest VALID build."),
    },
    safe((args) => assignBuildToGroup(client, args, tier)),
  );

  server.tool(
    "invite_beta_tester",
    "Invite an external tester by email and add them to a beta group. Apple sends the TestFlight invite. Pro feature.",
    {
      group_id: z.string().describe("Beta group ID (from list_beta_groups)"),
      email: z.string().describe("Tester email address"),
      first_name: z.string().optional().describe("Tester first name"),
      last_name: z.string().optional().describe("Tester last name"),
    },
    safe((args) => inviteBetaTester(client, args, tier)),
  );

  server.tool(
    "build_and_archive",
    "Build, archive, and export a signed .ipa via xcodebuild (requires Xcode on this Mac). Needs a scheme and an ExportOptions.plist. Pro feature.",
    {
      project_path: z.string().describe("Path to .xcodeproj or .xcworkspace"),
      scheme: z.string().describe("Xcode scheme to build"),
      export_options_plist: z.string().describe("Path to ExportOptions.plist (method app-store-connect)"),
      workspace: z.boolean().optional().describe("Set true if project_path is a .xcworkspace"),
      configuration: z.string().optional().describe("Build configuration (default Release)"),
      output_dir: z.string().optional().describe("Output directory (default ./build)"),
    },
    safe((args) => buildAndArchive(args, tier)),
  );

  server.tool(
    "upload_binary",
    "Upload a signed .ipa to App Store Connect via altool, using your API key. Outward-facing: requires confirm:true. Pro feature.",
    {
      ipa_path: z.string().describe("Absolute path to the .ipa to upload"),
      platform: z.string().optional().describe("Platform: ios, macos, or tvos (default ios)"),
      confirm: z.boolean().optional().describe("Must be true to actually upload."),
    },
    safe((args) => uploadBinary({ keyId: config.keyId, issuerId: config.issuerId }, args, tier)),
  );

  server.tool(
    "set_age_rating",
    "Set the app's age-rating content declarations (Apple computes 4+/9+/12+/17+). Pass a declarations map, e.g. { medicalOrTreatmentInformation: \"INFREQUENT_OR_MILD\" }. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      declarations: z
        .record(z.string(), z.union([z.string(), z.boolean()]))
        .describe("Map of declaration key to value. Frequency keys take NONE/INFREQUENT_OR_MILD/FREQUENT_OR_INTENSE (also INFREQUENT/FREQUENT for the few keys Apple uses those on); capability keys take true/false."),
    },
    safe((args) => setAgeRating(client, args, tier)),
  );

  server.tool(
    "set_privacy_nutrition",
    "Configure the App Privacy nutrition label. Apple does not expose this via API; returns the exact steps + deep link. Pass data_not_collected:true for the 'Data Not Collected' path. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      data_not_collected: z.boolean().optional().describe("Set true if the app collects no data at all."),
    },
    safe((args) => setPrivacyNutrition(args, tier)),
  );

  server.tool(
    "set_eu_trader_status",
    "Declare EU Digital Services Act trader status. Not API-addressable; returns the exact steps + deep link. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
    },
    safe((args) => setEUTraderStatus(args, tier)),
  );

  server.tool(
    "create_subscription",
    "Create (idempotently) an auto-renewable subscription inside a group, with USA price and an optional free trial. Sets territory availability automatically. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      group_reference_name: z.string().describe("Subscription group reference name (created if absent)"),
      group_display_name: z.string().describe("Customer-facing group name"),
      product_id: z.string().describe("Subscription product ID, e.g. com.app.plus.monthly"),
      reference_name: z.string().describe("Internal reference name"),
      display_name: z.string().describe("Customer-facing name (max 30 chars)"),
      description: z.string().describe("Customer-facing description (max 45 chars)"),
      period: z.enum(["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"]).describe("Billing period"),
      price_usd: z.number().describe("USA price in dollars, e.g. 4.99"),
      free_trial: z
        .enum(["THREE_DAYS", "ONE_WEEK", "TWO_WEEKS", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"])
        .optional()
        .describe("Free-trial length. Omit for no trial."),
      locale: z.string().optional().describe("Localization locale (default en-US)"),
      group_level: z.number().optional().describe("Rank within the group (1 = top tier; default 1). Higher-value plans get a lower number."),
      family_sharable: z.boolean().optional().describe("Allow Family Sharing of this subscription (default false)."),
      review_note: z.string().optional().describe("Notes for App Review: how to reach the paywall, test instructions"),
    },
    safe((args) => createSubscription(client, args, tier)),
  );

  server.tool(
    "create_iap",
    "Create (idempotently) a one-time in-app purchase (non-consumable or consumable) with USA price. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      product_id: z.string().describe("IAP product ID, e.g. com.app.lifetime"),
      reference_name: z.string().describe("Internal reference name"),
      display_name: z.string().describe("Customer-facing name (max 30 chars)"),
      description: z.string().describe("Customer-facing description (max 45 chars)"),
      type: z.enum(["NON_CONSUMABLE", "CONSUMABLE"]).describe("Purchase type"),
      price_usd: z.number().describe("USA price in dollars, e.g. 59.99"),
      locale: z.string().optional().describe("Localization locale (default en-US)"),
      family_sharable: z.boolean().optional().describe("Allow Family Sharing of this purchase (default false)."),
      review_note: z.string().optional().describe("Notes for App Review: how to reach the paywall, test instructions"),
    },
    safe((args) => createIAP(client, args, tier)),
  );

  server.tool(
    "set_iap_review_screenshot",
    "Upload the App Review screenshot a subscription or in-app purchase needs to leave MISSING_METADATA. Resolves the product by product_id automatically. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      product_id: z.string().describe("Product ID of the subscription or IAP"),
      file: z.string().describe("Absolute path to a PNG/JPEG review screenshot"),
    },
    safe((args) => setIapReviewScreenshot(client, args, tier)),
  );

  server.tool(
    "set_app_metadata",
    "Set submission-required app basics: primary/secondary category (appCategory ids like HEALTH_AND_FITNESS), copyright, content-rights declaration, and export compliance (encryption). Each applied only if provided. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      primary_category: z.string().optional().describe("Primary appCategory id, e.g. HEALTH_AND_FITNESS"),
      secondary_category: z.string().optional().describe("Secondary appCategory id"),
      copyright: z.string().optional().describe("Copyright line, e.g. 2026 Povilas Konopackas"),
      content_rights: z
        .enum(["DOES_NOT_USE_THIRD_PARTY_CONTENT", "USES_THIRD_PARTY_CONTENT"])
        .optional()
        .describe("Content-rights declaration"),
      uses_non_exempt_encryption: z
        .boolean()
        .optional()
        .describe("Export compliance: true if the app uses non-exempt encryption (most apps: false)"),
    },
    safe((args) => setAppMetadata(client, args, tier)),
  );

  server.tool(
    "set_app_price",
    "Set the app's base price by creating its price schedule (USA base, auto-equalized). price_usd: 0 for free. Required before submission. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      price_usd: z.number().describe("0 for a free app, or a USA price tier in dollars"),
    },
    safe((args) => setAppPrice(client, args, tier)),
  );

  server.tool(
    "set_review_contact",
    "Set the App Review contact and optional demo account on the editable version. Required before submission. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      first_name: z.string().describe("Contact first name"),
      last_name: z.string().describe("Contact last name"),
      phone: z.string().describe("Contact phone (with country code)"),
      email: z.string().describe("Contact email"),
      notes: z.string().optional().describe("Notes for App Review (how to test, etc.)"),
      demo_account_name: z.string().optional().describe("Demo account username, if the app needs a login"),
      demo_account_password: z.string().optional().describe("Demo account password"),
    },
    safe((args) => setReviewContact(client, args, tier)),
  );

  server.tool(
    "set_app_availability",
    "Set the app's country/region availability. By default makes it available in ALL App Store territories and auto-includes future ones; pass a territories subset to restrict. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      territories: z
        .array(z.string())
        .optional()
        .describe('Territory ids to enable, e.g. ["USA","GBR"]. Omit for all territories.'),
      available_in_new_territories: z
        .boolean()
        .optional()
        .describe("Auto-include future new territories (default true)"),
    },
    safe((args) => setAppAvailability(client, args, tier)),
  );

  server.tool(
    "setup_app_store_signing",
    "Prepare App Store binary signing without the cloud-signing permission many API keys lack: downloads the app's IOS_APP_STORE provisioning profiles (app + extensions), installs them, and writes a manual-signing ExportOptions.plist for build_and_archive. Needs an Apple Distribution certificate already in the keychain. Pro feature.",
    {
      app_id: z.string().regex(/^\d+$/, "App ID must be numeric").describe("App Store Connect app ID"),
      output_plist: z.string().optional().describe("Where to write ExportOptions.plist (default ./ExportOptions.plist)"),
    },
    safe((args) => setupAppStoreSigning(client, args, tier)),
  );

  // --- Prompts (slash commands in Claude Desktop / Code) ---
  const prompts = registerPrompts(server);
  console.error(
    `asc-mcp: ${prompts.length} prompt(s) registered: ${prompts.map((p) => "/" + p.name).join(", ")}`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Sampling/Elicitation capability is only known after initialize; per-tool
  // degradation handles the mismatch (see triage_reviews + draft_review_response).
}

function dispatchCli(argv: string[]): number | null {
  const cmd = argv[2];
  if (!cmd) return null;
  if (cmd === "install-skill") return installSkill();
  if (cmd === "uninstall-skill") return uninstallSkill();
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(SERVER_VERSION);
    return 0;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(`asc-mcp ${SERVER_VERSION}

Usage:
  asc-mcp                  Run as an MCP server on stdio (for Claude Desktop/Code).
  asc-mcp init             Auto-detect your .p8 and print a paste-ready MCP config.
  asc-mcp init --write     Same, but write the config into your client file directly.
  asc-mcp doctor           Diagnose setup: key, Issuer ID, live connection, license.
  asc-mcp install-skill    Install the asc-review-triage Claude Skill.
  asc-mcp uninstall-skill  Remove the asc-review-triage Claude Skill.
  asc-mcp version          Print version.
  asc-mcp help             This help.`);
    return 0;
  }
  return null;
}

if (process.argv[2] === "init") {
  runInit(process.argv.includes("--write"))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("init failed:", err);
      process.exit(1);
    });
} else if (process.argv[2] === "doctor") {
  runDoctor()
    .then((report) => {
      console.log(formatDoctor(report));
      process.exit(report.healthy ? 0 : 1);
    })
    .catch((err) => {
      console.error("doctor failed:", err);
      process.exit(1);
    });
} else {
  const cliResult = dispatchCli(process.argv);
  if (cliResult !== null) {
    process.exit(cliResult);
  }
  bootstrap();
}

function bootstrap() {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
