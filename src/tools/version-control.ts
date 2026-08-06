import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { EDITABLE_VERSION_STATES as EDITABLE } from "../editable.js";

interface VersionAttrs {
  versionString: string;
  appStoreState: string;
  platform: string;
}

type Platform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS";


/**
 * Apple does not let the API bundle an app's FIRST in-app purchases with the
 * version (the API has no shared submission for them). Rather than submit the
 * version alone and orphan the products, return the exact website steps.
 */
function firstIapGuidance(appId: string, products: string[]): string {
  return (
    "Not submitted. Your app's first in-app purchases must be submitted TOGETHER with the app " +
    "version, which Apple only supports in the App Store Connect website (not the API). " +
    "Submitting the version alone would orphan the products, so this stopped instead.\n\n" +
    `Finish in the website (one time):\n` +
    `1. Open https://appstoreconnect.apple.com/apps/${appId}/appstore\n` +
    `2. Open the editable version (1.0).\n` +
    `3. In the "In-App Purchases and Subscriptions" section, select: ${products.join(", ")}.\n` +
    `4. Click "Add for Review", then "Submit for Review" - version + products go together.\n\n` +
    "After this first release is live, future IAPs can be submitted via the API."
  );
}

/** Create a new editable App Store version (the "next version" you edit + submit). */
export async function createVersion(
  client: ASCClient,
  args: { app_id: string; version_string: string; platform?: Platform; copyright?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Creating a new version", "create_version");
  if (gate) return gate;

  const attributes: Record<string, string> = {
    platform: args.platform ?? "IOS",
    versionString: args.version_string,
  };
  if (args.copyright) attributes.copyright = args.copyright;

  let res;
  try {
    res = await client.post<VersionAttrs>("/v1/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes,
        relationships: {
          app: { data: { type: "apps", id: args.app_id } },
        },
      },
    });
  } catch (err) {
    // Apple answers 409 for two very different situations here and an agent
    // needs to know which: the number is taken, or there is already an open
    // version to edit.
    if (!(err instanceof ASCAPIError) || err.status !== 409) throw err;
    const duplicate = /DUPLICATE|previously used/i.test(err.body);
    const badState = /current state/i.test(err.body);
    if (duplicate && badState) {
      return (
        `Cannot create version ${args.version_string}: that number was already used, and this app already has a ` +
        `version open for editing. Edit the open one with update_version_metadata, or pick a higher version number.`
      );
    }
    if (duplicate) {
      return `Version ${args.version_string} was already used for this app. Pick a higher version number.`;
    }
    if (badState) {
      return (
        "Cannot create a new version while the current one is still open or in review. " +
        "Check it with review_status, then edit that version instead of creating another."
      );
    }
    throw err;
  }
  const created = res && !Array.isArray(res.data) ? res.data : null;
  return (
    `Created version ${args.version_string} (${attributes.platform}).` +
    (created ? ` Version ID: ${created.id}` : "") +
    `\n\nEdit it with update_version_metadata, attach a build, then submit_for_review.`
  );
}

/**
 * Submit the app's editable version to App Review via the reviewSubmissions API.
 * Three steps: open a submission, add the version as an item, mark it submitted.
 */
export async function submitForReview(
  client: ASCClient,
  args: { app_id: string; platform?: Platform; confirm?: boolean },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Submitting for review", "submit_for_review");
  if (gate) return gate;

  if (!args.confirm) {
    return (
      "This submits your app to Apple App Review (a real, outward-facing action).\n" +
      "Re-run with confirm: true to proceed."
    );
  }

  const platform: Platform = args.platform ?? "IOS";

  // Find the editable version to submit.
  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState,platform", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const target = versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
  if (!target) {
    return "No editable version to submit. Create one with create_version and attach a build first.";
  }

  // 0. Submit READY_TO_SUBMIT in-app purchases / subscriptions FIRST, before we
  // open the version review. These are NOT reviewSubmission items: IAPs use
  // /v1/inAppPurchaseSubmissions, subscriptions use /v1/subscriptionSubmissions.
  // Doing them first lets us fail safely: an app's FIRST in-app purchases must be
  // bundled with the version in the ASC website (Apple does not support that via
  // the API). If we hit that, we abort WITHOUT submitting the version alone, so
  // the products are never orphaned.
  const productItems: string[] = [];
  const FIRST_IAP_BLOCK = /MUST_BE_SUBMITTED_ON_VERSION/;

  const iapRes = await client.get<{ productId: string; state: string }>(
    `/v1/apps/${args.app_id}/inAppPurchasesV2`,
    { "fields[inAppPurchases]": "productId,state", limit: "100" },
  );
  const grpRes = await client.get<Record<string, never>>(
    `/v1/apps/${args.app_id}/subscriptionGroups`,
    { include: "subscriptions", limit: "25" },
  );
  const subItems = ((grpRes as { included?: Array<{ type: string; id: string; attributes: { productId: string; state: string } }> }).included ?? [])
    .filter((x) => x.type === "subscriptions");

  const pendingIaps = (Array.isArray(iapRes.data) ? iapRes.data : [iapRes.data])
    .filter(Boolean)
    .filter((i) => i.attributes.state === "READY_TO_SUBMIT");
  const pendingSubs = subItems.filter((s) => s.attributes.state === "READY_TO_SUBMIT");

  const submitProduct = async (path: string, relKey: string, relType: string, id: string, label: string) => {
    try {
      await client.post(path, {
        data: { type: path.split("/")[2], relationships: { [relKey]: { data: { type: relType, id } } } },
      });
      productItems.push(label);
      return null;
    } catch (err) {
      if (err instanceof ASCAPIError && FIRST_IAP_BLOCK.test(err.body)) return "first-iap-block";
      return null; // already submitted / not eligible - skip
    }
  };

  for (const iap of pendingIaps) {
    const r = await submitProduct("/v1/inAppPurchaseSubmissions", "inAppPurchaseV2", "inAppPurchases", iap.id, iap.attributes.productId);
    if (r === "first-iap-block") return firstIapGuidance(args.app_id, [...pendingIaps, ...pendingSubs].map((p) => p.attributes.productId));
  }
  for (const s of pendingSubs) {
    const r = await submitProduct("/v1/subscriptionSubmissions", "subscription", "subscriptions", s.id, s.attributes.productId);
    if (r === "first-iap-block") return firstIapGuidance(args.app_id, [...pendingIaps, ...pendingSubs].map((p) => p.attributes.productId));
  }

  // 1. Open a review submission for the app.
  const subRes = await client.post<{ state: string }>("/v1/reviewSubmissions", {
    data: {
      type: "reviewSubmissions",
      attributes: { platform },
      relationships: { app: { data: { type: "apps", id: args.app_id } } },
    },
  });
  const submission = subRes && !Array.isArray(subRes.data) ? subRes.data : null;
  if (!submission) return "Failed to open a review submission.";

  // 2. Add the version as a submission item.
  await client.post("/v1/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
        appStoreVersion: { data: { type: "appStoreVersions", id: target.id } },
      },
    },
  });

  // 3. Mark it submitted.
  await client.patch(`/v1/reviewSubmissions/${submission.id}`, {
    data: {
      type: "reviewSubmissions",
      id: submission.id,
      attributes: { submitted: true },
    },
  });

  return (
    `Submitted version ${target.attributes.versionString} to App Review.\n` +
    `Submission ID: ${submission.id}\n` +
    (productItems.length ? `Included ${productItems.length} product(s): ${productItems.join(", ")}\n` : "") +
    "Typical review time: 24-48 hours. Track with review_status."
  );
}
