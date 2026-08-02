import type { ASCClient } from "../client.js";
import { fetchAppInfos, pickAuditAppInfo } from "../app-info.js";
import type { Tier } from "../types.js";
import { UPGRADE_URL } from "../gate.js";

interface VersionAttributes {
  versionString: string;
  platform: string;
  appStoreState: string;
  createdDate: string;
}

interface LocalizationAttributes {
  locale: string;
  description: string | null;
  keywords: string | null;
  whatsNew: string | null;
  promotionalText: string | null;
  marketingUrl: string | null;
  supportUrl: string | null;
}

interface ScreenshotSetAttributes {
  screenshotDisplayType: string;
}

interface BuildAttributes {
  version: string;
  processingState: string;
  uploadedDate: string;
}

// Apple's metadata character limits
const LIMITS = {
  description: { min: 10, max: 4000 },
  keywords: { max: 100 },
  whatsNew: { max: 4000 },
  promotionalText: { max: 170 },
  appName: { max: 30 },
  subtitle: { max: 30 },
} as const;

// Required screenshot display types per device class
const REQUIRED_SCREENSHOT_TYPES = [
  "APP_IPHONE_67",     // iPhone 6.7" (required)
  "APP_IPHONE_65",     // iPhone 6.5" (required)
] as const;

interface CheckResult {
  status: "pass" | "warn" | "fail";
  message: string;
}

export const releasePreflightDefinition = {
  name: "release_preflight",
  description:
    "Run a pre-submission audit on a pending app version. Checks metadata completeness, character limits, screenshot coverage, build status, and common rejection causes. Returns a pass/warn/fail report.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description:
          "The App Store Connect app ID. Use list_apps to find it.",
      },
    },
    required: ["app_id"],
  },
};

