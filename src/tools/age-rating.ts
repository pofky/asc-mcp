import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { fetchAppInfos, pickEditableAppInfo, noEditableAppInfoMessage } from "../app-info.js";

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
]);

/** Override/meta keys: never defaulted, kept at their current value. */
const KEEP_KEYS = new Set([
  // ageRatingOverride (V1) is deprecated and conflicts with V2; never echo it.
  "ageRatingOverrideV2",
  "koreaAgeRatingOverride",
  "kidsAgeBand",
  "developerAgeRatingInfoUrl",
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
 * 9+, 12+, 17+) from these. Example for a wellness app that mentions health
 * topics: { medicalOrTreatmentInformation: "INFREQUENT_OR_MILD" } -> 12+.
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
    } else if (BOOLEAN_KEYS.has(key)) {
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

  await client.patch(`/v1/ageRatingDeclarations/${ardId}`, {
    data: { type: "ageRatingDeclarations", id: ardId, attributes: full },
  });

  const set = Object.entries(attributes).map(([k, v]) => `${k} = ${v}`);
  return (
    "Age-rating declarations updated:\n" +
    set.map((s) => `- ${s}`).join("\n") +
    "\n\nApple recomputes the displayed rating (4+/9+/12+/17+) from these. " +
    "Verify it in App Store Connect before submitting."
  );
}
