import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

type IAPType = "NON_CONSUMABLE" | "CONSUMABLE" | "NON_RENEWING_SUBSCRIPTION";
type SubPeriod = "ONE_WEEK" | "ONE_MONTH" | "TWO_MONTHS" | "THREE_MONTHS" | "SIX_MONTHS" | "ONE_YEAR";

interface PricePointAttrs {
  customerPrice: string;
  proceeds: string;
}

// Apple's product-metadata character limits (validated before any write).
const NAME_LIMIT = 30;
const DESC_LIMIT = 45;
const IAP_DESC_LIMIT = 45;

/** Apple wraps an inactive Paid Applications agreement as a generic pricing error. */
function isAgreementError(err: unknown): boolean {
  return (
    err instanceof ASCAPIError &&
    /processing the pricing information/i.test(err.body)
  );
}

const AGREEMENT_HINT =
  "Apple rejected the price with a generic pricing error. This almost always means the " +
  "Paid Applications agreement is not active. In App Store Connect go to Business > Agreements " +
  "and accept the Paid Apps agreement, then add Tax and Banking details. Prices cannot be set until then.";

function tooLong(tool: string, field: string, length: number, limit: number): string {
  return `${field} too long: it is ${length} characters and Apple allows ${limit}. Nothing was created. The AI shortens it and calls ${tool} again with confirm: true.`;
}

/**
 * What the AI does next, by the product's state. Only MISSING_METADATA is
 * called "not ready": any other state is reported as Apple gave it, because
 * guessing at what an unfamiliar state needs would be claiming what is not known.
 */
function nextStep(kind: "Subscription" | "In-app purchase", args: { app_id: string; product_id: string }, state: string, priceWarned: boolean): string {
  if (state === "READY_TO_SUBMIT") {
    return (
      `${kind} ${args.product_id} is ready for review. The AI calls submit_for_review with confirm: true to send it with the app version ` +
      "(an app's very first in-app purchases are the exception: submit_for_review then explains the steps the human does on Apple's website)."
    );
  }
  if (state !== "MISSING_METADATA") return "";
  return (
    `${kind} ${args.product_id} is not ready for review yet (state ${state}). ` +
    (priceWarned ? "First fix the price warning above. " : "") +
    `Next: the AI calls set_iap_review_screenshot with app_id ${args.app_id}, product_id ${args.product_id} and file set to the absolute path of a PNG or JPEG screenshot of the purchase screen (the human supplies one if none exists). ` +
    "Then the AI checks the state again by calling this tool again with the same arguments and confirm: true."
  );
}

/** Find the price point id (USA territory) whose customer price matches the target. */
async function findPricePoint(
  client: ASCClient,
  pricePointsPath: string,
  targetUsd: number,
): Promise<{ id: string; price: string } | null> {
  const res = await client.getAll<PricePointAttrs>(pricePointsPath, {
    "filter[territory]": "USA",
    limit: "200",
  });
  const points = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  let best: { id: string; price: string; diff: number } | null = null;
  for (const p of points) {
    const price = Number(p.attributes.customerPrice);
    const diff = Math.abs(price - targetUsd);
    if (!best || diff < best.diff) best = { id: p.id, price: p.attributes.customerPrice, diff };
  }
  return best ? { id: best.id, price: best.price } : null;
}

export interface CreateSubscriptionArgs {
  confirm?: boolean;
  app_id: string;
  group_reference_name: string;
  group_display_name: string;
  product_id: string;
  reference_name: string;
  display_name: string;
  description: string;
  period: SubPeriod;
  price_usd: number;
  free_trial?: "THREE_DAYS" | "ONE_WEEK" | "TWO_WEEKS" | "ONE_MONTH" | "TWO_MONTHS" | "THREE_MONTHS" | "SIX_MONTHS" | "ONE_YEAR";
  locale?: string;
  group_level?: number;
  family_sharable?: boolean;
  /** Notes for App Review (how to reach the paywall, test instructions). */
  review_note?: string;
}

/**
 * Create (idempotently) a renewable subscription inside a group, with USA price
 * and an optional free trial. Safe to re-run: existing group/subscription/
 * localization/price are reused rather than duplicated.
 */
