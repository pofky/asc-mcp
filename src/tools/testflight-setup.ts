import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface GroupAttrs {
  name: string;
  isInternalGroup: boolean;
  hasAccessToAllBuilds?: boolean;
}

export interface CreateBetaGroupArgs {
  app_id: string;
  name: string;
  /** true = internal group (existing App Store Connect users), false = external. No default: it is a different product. */
  internal: boolean;
  /** Internal groups only in practice: new builds reach the group without assign_build_to_group. */
  has_access_to_all_builds?: boolean;
  confirm?: boolean;
}

/**
 * Where an internal tester gets added. Apple's public API documents no call
 * for it, so the tool says so instead of guessing an endpoint.
 */
export const INTERNAL_TESTER_MANUAL =
  "Adding people to an INTERNAL group is a manual step: in App Store Connect open the app > TestFlight > Internal Testing > the group > Testers (+) and tick the account users. " +
  "Apple's public API documents no call for it: POST /v1/betaTesters (BetaTesterCreateRequest takes email, firstName, lastName and the betaGroups or builds relationships) is the external email-invite path, " +
  "and no page under developer.apple.com/documentation/appstoreconnectapi describes an internal-tester call, so none is attempted here. " +
  "The person must already be a user on the account (Users and Access).";

/**
 * Create a TestFlight beta group (POST /v1/betaGroups). Idempotent by name:
 * a group with that exact name on the app is returned, never duplicated.
 */
export async function createBetaGroup(
  client: ASCClient,
  args: CreateBetaGroupArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Creating a beta group", "create_beta_group");
  if (gate) return gate;

  const name = args.name.trim();
  if (!name) return "A beta group needs a name. Nothing was created. The AI calls create_beta_group again with one.";

  const res = await client.getAll<GroupAttrs>("/v1/betaGroups", {
    "filter[app]": args.app_id,
    "fields[betaGroups]": "name,isInternalGroup,hasAccessToAllBuilds",
    limit: "200",
  });
  const groups = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  const existing = groups.find((g) => g.attributes.name === name);
  if (existing) {
    const kind = existing.attributes.isInternalGroup ? "internal" : "external";
    const mismatch =
      existing.attributes.isInternalGroup !== args.internal
        ? ` Note it is ${kind}, not ${args.internal ? "internal" : "external"} as asked; nothing was changed and no second group was made.`
        : "";
    return (
      `Beta group "${name}" already exists on this app (${kind}, id ${existing.id}). Nothing was changed.${mismatch}\n` +
      `Next: ${existing.attributes.isInternalGroup ? "the human adds testers (" + INTERNAL_TESTER_MANUAL + ") " : "the AI calls invite_beta_tester with this id "}then set_beta_test_info and assign_build_to_group.`
    );
  }

  const kind = args.internal ? "internal" : "external";
  if (!args.confirm) {
    return (
      `This creates ${kind} TestFlight group "${name}" on app ${args.app_id}. ` +
      (args.internal
        ? "Internal groups take existing App Store Connect users, up to 100, and need no Beta App Review. "
        : "External groups take email invitees and the first build needs Beta App Review. ") +
      `A group can be deleted later in App Store Connect. Nothing was changed. ` +
      `The AI calls create_beta_group again with the same arguments and confirm: true.`
    );
  }

  const attributes: Record<string, string | boolean> = { name, isInternalGroup: args.internal };
  if (args.has_access_to_all_builds !== undefined) attributes.hasAccessToAllBuilds = args.has_access_to_all_builds;
  const created = await client.post<GroupAttrs>("/v1/betaGroups", {
    data: {
      type: "betaGroups",
      attributes,
      relationships: { app: { data: { type: "apps", id: args.app_id } } },
    },
  });
  const row = created && !Array.isArray(created.data) ? created.data : undefined;
  return (
    `Created ${kind} beta group "${name}"${row ? `, id ${row.id}` : ""}.\n` +
    (args.internal
      ? `Next: the human adds testers. ${INTERNAL_TESTER_MANUAL}\nThen the AI calls set_beta_test_info and assign_build_to_group${args.has_access_to_all_builds ? " (optional: this group already gets every build)" : ""}.`
      : "Next: the AI calls invite_beta_tester with this group id, then set_beta_test_info and assign_build_to_group.")
  );
}

// ---------------------------------------------------------------------------

