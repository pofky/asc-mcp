import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { fetchAppInfos, pickEditableAppInfo, noEditableAppInfoMessage } from "../app-info.js";

/**
 * Apple's current scale is 4+, 9+, 13+, 16+, 18+ (introduced with the 2025
 * overhaul; the old 12+ and 17+ tiers are gone). Sources:
 * https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
 * https://developer.apple.com/documentation/appstoreconnectapi/ageratingdeclaration
 * Apple's API reference pages are script-rendered, so the read-back below is
 * best effort: it reports appInfo.appStoreAgeRating only when Apple returns it.
 */
export const AGE_RATING_SCALE = "4+/9+/13+/16+/18+";

/**
 * Content-frequency declarations (NONE | INFREQUENT_OR_MILD | FREQUENT_OR_INTENSE).
 * These drive Apple's computed age rating. Anything you don't set keeps its
 * current value, so a fresh app (all null) reads as the lowest rating.
 */
const FREQUENCY_KEYS = new Set([
  "alcoholTobaccoOrDrugUseOrReferences",
  "contests",
  "gamblingSimulated",
  "horrorOrFearThemes",
  "matureOrSuggestiveThemes",
  "medicalOrTreatmentInformation",
  "profanityOrCrudeHumor",
  "sexualContentGraphicAndNudity",
  "sexualContentOrNudity",
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "violenceRealisticProlongedGraphicOrSadistic",
  "gunsOrOtherWeapons",
]);

/** Boolean capability declarations (V2 schema). */
const BOOLEAN_KEYS = new Set([
  "gambling",
  "unrestrictedWebAccess",
  "messagingAndChat",
  "userGeneratedContent",
  "healthOrWellnessTopics",
  "lootBox",
  "advertising",
  "parentalControls",
  "ageAssurance",
  // Required by Apple since late 2026: a PATCH without it 409s with
  // "You must provide a value for the attribute 'socialMedia'" (seen 15 Nov 2026).
  "socialMedia",
]);

/**
 * Boolean declarations Apple asks only in some cases (socialMediaAgeRestricted
 * follows socialMedia: true). Accepted from the caller, never defaulted.
 */
const OPTIONAL_BOOLEAN_KEYS = new Set(["socialMediaAgeRestricted"]);

/** Override/meta keys: never defaulted, kept at their current value. */
const KEEP_KEYS = new Set([
  // ageRatingOverride (V1) is deprecated and conflicts with V2; never echo it.
  "ageRatingOverrideV2",
  "koreaAgeRatingOverride",
  "kidsAgeBand",
  "developerAgeRatingInfoUrl",
  "gracRatingClassificationNumber",
]);

const FREQUENCY_VALUES = new Set([
  "NONE",
  "INFREQUENT_OR_MILD",
  "FREQUENT_OR_INTENSE",
  "INFREQUENT",
  "FREQUENT",
]);

export interface AgeRatingArgs {
  app_id: string;
  /** Map of declaration key to value. Frequency keys take NONE/INFREQUENT_OR_MILD/FREQUENT_OR_INTENSE; boolean keys take true/false. */
  declarations: Record<string, string | boolean>;
}

/**
 * Set the app's age-rating declarations. Apple computes the final rating (4+,
 * 9+, 13+, 16+, 18+) from these. Example for a wellness app that mentions health
 * topics: { medicalOrTreatmentInformation: "INFREQUENT_OR_MILD" } -> 13+.
 */