export async function createSubscription(
  client: ASCClient,
  args: CreateSubscriptionArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Creating a subscription", "create_subscription");
  if (gate) return gate;

  if (args.display_name.length > NAME_LIMIT) return tooLong("create_subscription", "display_name", args.display_name.length, NAME_LIMIT);
  if (args.description.length > DESC_LIMIT) return tooLong("create_subscription", "description", args.description.length, DESC_LIMIT);

  // A product is a thing customers can be charged for, and it stays on the account.
  if (!args.confirm) {
    return `This creates the subscription ${args.product_id} at $${args.price_usd} on your App Store Connect account. Nothing was changed. Re-run with confirm: true to proceed.`;
  }

  const locale = args.locale ?? "en-US";
  const steps: string[] = [];
  let priceWarned = false;

  // 1. Find or create the subscription group.
  const groupsRes = await client.get<{ referenceName: string }>(
    `/v1/apps/${args.app_id}/subscriptionGroups`,
    { "fields[subscriptionGroups]": "referenceName", limit: "100" },
  );
  const groups = (Array.isArray(groupsRes.data) ? groupsRes.data : [groupsRes.data]).filter(Boolean);
  let groupId = groups.find((g) => g.attributes.referenceName === args.group_reference_name)?.id;
  if (!groupId) {
    const gr = await client.post<{ referenceName: string }>("/v1/subscriptionGroups", {
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName: args.group_reference_name },
        relationships: { app: { data: { type: "apps", id: args.app_id } } },
      },
    });
    groupId = gr && !Array.isArray(gr.data) ? gr.data.id : undefined;
    if (!groupId) {
      return (
        "Apple returned no id for the new subscription group, so it may or may not exist. Nothing else was created. " +
        "The AI calls create_subscription again with the same arguments and confirm: true: it reuses a group with the same group_reference_name instead of duplicating it. " +
        "If it fails again, the human checks App Store Connect > the app > Monetization > Subscriptions."
      );
    }
    await client.post("/v1/subscriptionGroupLocalizations", {
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: { name: args.group_display_name, locale },
        relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: groupId } } },
      },
    });
    steps.push(`created group "${args.group_reference_name}"`);
  } else {
    steps.push(`reused group "${args.group_reference_name}"`);
  }

  // 2. Find or create the subscription.
  const existingSubs = await client.get<{ productId: string }>(
    `/v1/subscriptionGroups/${groupId}/subscriptions`,
    { "fields[subscriptions]": "productId", limit: "100" },
  );
  const subs = (Array.isArray(existingSubs.data) ? existingSubs.data : [existingSubs.data]).filter(Boolean);
  let subId = subs.find((s) => s.attributes.productId === args.product_id)?.id;
  if (!subId) {
    const subRes = await client.post<{ productId: string }>("/v1/subscriptions", {
      data: {
        type: "subscriptions",
        attributes: {
          name: args.reference_name,
          productId: args.product_id,
          subscriptionPeriod: args.period,
          familySharable: args.family_sharable ?? false,
          groupLevel: args.group_level ?? 1,
          ...(args.review_note ? { reviewNote: args.review_note } : {}),
        },
        relationships: { group: { data: { type: "subscriptionGroups", id: groupId } } },
      },
    });
    subId = subRes && !Array.isArray(subRes.data) ? subRes.data.id : undefined;
    if (!subId) {
      return (
        `Apple returned no id for subscription ${args.product_id}, so it may or may not have been created. ` +
        `The AI calls create_subscription again with the same arguments and confirm: true: it reuses a subscription with this product_id in the group instead of duplicating it. ` +
        "If it fails again, the human checks App Store Connect > the app > Monetization > Subscriptions."
      );
    }
    steps.push(`created subscription ${args.product_id}`);
  } else {
    steps.push(`reused subscription ${args.product_id}`);
  }

  // 3. Localization (create only if absent for this locale).
  const locsRes = await client.get<{ locale: string }>(
    `/v1/subscriptions/${subId}/subscriptionLocalizations`,
    { "fields[subscriptionLocalizations]": "locale", limit: "50" },
  );
  const locs = (Array.isArray(locsRes.data) ? locsRes.data : [locsRes.data]).filter(Boolean);
  if (!locs.some((l) => l.attributes.locale === locale)) {
    await client.post("/v1/subscriptionLocalizations", {
      data: {
        type: "subscriptionLocalizations",
        attributes: { name: args.display_name, description: args.description, locale },
        relationships: { subscription: { data: { type: "subscriptions", id: subId } } },
      },
    });
    steps.push("added localization");
  }

  // 4. Availability MUST exist before any price can be set, otherwise the
  // price POST fails with a misleading RELATIONSHIP.INVALID on the price point.
  let hasAvailability = true;
  try {
    await client.get(`/v1/subscriptions/${subId}/subscriptionAvailability`);
  } catch (err) {
    if (err instanceof ASCAPIError && err.status === 404) hasAvailability = false;
    else throw err;
  }
  if (!hasAvailability) {
    const terr = await client.getAll<Record<string, never>>("/v1/territories", { limit: "200" });
    const ids = (Array.isArray(terr.data) ? terr.data : [terr.data]).filter(Boolean).map((t) => t.id);
    await client.post("/v1/subscriptionAvailabilities", {
      data: {
        type: "subscriptionAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subId } },
          availableTerritories: { data: ids.map((id) => ({ type: "territories", id })) },
        },
      },
    });
    steps.push(`availability set (${ids.length} territories)`);
  }

  // 5. Price. A subscription stays MISSING_METADATA until EVERY available
  // territory has a price. We set the USA base, then equalize the rest from it
  // (the same thing the ASC UI's auto-generate does), filling only gaps.
  const postSubPrice = async (pricePointId: string) => {
    await client.post("/v1/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        attributes: { startDate: null },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subId } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: pricePointId } },
        },
      },
    });
  };

  const coveredTerr = new Set(
    (await client.getAll<Record<string, never>>(`/v1/subscriptions/${subId}/prices`, { include: "territory", limit: "200" }).then((r) =>
      (Array.isArray(r.data) ? r.data : [r.data]).filter(Boolean),
    )).map((p) => (p as { relationships?: { territory?: { data?: { id?: string } } } }).relationships?.territory?.data?.id).filter(Boolean) as string[],
  );

  const usa = await findPricePoint(client, `/v1/subscriptions/${subId}/pricePoints`, args.price_usd);
  if (!usa) {
    priceWarned = true;
    steps.push(
      `WARNING: Apple returned no USA price points for this subscription, so no price was set. The AI calls create_subscription again with confirm: true (it reuses what exists and only fills the missing price); if it repeats, the human sets the price on the subscription's Pricing page in App Store Connect > the app > Monetization > Subscriptions.`,
    );
  } else {
    try {
      if (!coveredTerr.has("USA")) {
        await postSubPrice(usa.id);
        coveredTerr.add("USA");
      }
      // Equalize to all other territories from the USA point.
      const eq = await client.getAll<Record<string, never>>(
        `/v1/subscriptionPricePoints/${usa.id}/equalizations`,
        { include: "territory", limit: "200" },
      );
      const points = (Array.isArray(eq.data) ? eq.data : [eq.data]).filter(Boolean);
      let filled = 0;
      for (const p of points) {
        const terrId = (p as { relationships?: { territory?: { data?: { id?: string } } } }).relationships?.territory?.data?.id;
        if (!terrId || coveredTerr.has(terrId)) continue;
        await postSubPrice(p.id);
        coveredTerr.add(terrId);
        filled++;
      }
      steps.push(`price $${usa.price} base + ${filled} territories equalized`);
    } catch (err) {
      if (isAgreementError(err)) return `Subscription ${args.product_id} created, but pricing failed.\n\n${AGREEMENT_HINT}`;
      throw err;
    }
  }

  // 6. Optional free-trial introductory offer. Apple requires one offer PER
  // territory (the territory relationship is mandatory), so we fan out across
  // every territory, skipping any that already have an offer.
  if (args.free_trial) {
    const offersRes = await client.getAll<Record<string, never>>(
      `/v1/subscriptions/${subId}/introductoryOffers`,
      { include: "territory", limit: "200" },
    );
    const covered = new Set(
      (Array.isArray(offersRes.data) ? offersRes.data : [offersRes.data])
        .filter(Boolean)
        .map((o) => (o as { relationships?: { territory?: { data?: { id?: string } } } }).relationships?.territory?.data?.id)
        .filter(Boolean) as string[],
    );
    const terr = await client.getAll<Record<string, never>>("/v1/territories", { limit: "200" });
    const ids = (Array.isArray(terr.data) ? terr.data : [terr.data]).filter(Boolean).map((t) => t.id);
    const todo = ids.filter((id) => !covered.has(id));
    let created = 0;
    for (const territoryId of todo) {
      await client.post("/v1/subscriptionIntroductoryOffers", {
        data: {
          type: "subscriptionIntroductoryOffers",
          attributes: { duration: args.free_trial, offerMode: "FREE_TRIAL", numberOfPeriods: 1 },
          relationships: {
            subscription: { data: { type: "subscriptions", id: subId } },
            territory: { data: { type: "territories", id: territoryId } },
          },
        },
      });
      created++;
    }
    steps.push(
      created
        ? `${args.free_trial} free trial (${created} territories)`
        : "trial already set",
    );
  }

  // 7. Force a state recompute. A subscription's state is recomputed on a
  // subscription-level edit, NOT eagerly when sub-resources (price, availability,
  // screenshot) change. Without this nudge it lingers in MISSING_METADATA even
  // when fully configured. A no-op PATCH of the reference name triggers it.
  await client.patch(`/v1/subscriptions/${subId}`, {
    data: {
      type: "subscriptions",
      id: subId,
      attributes: {
        name: args.reference_name,
        ...(args.review_note ? { reviewNote: args.review_note } : {}),
      },
    },
  });

  const finalRes = await client.get<{ state: string }>(
    `/v1/subscriptions/${subId}`,
    { "fields[subscriptions]": "state" },
  );
  const finalState = finalRes && !Array.isArray(finalRes.data) ? finalRes.data.attributes.state : "unknown";
  steps.push(`state: ${finalState}`);

  const next = nextStep("Subscription", args, finalState, priceWarned);
  return `Subscription ${args.product_id} set up (state ${finalState}):\n- ${steps.join("\n- ")}` + (next ? `\n\n${next}` : "");
}