export interface BetaTestInfoArgs {
  app_id: string;
  /** Locale of the info. Omitted: the app's primary locale is read from App Store Connect. */
  locale?: string;
  feedback_email?: string;
  description?: string;
  marketing_url?: string;
  privacy_policy_url?: string;
  /** Needs build_id. */
  whats_new?: string;
  build_id?: string;
  /** Beta App Review contact (app-level). All of first, last, email and phone together on first set. */
  review_contact_first_name?: string;
  review_contact_last_name?: string;
  review_contact_email?: string;
  review_contact_phone?: string;
  review_notes?: string;
  confirm?: boolean;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/;

interface Row {
  id: string;
  attributes: Record<string, unknown>;
}
const rows = (r: { data: unknown } | null): Row[] =>
  r ? ((Array.isArray(r.data) ? r.data : [r.data]).filter(Boolean) as Row[]) : [];

async function optionalGet(client: ASCClient, path: string, params?: Record<string, string>) {
  try {
    return await client.get<Record<string, unknown>>(path, params);
  } catch (err) {
    if (err instanceof ASCAPIError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Set the TestFlight test information: the app-level betaAppLocalization
 * (feedback email, description, marketing and privacy URLs), the build's
 * betaBuildLocalization (What to Test) and the Beta App Review contact.
 * Every value is an input, never invented. Creates or updates per resource.
 */
export async function setBetaTestInfo(
  client: ASCClient,
  args: BetaTestInfoArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting TestFlight test information", "set_beta_test_info");
  if (gate) return gate;

  const appAttrs: Record<string, string> = {};
  if (args.feedback_email !== undefined) appAttrs.feedbackEmail = args.feedback_email.trim();
  if (args.description !== undefined) appAttrs.description = args.description.trim();
  if (args.marketing_url !== undefined) appAttrs.marketingUrl = args.marketing_url.trim();
  if (args.privacy_policy_url !== undefined) appAttrs.privacyPolicyUrl = args.privacy_policy_url.trim();

  const reviewAttrs: Record<string, string> = {};
  if (args.review_contact_first_name !== undefined) reviewAttrs.contactFirstName = args.review_contact_first_name.trim();
  if (args.review_contact_last_name !== undefined) reviewAttrs.contactLastName = args.review_contact_last_name.trim();
  if (args.review_contact_email !== undefined) reviewAttrs.contactEmail = args.review_contact_email.trim();
  if (args.review_contact_phone !== undefined) reviewAttrs.contactPhone = args.review_contact_phone.trim();
  if (args.review_notes !== undefined) reviewAttrs.notes = args.review_notes.trim();

  const whatsNew = args.whats_new?.trim();

  // Validate everything before any call or any question to the human.
  const bad: string[] = [];
  if (appAttrs.feedbackEmail !== undefined && !EMAIL_RE.test(appAttrs.feedbackEmail)) bad.push(`feedback_email "${appAttrs.feedbackEmail}" is not an email`);
  if (reviewAttrs.contactEmail !== undefined && !EMAIL_RE.test(reviewAttrs.contactEmail)) bad.push(`review_contact_email "${reviewAttrs.contactEmail}" is not an email`);
  if (appAttrs.marketingUrl !== undefined && !URL_RE.test(appAttrs.marketingUrl)) bad.push("marketing_url must start with https://");
  if (appAttrs.privacyPolicyUrl !== undefined && !URL_RE.test(appAttrs.privacyPolicyUrl)) bad.push("privacy_policy_url must start with https://");
  for (const [k, v] of Object.entries({ ...appAttrs, ...reviewAttrs })) {
    if (!v) bad.push(`${k} is empty (Apple does not accept clearing these)`);
  }
  if (whatsNew !== undefined && !whatsNew) bad.push("whats_new is empty");
  if (whatsNew && !args.build_id) bad.push("whats_new belongs to one build: pass build_id (list_builds shows them)");
  if (args.build_id && whatsNew === undefined) bad.push("build_id was given without whats_new");
  if (bad.length) return `Nothing was changed: ${bad.join("; ")}. The AI calls set_beta_test_info again with corrected arguments.`;
  if (!Object.keys(appAttrs).length && !Object.keys(reviewAttrs).length && whatsNew === undefined) {
    return "Nothing to set. Pass any of feedback_email, description, marketing_url, privacy_policy_url, whats_new with build_id, or the review_contact_* fields. Every value comes from the human; none is invented.";
  }

  // Read the current state: it decides create vs update and drives the preview.
  type Plan = { label: string; method: "POST" | "PATCH"; path: string; body: unknown; fields: string[] };
  const plans: Plan[] = [];

  let localeMemo: string | undefined = args.locale?.trim() || undefined;
  const resolveLocale = async () => (localeMemo ??= await primaryLocale(client, args.app_id));
  const NO_LOCALE = "Nothing was changed: the app's primary locale could not be read. The AI calls set_beta_test_info again with locale (for example the one in app_details).";

  if (Object.keys(appAttrs).length) {
    const locale = await resolveLocale();
    if (!locale) return NO_LOCALE;
    const existing = rows(await client.getAll<Record<string, unknown>>(`/v1/apps/${args.app_id}/betaAppLocalizations`, { limit: "200" }))
      .find((r) => r.attributes.locale === locale);
    plans.push(
      existing
        ? { label: `beta app info (${locale}, update)`, method: "PATCH", path: `/v1/betaAppLocalizations/${existing.id}`,
            body: { data: { type: "betaAppLocalizations", id: existing.id, attributes: appAttrs } }, fields: Object.keys(appAttrs) }
        : { label: `beta app info (${locale}, create)`, method: "POST", path: "/v1/betaAppLocalizations",
            body: { data: { type: "betaAppLocalizations", attributes: { locale, ...appAttrs }, relationships: { app: { data: { type: "apps", id: args.app_id } } } } },
            fields: Object.keys(appAttrs) },
    );
  }

  if (whatsNew !== undefined && args.build_id) {
    const build = await optionalGet(client, `/v1/builds/${args.build_id}`, { "fields[builds]": "version" });
    if (!build) return `Error: no build with id ${args.build_id}. list_builds shows them.`;
    const buildLocale = await resolveLocale();
    if (!buildLocale) return NO_LOCALE;
    const existing = rows(await client.getAll<Record<string, unknown>>(`/v1/builds/${args.build_id}/betaBuildLocalizations`, { limit: "200" }))
      .find((r) => r.attributes.locale === buildLocale);
    plans.push(
      existing
        ? { label: `What to Test for build ${args.build_id} (${buildLocale}, update)`, method: "PATCH", path: `/v1/betaBuildLocalizations/${existing.id}`,
            body: { data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew } } }, fields: ["whatsNew"] }
        : { label: `What to Test for build ${args.build_id} (${buildLocale}, create)`, method: "POST", path: "/v1/betaBuildLocalizations",
            body: { data: { type: "betaBuildLocalizations", attributes: { locale: buildLocale, whatsNew }, relationships: { build: { data: { type: "builds", id: args.build_id } } } } },
            fields: ["whatsNew"] },
    );
  }

  if (Object.keys(reviewAttrs).length) {
    // Apple creates the review detail with the app; there is no POST, only PATCH.
    const detail = await optionalGet(client, `/v1/apps/${args.app_id}/betaAppReviewDetail`);
    const d = detail && !Array.isArray(detail.data) ? detail.data : undefined;
    if (!d) return `Nothing was changed: app ${args.app_id} has no Beta App Review detail to update. The human checks the app id (list_apps).`;
    plans.push({ label: "Beta App Review contact (update)", method: "PATCH", path: `/v1/betaAppReviewDetails/${d.id}`,
      body: { data: { type: "betaAppReviewDetails", id: d.id, attributes: reviewAttrs } }, fields: Object.keys(reviewAttrs) });
  }

  const summary = plans.map((p) => `- ${p.label}: ${p.fields.join(", ")}`).join("\n");
  if (!args.confirm) {
    return (
      `This would write the following TestFlight test information. Testers see it in the TestFlight app and Beta App Review reads it. Nothing was changed.\n${summary}\n` +
      `The AI calls set_beta_test_info again with the same arguments and confirm: true.`
    );
  }
  for (const p of plans) {
    if (p.method === "POST") await client.post(p.path, p.body);
    else await client.patch(p.path, p.body);
  }
  return `Set TestFlight test information:\n${summary}\nNext: the AI calls assign_build_to_group (external groups also need Beta App Review, which uses this information).`;
}

async function primaryLocale(client: ASCClient, appId: string): Promise<string | undefined> {
  const app = await client.get<{ primaryLocale?: string }>(`/v1/apps/${appId}`, { "fields[apps]": "primaryLocale" });
  const a = !Array.isArray(app.data) ? app.data : undefined;
  return a?.attributes?.primaryLocale;
}