export async function releasePreflight(
  client: ASCClient,
  args: { app_id: string },
  tier: Tier,
): Promise<string> {
  if (tier !== "pro") {
    return (
      "Release preflight audit requires a Pro license ($9/mo).\n" +
      "Get your license at: " + UPGRADE_URL + "\n\n" +
      "Set ASC_LICENSE_KEY in your MCP server config to unlock."
    );
  }
  const checks: CheckResult[] = [];

  // 1. Get latest version
  const versionsResponse = await client.get<VersionAttributes>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    {
      "fields[appStoreVersions]":
        "versionString,platform,appStoreState,createdDate",
      limit: "5",
    },
  );

  const versions = Array.isArray(versionsResponse.data)
    ? versionsResponse.data
    : [versionsResponse.data];

  if (versions.length === 0) {
    return "No versions found for this app. Nothing to preflight.";
  }

  // Find the editable version (not yet live)
  const editableStates = [
    "PREPARE_FOR_SUBMISSION",
    "READY_FOR_REVIEW",
    "WAITING_FOR_REVIEW",
    "DEVELOPER_REJECTED",
  ];
  const pendingVersion = versions.find((v) =>
    editableStates.includes(v.attributes.appStoreState),
  );
  const targetVersion = pendingVersion || versions[0];
  const versionId = targetVersion.id;
  const versionString = targetVersion.attributes.versionString;
  const versionState = targetVersion.attributes.appStoreState;

  let result = `## Release Preflight: v${versionString}\n\n`;
  result += `**State**: ${versionState}\n`;
  result += `**Platform**: ${targetVersion.attributes.platform}\n\n`;

  if (!pendingVersion) {
    checks.push({
      status: "warn",
      message:
        "No pending version found. Auditing the latest version instead. Create a new version in App Store Connect if you intend to submit an update.",
    });
  }

  // 2. Get localizations for this version
  let localizations: Array<{ id: string; attributes: LocalizationAttributes }> = [];
  try {
    const locResponse = await client.get<LocalizationAttributes>(
      `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
      {
        "fields[appStoreVersionLocalizations]":
          "locale,description,keywords,whatsNew,promotionalText,marketingUrl,supportUrl",
        limit: "30",
      },
    );
    localizations = Array.isArray(locResponse.data)
      ? locResponse.data
      : [locResponse.data];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      status: "fail",
      message: `Could not fetch localizations: ${msg.slice(0, 200)}`,
    });
  }

  // 3. Check each localization
  for (const loc of localizations) {
    const a = loc.attributes;
    const locale = a.locale;

    // Description required
    if (!a.description || a.description.trim().length === 0) {
      checks.push({
        status: "fail",
        message: `[${locale}] Description is EMPTY. Required for submission.`,
      });
    } else if (a.description.length < LIMITS.description.min) {
      checks.push({
        status: "fail",
        message: `[${locale}] Description too short (${a.description.length} chars, min ${LIMITS.description.min}).`,
      });
    } else if (a.description.length > LIMITS.description.max) {
      checks.push({
        status: "fail",
        message: `[${locale}] Description too long (${a.description.length}/${LIMITS.description.max} chars).`,
      });
    } else {
      checks.push({
        status: "pass",
        message: `[${locale}] Description OK (${a.description.length}/${LIMITS.description.max} chars).`,
      });
    }

    // Keywords
    if (a.keywords && a.keywords.length > LIMITS.keywords.max) {
      checks.push({
        status: "fail",
        message: `[${locale}] Keywords too long (${a.keywords.length}/${LIMITS.keywords.max} chars).`,
      });
    } else if (!a.keywords || a.keywords.trim().length === 0) {
      checks.push({
        status: "warn",
        message: `[${locale}] Keywords empty. Not required but strongly recommended for discoverability.`,
      });
    } else {
      checks.push({
        status: "pass",
        message: `[${locale}] Keywords OK (${a.keywords.length}/${LIMITS.keywords.max} chars).`,
      });
    }

    // What's New (required for updates, not for first version)
    if (versionString !== "1.0" && versionString !== "1.0.0") {
      if (!a.whatsNew || a.whatsNew.trim().length === 0) {
        checks.push({
          status: "fail",
          message: `[${locale}] "What's New" is EMPTY. Required for updates.`,
        });
      } else if (a.whatsNew.length > LIMITS.whatsNew.max) {
        checks.push({
          status: "fail",
          message: `[${locale}] "What's New" too long (${a.whatsNew.length}/${LIMITS.whatsNew.max}).`,
        });
      } else {
        checks.push({
          status: "pass",
          message: `[${locale}] "What's New" OK (${a.whatsNew.length} chars).`,
        });
      }
    }

    // Promotional text
    if (a.promotionalText && a.promotionalText.length > LIMITS.promotionalText.max) {
      checks.push({
        status: "fail",
        message: `[${locale}] Promotional text too long (${a.promotionalText.length}/${LIMITS.promotionalText.max}).`,
      });
    }

    // Support URL (required)
    if (!a.supportUrl || a.supportUrl.trim().length === 0) {
      checks.push({
        status: "fail",
        message: `[${locale}] Support URL is EMPTY. Required for submission.`,
      });
    }
  }

  if (localizations.length === 0) {
    checks.push({
      status: "fail",
      message: "No localizations found. At least one locale is required.",
    });
  }

  // 4. Check screenshot sets (via localizations)
  try {
    let totalScreenshotSets = 0;
    const allDisplayTypes = new Set<string>();

    for (const loc of localizations.slice(0, 5)) {
      try {
        const setsResponse = await client.get<ScreenshotSetAttributes>(
          `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
          {
            "fields[appScreenshotSets]": "screenshotDisplayType",
            limit: "20",
          },
        );
        const sets = Array.isArray(setsResponse.data)
          ? setsResponse.data
          : setsResponse.data ? [setsResponse.data] : [];
        totalScreenshotSets += sets.length;
        for (const s of sets) {
          allDisplayTypes.add(s.attributes.screenshotDisplayType);
        }
      } catch {
        // Individual locale screenshot check failed, continue
      }
    }

    if (totalScreenshotSets === 0 && localizations.length > 0) {
      checks.push({
        status: "fail",
        message: "No screenshot sets found in any locale. Screenshots are required for submission.",
      });
    } else if (totalScreenshotSets > 0) {
      checks.push({
        status: "pass",
        message: `${totalScreenshotSets} screenshot set(s) found across ${Math.min(localizations.length, 5)} locale(s).`,
      });

      for (const required of REQUIRED_SCREENSHOT_TYPES) {
        if (!allDisplayTypes.has(required)) {
          checks.push({
            status: "warn",
            message: `Missing screenshot set for ${required}. May be required depending on device support.`,
          });
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      status: "warn",
      message: `Could not check screenshots: ${msg.slice(0, 200)}`,
    });
  }

  // 5. Check build attachment
  try {
    const buildResponse = await client.get<BuildAttributes>(
      `/v1/appStoreVersions/${versionId}/build`,
      {
        "fields[builds]": "version,processingState,uploadedDate",
      },
    );
    const build = Array.isArray(buildResponse.data)
      ? buildResponse.data[0]
      : buildResponse.data;

    if (!build) {
      checks.push({
        status: "fail",
        message: "No build attached to this version. Upload a build first.",
      });
    } else {
      const state = build.attributes.processingState;
      if (state === "VALID") {
        checks.push({
          status: "pass",
          message: `Build ${build.attributes.version} attached and valid.`,
        });
      } else if (state === "PROCESSING") {
        checks.push({
          status: "warn",
          message: `Build ${build.attributes.version} is still processing. Wait before submitting.`,
        });
      } else {
        checks.push({
          status: "fail",
          message: `Build ${build.attributes.version} state: ${state}. May not be submittable.`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      status: "warn",
      message: `Could not check build: ${msg.slice(0, 200)}`,
    });
  }

  // 5b. Age rating configured (a fresh app has all content declarations null).
  try {
    const { infos, included } = await fetchAppInfos(client, args.app_id, {
      include: "ageRatingDeclaration",
    });
    const auditInfo = pickAuditAppInfo(infos);
    const ardId = auditInfo?.raw.relationships?.ageRatingDeclaration?.data?.id;
    const ard =
      included?.find((x) => x.type === "ageRatingDeclarations" && (!ardId || x.id === ardId))?.attributes ?? {};
    const declared = Object.entries(ard).filter(
      ([k, v]) => v !== null && v !== undefined && !/^(ageRatingOverride|koreaAgeRatingOverride)/.test(k),
    );
    checks.push(
      declared.length
        ? { status: "pass", message: "Age rating configured." }
        : { status: "fail", message: "Age rating not configured. Run set_age_rating before submission." },
    );
  } catch {
    // non-fatal
  }

  // 5c. Privacy policy URL (app-level localization).
  try {
    const { infos } = await fetchAppInfos(client, args.app_id);
    const appInfo = pickAuditAppInfo(infos);
    if (appInfo) {
      const ilRes = await client.get<{ locale: string; privacyPolicyUrl: string | null }>(
        `/v1/appInfos/${appInfo.id}/appInfoLocalizations`,
        { "fields[appInfoLocalizations]": "locale,privacyPolicyUrl", limit: "30" },
      );
      const ils = (Array.isArray(ilRes.data) ? ilRes.data : [ilRes.data]).filter(Boolean);
      const anyUrl = ils.some((l) => l.attributes.privacyPolicyUrl && l.attributes.privacyPolicyUrl.trim().length);
      checks.push(
        anyUrl
          ? { status: "pass", message: "Privacy policy URL set." }
          : { status: "warn", message: "No privacy policy URL set. Required for apps with accounts or data collection; set via update_version_metadata privacy_policy_url." },
      );
    }
  } catch {
    // non-fatal
  }

  // 5d. In-app purchase / subscription readiness.
  try {
    const iapRes = await client.get<{ productId: string; state: string }>(
      `/v1/apps/${args.app_id}/inAppPurchasesV2`,
      { "fields[inAppPurchases]": "productId,state", limit: "100" },
    );
    const subRes = await client.get<Record<string, never>>(
      `/v1/apps/${args.app_id}/subscriptionGroups`,
      { include: "subscriptions", limit: "25" },
    );
    const subs = ((subRes as { included?: Array<{ type: string; attributes: { productId: string; state: string } }> }).included ?? [])
      .filter((x) => x.type === "subscriptions")
      .map((s) => ({ productId: s.attributes.productId, state: s.attributes.state }));
    const iaps = (Array.isArray(iapRes.data) ? iapRes.data : [iapRes.data])
      .filter(Boolean)
      .map((i) => ({ productId: i.attributes.productId, state: i.attributes.state }));
    const ready = new Set(["READY_TO_SUBMIT", "APPROVED", "WAITING_FOR_REVIEW", "IN_REVIEW", "DEVELOPER_ACTION_NEEDED"]);
    for (const p of [...iaps, ...subs]) {
      checks.push(
        ready.has(p.state)
          ? { status: "pass", message: `Product ${p.productId} is ${p.state}.` }
          : { status: "fail", message: `Product ${p.productId} is ${p.state} (needs localization, availability, price in all territories, and a review screenshot).` },
      );
    }
  } catch {
    // non-fatal
  }

  // 5e. Primary category, base price, and review contact, all required before
  // submission and all API-addressable (set_app_metadata / set_app_price /
  // set_review_contact). Track product/build facts for the manual-steps section.
  let readyProducts: string[] = [];
  let hasBuild = false;
  const editableForSubmit = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"].includes(versionState);
  try {
    const { included: inc = [] } = await fetchAppInfos(client, args.app_id, {
      include: "primaryCategory",
    });
    checks.push(
      inc.some((x) => x.type === "appCategories")
        ? { status: "pass", message: "Primary category set." }
        : { status: "fail", message: "Primary category not set. Run set_app_metadata with primary_category." },
    );
  } catch { /* non-fatal */ }
  try {
    const priceRes = await client.get<Record<string, never>>(`/v1/apps/${args.app_id}/appPriceSchedule`).catch(() => null);
    checks.push(
      priceRes && (priceRes as { data?: unknown }).data
        ? { status: "pass", message: "Price schedule set." }
        : { status: "fail", message: "No price schedule. Run set_app_price (price_usd: 0 for free)." },
    );
  } catch { /* non-fatal */ }
  try {
    const rd = await client.get<{ contactEmail: string | null }>(`/v1/appStoreVersions/${versionId}/appStoreReviewDetail`).catch(() => null);
    const email = rd && (rd as { data?: { attributes?: { contactEmail?: string | null } } }).data?.attributes?.contactEmail;
    checks.push(
      email
        ? { status: "pass", message: "App Review contact set." }
        : { status: "warn", message: "App Review contact not set. Run set_review_contact (recommended; reviewers use it if they have questions)." },
    );
  } catch { /* non-fatal */ }

  // Re-read product + build facts for the manual-steps section (cheap, exact).
  let hasSubscriptions = false;
  try {
    const iapRes = await client.get<{ productId: string; state: string }>(`/v1/apps/${args.app_id}/inAppPurchasesV2`, { "fields[inAppPurchases]": "productId,state", limit: "100" });
    const subRes = await client.get<Record<string, never>>(`/v1/apps/${args.app_id}/subscriptionGroups`, { include: "subscriptions", limit: "25" });
    const subs = ((subRes as { included?: Array<{ type: string; attributes: { productId: string; state: string } }> }).included ?? []).filter((x) => x.type === "subscriptions");
    hasSubscriptions = subs.length > 0;
    const all = [
      ...(Array.isArray(iapRes.data) ? iapRes.data : [iapRes.data]).filter(Boolean).map((i) => ({ productId: i.attributes.productId, state: i.attributes.state })),
      ...subs.map((s) => ({ productId: s.attributes.productId, state: s.attributes.state })),
    ];
    readyProducts = all.filter((p) => p.state === "READY_TO_SUBMIT").map((p) => p.productId);
  } catch { /* non-fatal */ }

  // 5e-bis. Guideline 3.1.2: auto-renewable subscriptions require a FUNCTIONAL
  // Terms of Use (EULA) link in the App Description metadata. An in-app link is
  // not enough; Apple auto-rejects without it. This is the single most common
  // first-submission rejection for subscription apps.
  if (hasSubscriptions && localizations.length) {
    const eulaRe = /https?:\/\/\S*(terms|eula|stdeula)/i;
    const missing = localizations.filter((l) => !(l.attributes.description && eulaRe.test(l.attributes.description)));
    if (missing.length) {
      checks.push({
        status: "fail",
        message:
          `Subscriptions present but no Terms of Use (EULA) link in the description for: ${missing.map((l) => l.attributes.locale).join(", ")}. ` +
          `Apple Guideline 3.1.2 auto-rejects this. Append a functional link (your own Terms URL or Apple's standard EULA https://www.apple.com/legal/internet-services/itunes/dev/stdeula/) via update_version_metadata.`,
      });
    } else {
      checks.push({ status: "pass", message: "Terms of Use (EULA) link present in description (required for subscriptions, Guideline 3.1.2)." });
    }
  }
  try {
    const bRes = await client.get<BuildAttributes>(`/v1/appStoreVersions/${versionId}/build`, { "fields[builds]": "version" });
    hasBuild = Boolean(Array.isArray(bRes.data) ? bRes.data[0] : bRes.data);
  } catch { /* non-fatal */ }

  // 5f. Manual steps: things Apple does NOT expose to the API. These are not
  // failures of your setup; they are actions only the App Store Connect website
  // or local Xcode can perform. Listed so "preflight clean" means "ready to
  // finish", not "already submitted".
  const manualSteps: string[] = [];
  if (!hasBuild) {
    manualSteps.push(
      "No build attached. Uploading a binary needs local Xcode: setup_app_store_signing -> build_and_archive -> upload_binary -> attach_build.",
    );
  }
  if (readyProducts.length && editableForSubmit) {
    manualSteps.push(
      `First in-app purchases must be submitted WITH the version in the website (Apple blocks this via API). ` +
      `In App Store Connect open this version, add ${readyProducts.join(", ")} under "In-App Purchases and Subscriptions", ` +
      `then Add for Review -> Submit. After the first release is live, later IAPs submit via the API (submit_for_review).`,
    );
  }
  manualSteps.push(
    "Confirm App Privacy (data-collection nutrition labels) is complete on the App Privacy page. Not API-addressable; see set_privacy_nutrition for the checklist.",
  );
  manualSteps.push(
    "If distributing in the EU, confirm your DSA trader status on the App Information page. Not API-addressable; see set_eu_trader_status.",
  );

  // 6. Compile report
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const passes = checks.filter((c) => c.status === "pass");

  if (fails.length === 0 && warns.length === 0) {
    result += "### PASS: Ready to submit\n\n";
  } else if (fails.length === 0) {
    result += `### PASS (with ${warns.length} warning${warns.length > 1 ? "s" : ""})\n\n`;
  } else {
    result += `### FAIL: ${fails.length} issue${fails.length > 1 ? "s" : ""} must be fixed before submission\n\n`;
  }

  if (fails.length > 0) {
    result += "**Failures (must fix):**\n";
    for (const c of fails) {
      result += `- ${c.message}\n`;
    }
    result += "\n";
  }

  if (warns.length > 0) {
    result += "**Warnings (recommended):**\n";
    for (const c of warns) {
      result += `- ${c.message}\n`;
    }
    result += "\n";
  }

  if (passes.length > 0) {
    result += `**Passing checks:** ${passes.length}\n`;
    for (const c of passes) {
      result += `- ${c.message}\n`;
    }
  }

  if (manualSteps.length > 0) {
    result += "\n**Manual steps to finish (not API-addressable, do these in the website/Xcode):**\n";
    for (const s of manualSteps) {
      result += `- ${s}\n`;
    }
  }

  result += `\n---\nTotal: ${passes.length} pass, ${warns.length} warn, ${fails.length} fail\n`;
  result += `Locales checked: ${localizations.length}\n`;
  if (fails.length === 0) {
    result += "API-addressable setup is complete. Finish the manual steps above, then submit.\n";
  }

  return result;
}
