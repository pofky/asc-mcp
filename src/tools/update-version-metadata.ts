import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { EDITABLE_VERSION_STATES as EDITABLE } from "../editable.js";
import { fetchAppInfos, pickEditableAppInfo, noEditableAppInfoMessage } from "../app-info.js";

/**
 * PATCH a localization, but survive Apple's atomic-PATCH gotcha: a single
 * attribute that is not editable in the current state (e.g. whatsNew on a
 * first 1.0 version) returns 409 STATE_ERROR and rejects the WHOLE write,
 * silently losing the valid fields. We drop the offending attribute(s) and
 * retry so the rest still lands, reporting what was skipped.
 */
async function patchLocResilient(
  client: ASCClient,
  path: string,
  type: string,
  id: string,
  attributes: Record<string, string>,
  skipped: string[],
): Promise<void> {
  let attrs = { ...attributes };
  for (let attempt = 0; attempt < 6 && Object.keys(attrs).length; attempt++) {
    try {
      await client.patch(path, { data: { type, id, attributes: attrs } });
      return;
    } catch (err) {
      if (!(err instanceof ASCAPIError) || err.status !== 409) throw err;
      const bad = attrFromStateError(err.body, Object.keys(attrs));
      if (!bad) throw err;
      delete attrs[bad];
      skipped.push(bad);
    }
  }
}

/** Pull the offending attribute name out of a 409 STATE_ERROR body. */
function attrFromStateError(body: string, candidates: string[]): string | null {
  // Apple phrases it as: Attribute 'whatsNew' cannot be edited at this time
  const m = body.match(/Attribute '([^']+)'/);
  if (m && candidates.includes(m[1])) return m[1];
  // Fallback: any candidate name quoted in the body.
  return candidates.find((c) => body.includes(`'${c}'`)) ?? null;
}

interface VersionAttrs {
  versionString: string;
  appStoreState: string;
  platform: string;
}
interface VersionLocAttrs {
  locale: string;
  description: string | null;
  keywords: string | null;
  whatsNew: string | null;
  promotionalText: string | null;
  marketingUrl: string | null;
  supportUrl: string | null;
}
interface AppInfoLocAttrs {
  locale: string;
  name: string | null;
  subtitle: string | null;
}

const LIMITS: Record<string, number> = {
  description: 4000,
  keywords: 100,
  whatsNew: 4000,
  promotionalText: 170,
  name: 30,
  subtitle: 30,
};

export interface UpdateMetadataArgs {
  app_id: string;
  locale?: string;
  description?: string;
  keywords?: string;
  whats_new?: string;
  promotional_text?: string;
  marketing_url?: string;
  support_url?: string;
  name?: string;
  subtitle?: string;
  privacy_policy_url?: string;
}