export async function setAgeRating(
  client: ASCClient,
  args: AgeRatingArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting the age rating", "set_age_rating");
  if (gate) return gate;

  // Validate keys + values before any write.
  const attributes: Record<string, string | boolean> = {};
  const bad: string[] = [];
  for (const [key, value] of Object.entries(args.declarations ?? {})) {
    if (FREQUENCY_KEYS.has(key)) {
      const v = String(value).toUpperCase();
      if (!FREQUENCY_VALUES.has(v)) {
        bad.push(`${key}: "${value}" (use NONE, INFREQUENT_OR_MILD, or FREQUENT_OR_INTENSE; a few keys also accept INFREQUENT or FREQUENT)`);
        continue;
      }
      attributes[key] = v;
    } else if (BOOLEAN_KEYS.has(key) || OPTIONAL_BOOLEAN_KEYS.has(key)) {
      attributes[key] = value === true || value === "true";
    } else {
      bad.push(`${key}: unknown declaration key`);
    }
  }
  if (bad.length) {
    return `Refusing to write, invalid age-rating declarations:\n- ${bad.join("\n- ")}`;
  }
  if (!Object.keys(attributes).length) {
    return "No declarations provided. Pass at least one, e.g. { medicalOrTreatmentInformation: \"INFREQUENT_OR_MILD\" }.";
  }

  // The ageRatingDeclaration id + current attributes come from the app's
  // appInfo with the declaration included.
  // A live app keeps its own locked appInfo, which Apple lists first, so the
  // declaration has to be read off the editable record or the PATCH 409s.
  const { infos, included } = await fetchAppInfos(client, args.app_id, {
    include: "ageRatingDeclaration",
    // The default field list leaves relationships out, and the id is on one.
    "fields[appInfos]": "appStoreState,state,ageRatingDeclaration",
  });
  const appInfo = pickEditableAppInfo(infos);
  if (!appInfo) return noEditableAppInfoMessage(infos, "the age rating");
  const ardId = appInfo.raw.relationships?.ageRatingDeclaration?.data?.id;
  if (!ardId) {
    return "Could not resolve the app's age-rating declaration. Confirm the app_id is correct.";
  }
  const current = included?.find((x) => x.type === "ageRatingDeclarations" && x.id === ardId)?.attributes ?? {};

  // The V2 declaration is not a partial PATCH: Apple requires the full set of
  // content declarations. Build a complete object (defaults for nulls), overlay
  // the app's existing values, then the caller's changes on top.
  const full: Record<string, string | boolean | null> = {};
  for (const k of FREQUENCY_KEYS) {
    const cur = current[k];
    full[k] = typeof cur === "string" ? cur : "NONE";
  }
  for (const k of BOOLEAN_KEYS) {
    const cur = current[k];
    full[k] = typeof cur === "boolean" ? cur : false;
  }
  // Override/meta keys: only echo back ones the app already has set.
  for (const k of KEEP_KEYS) {
    if (current[k] !== undefined && current[k] !== null) {
      full[k] = current[k] as string;
    }
  }
  Object.assign(full, attributes);

  // A fresh app has no frequency answer at all. Then every key the caller did
  // not pass is filed as NONE/false, which is an answer nobody gave.
  const freshApp = [...FREQUENCY_KEYS].every((k) => current[k] === undefined || current[k] === null);
  const defaulted = Object.keys(full).filter((k) => !(k in attributes) && (FREQUENCY_KEYS.has(k) || BOOLEAN_KEYS.has(k)) && (current[k] === undefined || current[k] === null));

  try {
    await client.patch(`/v1/ageRatingDeclarations/${ardId}`, {
      data: { type: "ageRatingDeclarations", id: ardId, attributes: full },
    });
  } catch (err) {
    // Apple adds questions without notice; name the new one instead of blaming a value.
    const missing = err instanceof ASCAPIError && err.status === 409 ? /provide a value for the attribute '([A-Za-z]+)'/.exec(err.message)?.[1] : undefined;
    if (missing) {
      return (
        `Nothing was written: Apple now requires an age-rating answer this tool does not know yet, '${missing}'. ` +
        "Next: the AI reports it as an asc-mcp bug (the key list in src/tools/age-rating.ts needs it); the human can answer it in App Store Connect > the app > App Information > Age Rating meanwhile."
      );
    }
    throw err;
  }

  const line = (k: string) => `- ${k} = ${full[k]}${k in attributes ? "" : defaulted.includes(k) ? " (default written, you did not pass it)" : " (kept current value)"}`;
  let out =
    `Age-rating declarations written (${Object.keys(full).length} values, Apple needs the full set):\n` +
    Object.keys(full).map(line).join("\n");
  if (freshApp && Object.keys(attributes).length < FREQUENCY_KEYS.size + BOOLEAN_KEYS.size) {
    out +=
      `\n\nWarning: this app had no age-rating answers yet, and ${defaulted.length} declaration(s) were filed as NONE or false because you did not pass them. ` +
      "The human confirms each of those is true for the app. If one is not, the AI calls set_age_rating again with the real value.";
  }

  // Read back what Apple computed, when the API exposes it.
  let computed: string | null = null;
  try {
    const back = await client.get<Record<string, unknown>>(`/v1/appInfos/${appInfo.id}`, {
      "fields[appInfos]": "appStoreAgeRating",
    });
    const d = Array.isArray(back.data) ? back.data[0] : back.data;
    const r = d?.attributes?.appStoreAgeRating;
    if (typeof r === "string" && r) computed = r;
  } catch {
    /* not exposed for this key or app: say so below */
  }
  out += computed
    ? `\n\nApple's computed rating: ${computed} (scale ${AGE_RATING_SCALE}).`
    : `\n\nApple's API did not return the computed rating (scale ${AGE_RATING_SCALE}). The human reads it in App Store Connect > the app > App Information > Age Rating before submitting.`;
  return out;
}
