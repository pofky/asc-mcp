import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { pickEditableVersion } from "../editable.js";
import { fetchAppInfos, pickEditableAppInfo, noEditableAppInfoMessage } from "../app-info.js";

/** The version a write means, or the sentence that says why it cannot tell. */
async function editableVersion(
  client: ASCClient,
  appId: string,
  platform?: string,
): Promise<{ version: { id: string; versionString: string } | null; refusal?: string }> {
  const res = await client.get<{ versionString: string; appStoreState: string; platform: string }>(
    `/v1/apps/${appId}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState,platform", limit: "5" },
  );
  const versions = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  const { version, refusal } = pickEditableVersion(versions, platform);
  return { version: version ? { id: version.id, versionString: version.attributes.versionString } : null, refusal };
}

async function attachedBuildId(client: ASCClient, versionId: string): Promise<string | null> {
  try {
    const res = await client.get<Record<string, never>>(`/v1/appStoreVersions/${versionId}/build`);
    return res.data && !Array.isArray(res.data) ? res.data.id : null;
  } catch (err) {
    if (err instanceof ASCAPIError && err.status === 404) return null;
    throw err;
  }
}

/**
 * VALID only. Without the state filter the newest build by upload date wins,
 * which during an upload is the one still PROCESSING.
 */
async function newestValidBuildId(client: ASCClient, appId: string, platform?: string): Promise<string | null> {
  const res = await client.get<Record<string, never>>("/v1/builds", {
    "filter[app]": appId,
    "filter[processingState]": "VALID",
    ...(platform ? { "filter[preReleaseVersion.platform]": platform } : {}),
    "fields[builds]": "version",
    sort: "-uploadedDate",
    limit: "1",
  });
  const build = Array.isArray(res.data) ? res.data[0] : res.data;
  return build ? (build as { id: string }).id : null;
}

export interface AppMetadataArgs {
  app_id: string;
  /** Which version copyright and export compliance apply to, when more than one platform is in progress. */
  platform?: string;
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
  let encryptionSkipped: string | null = null;

  // Resolved before any write, so a refusal never leaves half the fields applied.
  const needsVersion = args.copyright !== undefined || args.uses_non_exempt_encryption !== undefined;
  const picked = needsVersion ? await editableVersion(client, args.app_id, args.platform) : { version: null };
  if ("refusal" in picked && picked.refusal) return picked.refusal;

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
    const v = picked.version;
    if (!v) {
      const skipped = [args.content_rights ? "content_rights" : "", args.uses_non_exempt_encryption !== undefined ? "uses_non_exempt_encryption" : ""].filter(Boolean);
      return (
        "Copyright was not set: this app has no version open for editing. " +
        (changes.length ? `Already applied: ${changes.join(", ")}. ` : "") +
        (skipped.length ? `Not attempted: ${skipped.join(", ")}. ` : "") +
        "The AI calls create_version, then set_app_metadata again with copyright" +
        (skipped.length ? ` and ${skipped.join(", ")}.` : ".")
      );
    }
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

  // Export compliance lives on a build, and the one that matters is the one the
  // version will submit. Answering the newest instead left the attached build
  // unanswered while this reported success, and preflight failed again on re-run.
  if (args.uses_non_exempt_encryption !== undefined) {
    const buildId = (picked.version && (await attachedBuildId(client, picked.version.id))) ?? (await newestValidBuildId(client, args.app_id, args.platform));
    if (buildId) {
      await client.patch(`/v1/builds/${buildId}`, {
        data: {
          type: "builds",
          id: buildId,
          attributes: { usesNonExemptEncryption: args.uses_non_exempt_encryption },
        },
      });
      changes.push(`export compliance usesNonExemptEncryption=${args.uses_non_exempt_encryption}`);
    } else {
      // Say so instead of falling through: with nothing else set this used to
      // read "Nothing to set", as if no argument had been passed.
      encryptionSkipped =
        "Export compliance was not set: no build is attached to the version and no processed build exists. " +
        "The AI uploads one with upload_binary, waits for it with wait_for_build, attaches it with attach_build, " +
        "then calls set_app_metadata again with uses_non_exempt_encryption.";
    }
  }

  if (!changes.length) {
    return (
      encryptionSkipped ??
      "Nothing to set: no field was passed. The AI calls set_app_metadata again with at least one of primary_category, secondary_category, copyright, content_rights, uses_non_exempt_encryption."
    );
  }
  return "App submission metadata set:\n" + changes.map((c) => `- ${c}`).join("\n") + (encryptionSkipped ? `\n${encryptionSkipped}` : "");
}

export interface AppPriceArgs {
  app_id: string;
  /** 0 for a free app, or a USA price tier in dollars (e.g. 1.99). */
  price_usd: number;
  /** Required to change a price the app already has. */
  confirm?: boolean;
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

  if (!Number.isFinite(args.price_usd) || args.price_usd < 0) {
    return `Refusing to set a price of ${args.price_usd}. Use 0 for free, or a USA price in dollars.`;
  }

  // Setting a first price is a submission step. Changing one reaches buyers at
  // once, and a typo here makes a paid app free, so that takes a second call.
  if (!args.confirm) {
    let hasPrice = false;
    try {
      const current = await client.get<Record<string, never>>(`/v1/appPriceSchedules/${args.app_id}/manualPrices`, { limit: "1" });
      hasPrice = Array.isArray(current.data) ? current.data.length > 0 : Boolean(current.data);
    } catch (err) {
      if (!(err instanceof ASCAPIError && err.status === 404)) throw err;
    }
    if (hasPrice) {
      return `This app already has a price. Changing it to $${args.price_usd} applies to everyone buying from now on. Nothing was changed. Re-run with confirm: true to proceed.`;
    }
  }

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
  if (!best) {
    return "Nothing was changed: Apple returned no USA price points for this app. The AI checks app_id with list_apps; if it is right, the human sets the price in App Store Connect > the app > Pricing and Availability.";
  }
  // Apple only has fixed price points. Taking the nearest silently charged a price
  // nobody asked for, so say what is close and let the caller choose. Half a cent:
  // the points are given to the cent.
  if (best.diff >= 0.005) {
    return `Apple has no USA price point at $${args.price_usd}. The nearest is $${best.price}. Nothing was changed. The AI asks the human which price they want, then calls set_app_price with price_usd ${best.price} (or another Apple price).`;
  }

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
      return `Nothing was changed: Apple already has a price schedule for this app and refused a new one. The requested $${args.price_usd} was not applied. The human can change the price in App Store Connect > the app > Pricing and Availability.`;
    }
    throw err;
  }
  return best.price === "0.0" || Number(best.price) === 0
    ? "App price set to Free (all territories)."
    : `App base price set to $${best.price}/USA (auto-equalized to all territories).`;
}

export interface ReviewContactArgs {
  app_id: string;
  platform?: string;
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

  const { version: v, refusal } = await editableVersion(client, args.app_id, args.platform);
  if (refusal) return refusal;
  if (!v) {
    return "Nothing was changed: this app has no version open for editing, so there is nowhere to attach review details. The AI calls create_version, then set_review_contact again.";
  }

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
  return `App Review contact set for version ${v.versionString}: ${args.first_name} ${args.last_name}, ${args.email}.`;
}