export async function updateVersionMetadata(
  client: ASCClient,
  args: UpdateMetadataArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Editing version metadata", "update_version_metadata");
  if (gate) return gate;

  // Validate character limits before any write.
  const overLimit: string[] = [];
  const check = (field: string, val?: string) => {
    if (val !== undefined && val.length > LIMITS[field]) {
      overLimit.push(`${field}: ${val.length}/${LIMITS[field]} chars`);
    }
  };
  check("description", args.description);
  check("keywords", args.keywords);
  check("whatsNew", args.whats_new);
  check("promotionalText", args.promotional_text);
  check("name", args.name);
  check("subtitle", args.subtitle);
  if (overLimit.length) {
    return `Refusing to write, over Apple's character limits:\n- ${overLimit.join("\n- ")}`;
  }

  // 1. Find the editable version for this app.
  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState,platform", limit: "5" },
  );
  let appInfoNote = "";
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const editable = versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
  if (!editable) {
    return (
      "No editable version found. The current version is locked (in review or released).\n" +
      "Create a new version first with create_version."
    );
  }

  const targetLocale = args.locale;
  const changes: string[] = [];
  const skipped: string[] = [];

  // 2. Version-level localization fields (description, keywords, whatsNew, promo, urls).
  const versionLocFields: Record<string, string> = {};
  if (args.description !== undefined) versionLocFields.description = args.description;
  if (args.keywords !== undefined) versionLocFields.keywords = args.keywords;
  if (args.whats_new !== undefined) versionLocFields.whatsNew = args.whats_new;
  if (args.promotional_text !== undefined) versionLocFields.promotionalText = args.promotional_text;
  if (args.marketing_url !== undefined) versionLocFields.marketingUrl = args.marketing_url;
  if (args.support_url !== undefined) versionLocFields.supportUrl = args.support_url;

  if (Object.keys(versionLocFields).length) {
    const locsRes = await client.get<VersionLocAttrs>(
      `/v1/appStoreVersions/${editable.id}/appStoreVersionLocalizations`,
      { "fields[appStoreVersionLocalizations]": "locale", limit: "50" },
    );
    const locs = Array.isArray(locsRes.data) ? locsRes.data : [locsRes.data];
    const loc = targetLocale
      ? locs.find((l) => l.attributes.locale === targetLocale)
      : locs[0];
    if (!loc) {
      return `Locale "${targetLocale}" not found on version ${editable.attributes.versionString}.`;
    }
    const before = skipped.length;
    await patchLocResilient(
      client,
      `/v1/appStoreVersionLocalizations/${loc.id}`,
      "appStoreVersionLocalizations",
      loc.id,
      versionLocFields,
      skipped,
    );
    const dropped = new Set(skipped.slice(before));
    changes.push(
      ...Object.keys(versionLocFields)
        .filter((f) => !dropped.has(f))
        .map((f) => `${f} (${loc.attributes.locale ?? targetLocale})`),
    );
  }

  // 3. App-level localization fields (name, subtitle, privacyPolicyUrl) live on appInfoLocalizations.
  if (args.name !== undefined || args.subtitle !== undefined || args.privacy_policy_url !== undefined) {
    const { infos } = await fetchAppInfos(client, args.app_id);
    const appInfo = pickEditableAppInfo(infos);
    if (!appInfo) {
      // Do not attempt the write: patching the live appInfo returns 409 and
      // takes the whole call down with it.
      const fields = [
        args.name !== undefined ? "name" : null,
        args.subtitle !== undefined ? "subtitle" : null,
        args.privacy_policy_url !== undefined ? "privacy_policy_url" : null,
      ].filter(Boolean) as string[];
      appInfoNote = "\n\n" + noEditableAppInfoMessage(infos, fields.join(", "));
    } else {
      const infoLocsRes = await client.get<AppInfoLocAttrs>(
        `/v1/appInfos/${appInfo.id}/appInfoLocalizations`,
        { "fields[appInfoLocalizations]": "locale,name,subtitle", limit: "50" },
      );
      const infoLocs = Array.isArray(infoLocsRes.data) ? infoLocsRes.data : [infoLocsRes.data];
      const iloc = targetLocale
        ? infoLocs.find((l) => l.attributes.locale === targetLocale)
        : infoLocs[0];
      if (iloc) {
        const attrs: Record<string, string> = {};
        if (args.name !== undefined) attrs.name = args.name;
        if (args.subtitle !== undefined) attrs.subtitle = args.subtitle;
        if (args.privacy_policy_url !== undefined) attrs.privacyPolicyUrl = args.privacy_policy_url;
        // Even on the editable record a single locked attribute 409s and takes
        // the whole PATCH with it. Report it instead of throwing away the
        // version-level fields that already landed.
        try {
          await client.patch(`/v1/appInfoLocalizations/${iloc.id}`, {
            data: { type: "appInfoLocalizations", id: iloc.id, attributes: attrs },
          });
          changes.push(...Object.keys(attrs).map((f) => `${f} (${iloc.attributes.locale ?? targetLocale})`));
        } catch (err) {
          if (!(err instanceof ASCAPIError) || err.status !== 409) throw err;
          appInfoNote =
            `\n\nApple refused the app-level fields (${Object.keys(attrs).join(", ")}) on appInfo ` +
            `${appInfo.id} (state ${appInfo.state ?? "unknown"}): ${err.body.slice(0, 200)}`;
        }
      }
    }
  }

  const skipNote = skipped.length
    ? `\n\nSkipped (not editable in this state): ${[...new Set(skipped)].join(", ")}. ` +
      `whatsNew only applies to update versions, not a first 1.0 release.`
    : "";

  if (!changes.length) {
    return (
      "No metadata fields were applied." +
      (skipped.length ? skipNote : appInfoNote ? "" : " No fields were provided.") +
      appInfoNote
    );
  }
  return (
    `Updated version ${editable.attributes.versionString} (${editable.attributes.appStoreState}):\n` +
    changes.map((c) => `- ${c}`).join("\n") +
    skipNote +
    appInfoNote +
    `\n\nRun release_preflight to validate, then submit_for_review when ready.`
  );
}