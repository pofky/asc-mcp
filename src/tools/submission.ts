import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { fetchAppInfos, pickEditableAppInfo, noEditableAppInfoMessage } from "../app-info.js";

const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

async function editableVersionId(client: ASCClient, appId: string): Promise<{ id: string; version: string } | null> {
  const res = await client.get<{ versionString: string; appStoreState: string }>(
    `/v1/apps/${appId}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState", limit: "5" },
  );
  const versions = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  const v = versions.find((x) => EDITABLE.has(x.attributes.appStoreState));
  return v ? { id: v.id, version: v.attributes.versionString } : null;
}

export interface AppMetadataArgs {
  app_id: string;
  primary_category?: string;
  secondary_category?: string;
  copyright?: string;
  /** DOES_NOT_USE_THIRD_PARTY_CONTENT | USES_THIRD_PARTY_CONTENT */
  content_rights?: "DOES_NOT_USE_THIRD_PARTY_CONTENT" | "USES_THIRD_PARTY_CONTENT";
  /** Export compliance: true if the app uses non-exempt encryption (most apps: false). */
  uses_non_exempt_encryption?: boolean;
}

/**
 * Set the submission-required app basics that App Review checks but which are
 * easy to miss: primary/secondary category, copyright line, content-rights
 * declaration, and export-compliance (encryption). Each is applied only if
 * provided. Categories are appCategory ids like HEALTH_AND_FITNESS.
 */
export async function setAppMetadata(
  client: ASCClient,
  args: AppMetadataArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting app submission metadata", "set_app_metadata");
  if (gate) return gate;
  const changes: string[] = [];

  // Categories live on appInfos relationships.
  if (args.primary_category || args.secondary_category) {
    // An app in review or already live also has a locked appInfo, and Apple
    // returns that one first, so pick the editable record explicitly.
    const { infos } = await fetchAppInfos(client, args.app_id);
    const appInfo = pickEditableAppInfo(infos);
    if (!appInfo) return noEditableAppInfoMessage(infos, "app categories");
    const infoId = appInfo.id;
    const rels: Record<string, unknown> = {};
    if (args.primary_category) rels.primaryCategory = { data: { type: "appCategories", id: args.primary_category } };
    if (args.secondary_category) rels.secondaryCategory = { data: { type: "appCategories", id: args.secondary_category } };
    await client.patch(`/v1/appInfos/${infoId}`, {
      data: { type: "appInfos", id: infoId, relationships: rels },
    });
    if (args.primary_category) changes.push(`primary category ${args.primary_category}`);
    if (args.secondary_category) changes.push(`secondary category ${args.secondary_category}`);
  }

  // Copyright is a version attribute.
  if (args.copyright !== undefined) {
    const v = await editableVersionId(client, args.app_id);
    if (!v) return "No editable version to set copyright on.";
    await client.patch(`/v1/appStoreVersions/${v.id}`, {
      data: { type: "appStoreVersions", id: v.id, attributes: { copyright: args.copyright } },
    });
    changes.push(`copyright "${args.copyright}"`);
  }

  // Content-rights is an app attribute.
  if (args.content_rights) {
    await client.patch(`/v1/apps/${args.app_id}`, {
      data: { type: "apps", id: args.app_id, attributes: { contentRightsDeclaration: args.content_rights } },
    });
    changes.push(`content rights ${args.content_rights}`);
  }

  // Export compliance lives on the build (newest).
  if (args.uses_non_exempt_encryption !== undefined) {
    // VALID only. Without the state filter the newest build by upload date wins,
    // which during an upload is the one still PROCESSING: compliance lands on a
    // build that cannot be submitted while the ready one behind it keeps none,
    // and the version then fails submission for missing export compliance.
    const buildRes = await client.get<Record<string, never>>("/v1/builds", {
      "filter[app]": args.app_id,
      "filter[processingState]": "VALID",
      "fields[builds]": "version",
      sort: "-uploadedDate",
      limit: "1",
    });
    const build = Array.isArray(buildRes.data) ? buildRes.data[0] : buildRes.data;
    if (build) {
      await client.patch(`/v1/builds/${(build as { id: string }).id}`, {
        data: {
          type: "builds",
          id: (build as { id: string }).id,
          attributes: { usesNonExemptEncryption: args.uses_non_exempt_encryption },
        },
      });
      changes.push(`export compliance usesNonExemptEncryption=${args.uses_non_exempt_encryption}`);
    }
  }

  if (!changes.length) return "Nothing to set. Provide at least one of category/copyright/content-rights/encryption.";
  return "App submission metadata set:\n" + changes.map((c) => `- ${c}`).join("\n");
}

export interface AppPriceArgs {
  app_id: string;
  /** 0 for a free app, or a USA price tier in dollars (e.g. 1.99). */
  price_usd: number;
}

/**
 * Set the app's base price by creating its price schedule (USA base territory,
 * auto-equalized to all others). Use price_usd: 0 for a free app. Required:
 * an app cannot be submitted until pricing is set.
 */
export async function setAppPrice(
  client: ASCClient,
  args: AppPriceArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting the app price", "set_app_price");
  if (gate) return gate;

  // Find the matching USA app price point.
  const res = await client.getAll<{ customerPrice: string }>(
    `/v1/apps/${args.app_id}/appPricePoints`,
    { "filter[territory]": "USA", limit: "200" },
  );
  const points = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  let best: { id: string; price: string; diff: number } | null = null;
  for (const p of points) {
    const price = Number(p.attributes.customerPrice);
    const diff = Math.abs(price - args.price_usd);
    if (!best || diff < best.diff) best = { id: p.id, price: p.attributes.customerPrice, diff };
  }
  if (!best) return "No matching app price point found.";

  const tempId = "${price-1}";
  try {
    await client.post("/v1/appPriceSchedules", {
      data: {
        type: "appPriceSchedules",
        relationships: {
          app: { data: { type: "apps", id: args.app_id } },
          baseTerritory: { data: { type: "territories", id: "USA" } },
          manualPrices: { data: [{ type: "appPrices", id: tempId }] },
        },
      },
      included: [
        {
          type: "appPrices",
          id: tempId,
          attributes: { startDate: null },
          relationships: {
            appPricePoint: { data: { type: "appPricePoints", id: best.id } },
          },
        },
      ],
    });
  } catch (err) {
    if (err instanceof ASCAPIError && /already exists|conflict/i.test(err.body)) {
      return `App price schedule already exists. Current base ≈ $${best.price}.`;
    }
    throw err;
  }
  return best.price === "0.0" || Number(best.price) === 0
    ? "App price set to Free (all territories)."
    : `App base price set to $${best.price}/USA (auto-equalized to all territories).`;
}

export interface ReviewContactArgs {
  app_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  notes?: string;
  demo_account_name?: string;
  demo_account_password?: string;
  /**
   * Explicitly declare that no demo account is needed. Only way to clear the
   * flag, so that a call updating an unrelated field cannot silently strip a
   * demo account the app already had.
   */
  demo_account_required?: boolean;
}

/**
 * Set the App Review contact + (optional) demo account on the editable version's
 * appStoreReviewDetail. Required before submission. Idempotent: creates the
 * detail if absent, otherwise updates it.
 */
export async function setReviewContact(
  client: ASCClient,
  args: ReviewContactArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting the App Review contact", "set_review_contact");
  if (gate) return gate;

  const v = await editableVersionId(client, args.app_id);
  if (!v) return "No editable version to attach review details to.";

  const attributes: Record<string, string | boolean> = {
    contactFirstName: args.first_name,
    contactLastName: args.last_name,
    contactPhone: args.phone,
    contactEmail: args.email,
  };
  // demoAccountRequired used to be sent on EVERY call, computed from whether a
  // demo account was passed this time. Updating only a phone number therefore
  // shipped `demoAccountRequired: false` and cleared a demo account the app
  // already had, while the name and password fields (correctly guarded below)
  // stayed put. The next reviewer opens an app that needs a login and finds no
  // credentials, which is a straightforward rejection. Only touch the flag when
  // the caller actually says something about the demo account.
  if (args.demo_account_name) attributes.demoAccountRequired = true;
  else if (args.demo_account_required === false) attributes.demoAccountRequired = false;
  if (args.notes) attributes.notes = args.notes;
  if (args.demo_account_name) attributes.demoAccountName = args.demo_account_name;
  if (args.demo_account_password) attributes.demoAccountPassword = args.demo_account_password;

  // Does a review detail already exist for this version?
  let existingId: string | null = null;
  try {
    const ex = await client.get<Record<string, never>>(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`);
    if (ex.data && !Array.isArray(ex.data)) existingId = ex.data.id;
  } catch (err) {
    if (!(err instanceof ASCAPIError && err.status === 404)) throw err;
  }

  if (existingId) {
    await client.patch(`/v1/appStoreReviewDetails/${existingId}`, {
      data: { type: "appStoreReviewDetails", id: existingId, attributes },
    });
  } else {
    await client.post("/v1/appStoreReviewDetails", {
      data: {
        type: "appStoreReviewDetails",
        attributes,
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } },
      },
    });
  }
  return `App Review contact set for version ${v.version}: ${args.first_name} ${args.last_name}, ${args.email}.`;
}
