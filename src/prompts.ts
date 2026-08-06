/**
 * MCP Prompts for @pofky/asc-mcp.
 *
 * Prompts appear as slash commands in Claude Desktop and Claude Code.
 * Each prompt seeds the conversation with a message that coaches Claude
 * on the exact ASC tool sequence to run. This is the "procedural
 * knowledge" layer competing MCPs skip.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface PromptRegistration {
  name: string;
  title: string;
  description: string;
}

const APP_ID_SCHEMA = z
  .string()
  .regex(/^\d+$/, "App ID must be numeric. Use `list_apps` if you don't know it.")
  .describe("App Store Connect app ID, numeric (use list_apps if unknown)");

export function registerPrompts(server: McpServer): PromptRegistration[] {
  const registered: PromptRegistration[] = [];

  const start = server.registerPrompt(
    "asc-start",
    {
      title: "Get started (new users start here)",
      description:
        "Zero-to-oriented for a first-time user: verifies the connection with asc_setup_check, lists your apps, explains what this MCP can and cannot do, and recommends the right next step for your situation. No App Store Connect knowledge assumed.",
    },
    () => ({
      description: "Onboarding for a new asc-mcp user",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "I'm new to asc-mcp, an MCP server for App Store Connect. Get me oriented. Do this in order and keep it friendly and concise:",
              "",
              "1. Call `asc_setup_check`. If anything is [FAIL], stop and walk me through the printed fix (most often a wrong Issuer ID, or a .p8 that is not where the tool looks). Do not continue until the connection is OK. A [WARN] about the license is not a failure: the free tier works, so carry on.",
              "2. Call `list_apps` and show me my apps with their IDs.",
              "3. Call `asc_guide` with `topic: \"overview\"` and summarize, in plain language, the 3 to 4 things I'm most likely to want: ship a first app, ship an update, handle reviews, manage IAP/subscriptions.",
              "4. Tell me clearly what is FREE (reading: apps, status, guide) versus PRO (reviews and sales data, and anything that writes: editing metadata, screenshots, builds, submit, IAP/subs) so I know when a paywall will appear and why.",
              "5. Mention once, without pushing it, that `asc_start_trial` unlocks everything for 7 days with no card and takes effect immediately in this session. Do not call it yourself: it needs my real email address, so ask me only if I say I want it.",
              "6. Recommend ONE concrete next step based on what you saw: if I have a live app, offer a `release_preflight` or weekly review; if I have a draft app, point me at `asc_guide topic:first-app`; if I have no apps, tell me an app record must be created in the website first.",
              "",
              "Never assume I know App Store Connect jargon. Define terms the first time you use them.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-start",
    title: start.title ?? "",
    description: start.description ?? "",
  });

  const weekly = server.registerPrompt(
    "asc-weekly-review",
    {
      title: "Weekly App Store review",
      description:
        "One-click weekly summary across all your App Store Connect apps: version status, new low-rating reviews in the last 7 days, rejections, and action items. Calls daily_briefing then list_reviews (rating<=3) and synthesizes.",
    },
    () => ({
      description: "Weekly review across all apps",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Give me a weekly App Store review across all my apps. Use the asc-mcp tools in this exact order and present a single concise summary at the end:",
              "",
              "1. Call `daily_briefing` with `days: 7` to get the situational overview (review status, rejections, action items).",
              "2. Call `list_apps` to get the full list of app IDs if the briefing did not cover every app.",
              "3. For each app that has `status: in_review` or that the briefing flagged, call `review_status` to confirm the current state.",
              "4. For each app, call `list_reviews` with `rating: 3`, `sort: newest`, `limit: 20` to pull low-rating reviews from the last 7 days.",
              "5. Cluster low-rating reviews by theme (bugs, pricing, missing feature, etc.). Keep to 3 to 5 clusters.",
              "6. Produce a final digest with: apps in review, apps rejected, top 3 review themes with counts, and a 3-bullet action list for the coming week.",
              "",
              "Do not invent numbers. If a tool fails, say so and continue with the rest.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-weekly-review",
    title: weekly.title ?? "",
    description: weekly.description ?? "",
  });

  const audit = server.registerPrompt(
    "asc-rejection-audit",
    {
      title: "Pre-submission rejection audit",
      description:
        "Catch likely rejection causes before you submit. Runs release_preflight, then metadata_diff, then review_status, and reads results against the top 2026 rejection drivers (guideline 2.3 metadata, 4.0 design, privacy-AI 5.1.2).",
      argsSchema: { app_id: APP_ID_SCHEMA },
    },
    ({ app_id }) => ({
      description: `Rejection audit for app ${app_id}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Run a pre-submission rejection audit for App Store Connect app ${app_id}. Use the asc-mcp tools in this order:`,
              "",
              `1. Call \`release_preflight\` with \`app_id: "${app_id}"\` to audit metadata, character limits, screenshots, and build status.`,
              `2. Call \`metadata_diff\` with \`app_id: "${app_id}"\` to see exactly what is changing between the live and pending version across all locales.`,
              `3. Call \`review_status\` with \`app_id: "${app_id}"\` to confirm the current submission state.`,
              "",
              "Read the combined output against the top 2026 rejection drivers:",
              "- Guideline 2.3 (inaccurate metadata: broken links, stale screenshots, placeholder text)",
              "- Guideline 4.0 (design: minimum content, broken flows, missing signup)",
              "- Guideline 5.1.2 (data use, privacy-AI: missing SDK disclosures, tracking permissions)",
              "",
              "Produce a report with three sections: (a) Blocking issues (fix before submit), (b) Likely-flagged items (judgment call), (c) Safe. Quote exact metadata lines that trigger each concern.",
              "",
              "Do not invent rejection reasons. If preflight finds zero issues and metadata_diff is clean, say 'no blocking issues found'.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-rejection-audit",
    title: audit.title ?? "",
    description: audit.description ?? "",
  });

  const goNoGo = server.registerPrompt(
    "asc-release-go-no-go",
    {
      title: "Release go/no-go",
      description:
        "Decide whether to ship a release today. Combines release_preflight, review_status, metadata_diff, and competitor_snapshot to produce a single GO or NO-GO recommendation with reasoning.",
      argsSchema: { app_id: APP_ID_SCHEMA },
    },
    ({ app_id }) => ({
      description: `Go/no-go decision for app ${app_id}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Decide whether to ship a release today for App Store Connect app ${app_id}. Use the asc-mcp tools in this order:`,
              "",
              `1. Call \`release_preflight\` with \`app_id: "${app_id}"\`.`,
              `2. Call \`review_status\` with \`app_id: "${app_id}"\`.`,
              `3. Call \`metadata_diff\` with \`app_id: "${app_id}"\`.`,
              `4. Call \`app_details\` with \`app_id: "${app_id}"\` to read category and name.`,
              "5. Call `competitor_snapshot` with the same category's top two competitors (use what you know) to see if anyone else just shipped a bigger release today.",
              "",
              "Produce a single GO or NO-GO with three supporting bullets:",
              "- Preflight verdict (blocking issues y/n)",
              "- Queue verdict (is the existing version still in review? if yes, hold)",
              "- Market window (did a big competitor ship today? if yes, consider holding one day)",
              "",
              "Be direct. If unsure, say NO-GO and explain why. Do not hedge.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-release-go-no-go",
    title: goNoGo.title ?? "",
    description: goNoGo.description ?? "",
  });

  const ship = server.registerPrompt(
    "asc-ship-release",
    {
      title: "Ship a release end to end",
      description:
        "Drive a full release from the current state to submitted: create/locate the editable version, push metadata, attach the newest build, upload screenshots if provided, run preflight, and submit. Asks before every outward-facing step. Pro feature.",
      argsSchema: { app_id: APP_ID_SCHEMA },
    },
    ({ app_id }) => ({
      description: `Ship a release for app ${app_id}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Ship a release for App Store Connect app ${app_id}. Use the asc-mcp tools in this order, and STOP to confirm with me before any outward-facing step (submit, upload, release):`,
              "",
              `1. Call \`app_details\` with \`app_id: "${app_id}"\` to read the current version + state.`,
              "2. If there is no editable version (current one is in review or live), call `create_version` with the next version number.",
              "3. If I gave you metadata to change, call `update_version_metadata` (it validates Apple's character limits and refuses over-limit writes).",
              "4. Call `list_builds`. If the build I want is VALID, call `attach_build`. If no build exists, tell me to upload one (or use build_and_archive + upload_binary if I have an Xcode project).",
              "5. If I provided screenshot files, call `upload_screenshots` for each display type.",
              `6. Call \`release_preflight\` with \`app_id: "${app_id}"\` and show me any blocking issues.`,
              "7. Only after I confirm, call `submit_for_review` with `confirm: true`.",
              "8. After approval, ask whether to `release_version` (confirm:true) or start `manage_phased_release`.",
              "",
              "Never call submit_for_review, upload_binary, or release_version without my explicit confirmation in the chat. Report the result of each step before moving on.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-ship-release",
    title: ship.title ?? "",
    description: ship.description ?? "",
  });

  const firstApp = server.registerPrompt(
    "asc-first-app",
    {
      title: "Ship a brand-new app's first release (1.0)",
      description:
        "Drive a never-released app from an existing app record to submitted 1.0, handling every first-time-only Apple constraint and stopping at each manual ASC-website step (privacy label, trader status, first IAPs). Calls asc_guide first, then the metadata/pricing/age/contact/build/screenshot/preflight chain. Pro feature.",
      argsSchema: { app_id: APP_ID_SCHEMA },
    },
    ({ app_id }) => ({
      description: `First release for app ${app_id}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Ship the FIRST release (1.0) for App Store Connect app ${app_id}. This is the hardest flow because of first-time-only Apple constraints. Follow this exactly and STOP at every MANUAL step to hand me the deep link and wait, and before any outward-facing call (submit, upload, release):`,
              "",
              "1. Call `asc_guide` with `topic: \"first-app\"` and follow that playbook as the source of truth. Re-read it if you get confused mid-flow.",
              `2. Call \`app_details\` with \`app_id: "${app_id}"\`. If the app record does not exist, STOP: it must be created in the ASC website (POST /v1/apps is forbidden for API keys).`,
              `3. Set up submission basics: \`set_app_metadata\` (category, copyright, content rights, export compliance), \`set_app_price\`, \`set_app_availability\`, \`set_age_rating\` (pass only the declarations that apply), \`set_review_contact\`.`,
              "4. `update_version_metadata` for description/keywords/promo/URLs/name/subtitle. Expect what's-new to be dropped on a 1.0 (no prior release); that is normal.",
              "5. Ensure a VALID build is attached: `list_builds`, then `attach_build`. If none exists, drive the binary flow (asc_guide topic:binary) or tell me to upload one.",
              "6. `upload_screenshots` for each display type I provide.",
              "7. MANUAL: run `set_privacy_nutrition` and `set_eu_trader_status`, give me the deep links, and WAIT for me to confirm I set them in the website.",
              "8. If the app has in-app purchases or subscriptions, create them (`create_iap` / `create_subscription` + `set_iap_review_screenshot`). Then MANUAL: the FIRST products must be submitted WITH the version in the ASC website. Give me those steps and do NOT try to submit the version alone.",
              `9. Call \`release_preflight\` with \`app_id: "${app_id}"\` and fix every FAIL before continuing.`,
              "10. Only after I confirm (and only if no first-IAP block applies), call `submit_for_review` with `confirm: true`.",
              "11. After approval, ask whether to `release_version` (confirm:true) or `manage_phased_release` start.",
              "",
              "Never fake a manual step. If the API can't do something, hand me the exact website steps and the deep link, then wait.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
  registered.push({
    name: "asc-first-app",
    title: firstApp.title ?? "",
    description: firstApp.description ?? "",
  });

  return registered;
}
