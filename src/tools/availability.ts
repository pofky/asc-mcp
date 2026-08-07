import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

export interface AppAvailabilityArgs {
  app_id: string;
  /**
   * Territory ids to make the app available in (e.g. ["USA","GBR"]). Omit to
   * make it available in ALL App Store territories. Pass an empty array to turn
   * every territory OFF, which is how you take an app off sale worldwide and the
   * required first step before removing an app record.
   */
  territories?: string[];
  /**
   * Explicit opt-in to "everywhere". Required when `territories` is omitted, so
   * that an app_id on its own can never widen where an app is sold.
   */
  all_territories?: boolean;
  /** Auto-include future new territories. Defaults to true. */
  available_in_new_territories?: boolean;
}

interface TerritoryAvailability {
  available: boolean;
}

/**
 * Set the app's country/region availability. By default makes the app available
 * in every App Store territory and auto-includes future ones. App availability
 * is a per-app singleton: if it already exists we flip the individual
 * territoryAvailabilities; otherwise we create it inline.
 */
export async function setAppAvailability(
  client: ASCClient,
  args: AppAvailabilityArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Setting app availability", "set_app_availability");
  if (gate) return gate;

  // Omitting `territories` used to mean "put it on sale in all 175 territories",
  // which made an app_id on its own a mutation of where the app is sold. An
  // agent poking at the tool to see what it does would silently widen the
  // distribution of an app that was deliberately limited, and this is not a
  // reversible read. Where an app sells is outward-facing, so intent has to be
  // explicit: name the territories, or say all_territories, or say nowhere.
  if (args.territories === undefined && args.all_territories !== true) {
    return (
      "Refusing to change where this app is sold without an explicit instruction.\n\n" +
      "Pick one:\n" +
      '  territories: ["USA", "GBR", ...]   only these, everywhere else off\n' +
      "  all_territories: true               on sale in every App Store territory\n" +
      "  territories: []                     off sale worldwide (the first step in removing an app)\n\n" +
      "Read the current state first with app_details if you are not sure."
    );
  }

  const newTerr = args.available_in_new_territories ?? true;

  // Resolve the target territory set (all, unless a subset was given).
  const allTerrRes = await client.getAll<Record<string, never>>("/v1/territories", { limit: "200" });
  const allIds = (Array.isArray(allTerrRes.data) ? allTerrRes.data : [allTerrRes.data])
    .filter(Boolean)
    .map((t) => (t as { id: string }).id);
  // An empty array is a real instruction ("nowhere"), not a missing argument.
  const wanted = new Set(args.territories === undefined ? allIds : args.territories);

  // Does an availability already exist for this app?
  let availId: string | null = null;
  try {
    const ex = await client.get<{ availableInNewTerritories: boolean }>(`/v1/apps/${args.app_id}/appAvailabilityV2`);
    if (ex.data && !Array.isArray(ex.data)) availId = ex.data.id;
  } catch (err) {
    if (!(err instanceof ASCAPIError && err.status === 404)) throw err;
  }

  // Create path: no availability yet. Apple requires a territoryAvailability
  // for EVERY territory on create, not just the wanted ones: sending a subset
  // returns one 409 per missing territory ("expects an included resource with
  // type 'territories' and id 'JOR'"). So send them all and carry the choice in
  // each `available` flag.
  if (!availId) {
    const ids = allIds;
    const lid = (id: string) => "${ta-" + id + "}";
    await client.post("/v2/appAvailabilities", {
      data: {
        type: "appAvailabilities",
        attributes: { availableInNewTerritories: newTerr },
        relationships: {
          app: { data: { type: "apps", id: args.app_id } },
          territoryAvailabilities: { data: ids.map((id) => ({ type: "territoryAvailabilities", id: lid(id) })) },
        },
      },
      included: ids.map((id) => ({
        type: "territoryAvailabilities",
        id: lid(id),
        attributes: { available: wanted.has(id) },
        relationships: { territory: { data: { type: "territories", id } } },
      })),
    });
    const onCount = ids.filter((id) => wanted.has(id)).length;
    return (
      `App availability created: ${onCount} of ${ids.length} territories on, ` +
      `new-territory auto-include ${newTerr}.`
    );
  }

  // Update path: flip each territoryAvailability to match the wanted set.
  let url: string | null =
    `/v2/appAvailabilities/${availId}/territoryAvailabilities?include=territory&limit=50`;
  const rows: Array<{ id: string; territory: string; on: boolean }> = [];
  while (url) {
    const r: { data: unknown; links?: { next?: string } } = await client.get<TerritoryAvailability>(
      url.replace(/^https:\/\/api\.appstoreconnect\.apple\.com/, ""),
    );
    const items = (Array.isArray(r.data) ? r.data : [r.data]).filter(Boolean) as Array<{
      id: string;
      attributes?: TerritoryAvailability;
      relationships?: { territory?: { data?: { id: string } } };
    }>;
    for (const t of items) {
      const territory = t.relationships?.territory?.data?.id;
      if (territory) rows.push({ id: t.id, territory, on: Boolean(t.attributes?.available) });
    }
    url = r.links?.next ?? null;
  }

  let turnedOn = 0;
  let turnedOff = 0;
  for (const row of rows) {
    const shouldBeOn = wanted.has(row.territory);
    if (shouldBeOn === row.on) continue;
    // The individual rows are v1 resources: /v2/territoryAvailabilities/{id}
    // returns 404 "path provided does not match a defined resource type".
    await client.patch(`/v1/territoryAvailabilities/${row.id}`, {
      data: { type: "territoryAvailabilities", id: row.id, attributes: { available: shouldBeOn } },
    });
    if (shouldBeOn) turnedOn++;
    else turnedOff++;
  }

  // The new-territory flag can only be set when the availability is created:
  // Apple allows CREATE and GET_INSTANCE on appAvailabilities and nothing else,
  // so report the mismatch instead of pretending to write it.
  let flagNote = "";
  if (args.available_in_new_territories !== undefined) {
    const current = await client
      .get<{ availableInNewTerritories: boolean }>(`/v1/apps/${args.app_id}/appAvailabilityV2`)
      .then((r) => (Array.isArray(r.data) ? undefined : r.data?.attributes?.availableInNewTerritories))
      .catch(() => undefined);
    if (current !== undefined && current !== newTerr) {
      flagNote =
        ` Note: auto-include for new territories is ${current} and Apple does not allow changing it after the ` +
        `availability exists (appAvailabilities is create-only). Change it in App Store Connect > Pricing and Availability.`;
    }
  }

  const onTotal = rows.filter((r) => wanted.has(r.territory)).length;
  const offEverywhere = onTotal === 0 && rows.length > 0
    ? " The app is now off sale in every territory. Removing the app record itself is website-only: " +
      "App Store Connect > Apps > your app > App Information > Additional Information > Remove App."
    : "";
  return (
    `App availability updated: ${onTotal} of ${rows.length} territories on ` +
    `(+${turnedOn} enabled, -${turnedOff} disabled).` +
    offEverywhere +
    flagNote
  );
}