export interface CreateIAPArgs {
  confirm?: boolean;
  app_id: string;
  product_id: string;
  reference_name: string;
  display_name: string;
  description: string;
  type: "NON_CONSUMABLE" | "CONSUMABLE";
  price_usd: number;
  locale?: string;
  family_sharable?: boolean;
  /** Notes for App Review (how to reach the paywall, test instructions). */
  review_note?: string;
}

/** Create (idempotently) a one-time in-app purchase with USA price. */
export async function createIAP(
  client: ASCClient,
  args: CreateIAPArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Creating an in-app purchase", "create_iap");
  if (gate) return gate;

  const missing = ["product_id", "display_name", "description", "type"].filter(
    (k) => !(args as unknown as Record<string, unknown>)[k],
  );
  if (missing.length) {
    return (
      `Missing required argument(s): ${missing.join(", ")}. ` +
      `An in-app purchase needs product_id (e.g. com.app.lifetime), display_name, description and type ` +
      `(NON_CONSUMABLE or CONSUMABLE). See asc_guide topic:iap.`
    );
  }
  if (args.display_name.length > NAME_LIMIT) return tooLong("create_iap", "display_name", args.display_name.length, NAME_LIMIT);
  if (args.description.length > IAP_DESC_LIMIT) return tooLong("create_iap", "description", args.description.length, IAP_DESC_LIMIT);

  // A product is a thing customers can be charged for, and it stays on the account.
  if (!args.confirm) {
    return `This creates the in-app purchase ${args.product_id} at $${args.price_usd} on your App Store Connect account. Nothing was changed. Re-run with confirm: true to proceed.`;
  }

  const locale = args.locale ?? "en-US";
  const steps: string[] = [];
  let priceWarned = false;

  // 1. Find or create the IAP record (v2).
  const existing = await client.get<{ productId: string }>(
    `/v1/apps/${args.app_id}/inAppPurchasesV2`,
    { "fields[inAppPurchases]": "productId", limit: "100" },
  );
  const iaps = (Array.isArray(existing.data) ? existing.data : [existing.data]).filter(Boolean);
  let iapId = iaps.find((i) => i.attributes.productId === args.product_id)?.id;
  if (!iapId) {
    const iapRes = await client.post<{ productId: string }>("/v2/inAppPurchases", {
      data: {
        type: "inAppPurchases",
        attributes: {
          name: args.reference_name,
          productId: args.product_id,
          inAppPurchaseType: args.type as IAPType,
          familySharable: args.family_sharable ?? false,
          ...(args.review_note ? { reviewNote: args.review_note } : {}),
        },
        relationships: { app: { data: { type: "apps", id: args.app_id } } },
      },
    });
    iapId = iapRes && !Array.isArray(iapRes.data) ? iapRes.data.id : undefined;
    if (!iapId) {
      return (
        `Apple returned no id for in-app purchase ${args.product_id}, so it may or may not have been created. ` +
        "The AI calls create_iap again with the same arguments and confirm: true: it reuses a purchase with this product_id instead of duplicating it. " +
        "If it fails again, the human checks App Store Connect > the app > Monetization > In-App Purchases."
      );
    }
    steps.push(`created ${args.type} ${args.product_id}`);
  } else {
    steps.push(`reused ${args.product_id}`);
  }

  // 2. Localization (create only if absent for this locale).
  const locsRes = await client.get<{ locale: string }>(
    `/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations`,
    { "fields[inAppPurchaseLocalizations]": "locale", limit: "50" },
  );
  const locs = (Array.isArray(locsRes.data) ? locsRes.data : [locsRes.data]).filter(Boolean);
  if (!locs.some((l) => l.attributes.locale === locale)) {
    await client.post("/v1/inAppPurchaseLocalizations", {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: { name: args.display_name, description: args.description, locale },
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } } },
      },
    });
    steps.push("added localization");
  }

  // 2b. Availability (all territories). An IAP stays MISSING_METADATA without it.
  let iapHasAvail = true;
  try {
    await client.get(`/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`);
  } catch (err) {
    if (err instanceof ASCAPIError && err.status === 404) iapHasAvail = false;
    else throw err;
  }
  if (!iapHasAvail) {
    const terr = await client.getAll<Record<string, never>>("/v1/territories", { limit: "200" });
    const ids = (Array.isArray(terr.data) ? terr.data : [terr.data]).filter(Boolean).map((t) => t.id);
    await client.post("/v1/inAppPurchaseAvailabilities", {
      data: {
        type: "inAppPurchaseAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          availableTerritories: { data: ids.map((id) => ({ type: "territories", id })) },
        },
      },
    });
    steps.push(`availability set (${ids.length} territories)`);
  }

  // 3. Price schedule (USA base territory) via an included new-price object.
  const schedRes = await client.get<Record<string, never>>(
    `/v2/inAppPurchases/${iapId}/iapPriceSchedule`,
    { limit: "1" },
  ).catch(() => null);
  const hasSchedule = schedRes && schedRes.data && !Array.isArray(schedRes.data);
  if (hasSchedule) {
    steps.push("price already set");
  } else {
    const pp = await findPricePoint(client, `/v2/inAppPurchases/${iapId}/pricePoints`, args.price_usd);
    if (!pp) {
      priceWarned = true;
      steps.push(
        `WARNING: Apple returned no USA price points for this purchase, so no price was set. The AI calls create_iap again with confirm: true (it reuses what exists and only sets the missing price); if it repeats, the human sets the price on the purchase's Pricing page in App Store Connect > the app > Monetization > In-App Purchases.`,
      );
    } else {
      const tempId = "${price-1}";
      try {
        await client.post("/v1/inAppPurchasePriceSchedules", {
          data: {
            type: "inAppPurchasePriceSchedules",
            relationships: {
              inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
              manualPrices: { data: [{ type: "inAppPurchasePrices", id: tempId }] },
              baseTerritory: { data: { type: "territories", id: "USA" } },
            },
          },
          included: [
            {
              type: "inAppPurchasePrices",
              id: tempId,
              attributes: { startDate: null },
              relationships: {
                inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pp.id } },
              },
            },
          ],
        });
        steps.push(`price $${pp.price}/USA`);
      } catch (err) {
        if (isAgreementError(err)) return `IAP ${args.product_id} created, but pricing failed.\n\n${AGREEMENT_HINT}`;
        throw err;
      }
    }
  }

  // The state is Apple's to compute and was never read here, so "ready" was a guess.
  const stateRes = await client
    .get<{ state: string }>(`/v2/inAppPurchases/${iapId}`, { "fields[inAppPurchases]": "state" })
    .catch(() => null);
  const state = stateRes && !Array.isArray(stateRes.data) ? stateRes.data.attributes.state : null;
  if (state) steps.push(`state: ${state}`);
  const next = state ? nextStep("In-app purchase", args, state, priceWarned) : "";
  return (
    `In-app purchase ${args.product_id} set up${state ? ` (state ${state})` : " (Apple's state could not be read: the AI calls create_iap again with the same arguments and confirm: true to read it)"}:\n- ${steps.join("\n- ")}` +
    (next ? `\n\n${next}` : "")
  );
}
