import { fetchAppInfos, pickAuditAppInfo } from "../app-info.js";
import { ASCAPIError, type ASCClient } from "../client.js";
import { EDITABLE_VERSION_STATES } from "../editable.js";
import {
  failedPart,
  okPart,
  type AppInfoLocalization,
  type BuildInfo,
  type Part,
  type Product,
  type RecordSnapshot,
  type ReviewDetail,
  type ScreenshotSet,
  type VersionLocalization,
  type VersionSnapshot,
} from "./types.js";

/** Versions that have reached the store at some point. */
const RELEASED_STATES = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"]);

/** Apple's page size ceiling on list endpoints. */
const PAGE_SIZE = "200";
/** Past this, an answer is reported as incomplete rather than quietly truncated. */
const MAX_PAGES = 20;
/** Apple's per-set maximum is 10 images; asked for explicitly, the default is shorter on some relationships. */
const SCREENSHOTS_PER_SET = "10";
/** Parallel Apple calls. Rate limits are per key, and the rest of the session shares that key. */
const APPLE_CONCURRENCY = 5;

interface RawVersion {
  id: string;
  attributes: {
    versionString: string;
    platform: string;
    appStoreState: string;
    createdDate?: string | null;
    copyright?: string | null;
  };
}

/** Why a read failed, in words someone can act on. */
export function explainFailure(err: unknown): string {
  if (err instanceof ASCAPIError) {
    if (err.status === 401) return "Apple returned 401. The Issuer ID, Key ID or .p8 do not match.";
    if (err.status === 403) return "Apple returned 403. Either this app id is not in the account your key belongs to (check it with list_apps), or the key's role is too low (App Manager or higher).";
    if (err.status === 404) return "Apple returned 404 for this resource.";
    if (err.status === 429) return "Apple returned 429, rate limited. Retry in a minute.";
    if (err.status >= 500) return `Apple returned ${err.status}, a problem on Apple's end. Retry shortly.`;
    return `Apple returned ${err.status}.`;
  }
  return `The request did not complete: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`;
}

/** Runs one read. A failure becomes a value, so a check can never skip past it. */
async function read<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return okPart(await fn());
  } catch (err) {
    return failedPart(explainFailure(err));
  }
}

/**
 * Walks every page, and throws when a page fails or the walk runs out. The
 * client's `getAll` stops quietly on a failed page, which is right for a listing
 * tool and wrong here: a silently short list would make a check look clean.
 */
export async function getEveryPage<T>(
  client: ASCClient,
  path: string,
  params: Record<string, string>,
): Promise<{ data: Array<{ id: string; type: string; attributes: T; relationships?: unknown }>; included: Array<{ id: string; type: string; attributes: Record<string, unknown> }> }> {
  const data: Array<{ id: string; type: string; attributes: T }> = [];
  const included: Array<{ id: string; type: string; attributes: Record<string, unknown> }> = [];
  let nextPath = path;
  let nextParams = params;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await client.get<T>(nextPath, nextParams)) as unknown as {
      data: Array<{ id: string; type: string; attributes: T }>;
      included?: Array<{ id: string; type: string; attributes: Record<string, unknown> }>;
      links?: { next?: string };
    };
    data.push(...(Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean));
    included.push(...(res.included ?? []));
    if (!res.links?.next) return { data, included };
    const next = new URL(res.links.next);
    nextPath = next.pathname;
    nextParams = Object.fromEntries(next.searchParams.entries());
  }
  throw new Error(`more than ${MAX_PAGES} pages from Apple, so this list is incomplete`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The newest version in progress for each platform. Falls back to the live
 * version only where nothing is in progress anywhere, because an app shipping
 * iOS with a dormant Mac version should not get a report on the dormant one.
 */
export function selectVersions(all: RawVersion[], platform?: string): RawVersion[] {
  const candidates = platform ? all.filter((v) => v.attributes.platform === platform) : all;
  const newestFirst = [...candidates].sort((a, b) => (b.attributes.createdDate ?? "").localeCompare(a.attributes.createdDate ?? ""));
  const byPlatform = new Map<string, RawVersion[]>();
  for (const v of newestFirst) {
    const list = byPlatform.get(v.attributes.platform) ?? [];
    list.push(v);
    byPlatform.set(v.attributes.platform, list);
  }
  const inProgress: RawVersion[] = [];
  const latest: RawVersion[] = [];
  for (const versions of byPlatform.values()) {
    const open =
      versions.find((v) => EDITABLE_VERSION_STATES.has(v.attributes.appStoreState)) ??
      versions.find((v) => !RELEASED_STATES.has(v.attributes.appStoreState));
    if (open) inProgress.push(open);
    latest.push(versions[0]);
  }
  return inProgress.length ? inProgress : latest;
}

async function readLocalizations(client: ASCClient, versionId: string): Promise<Part<VersionLocalization[]>> {
  return read(async () => {
    const res = await getEveryPage<Omit<VersionLocalization, "id">>(client, `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`, {
      "fields[appStoreVersionLocalizations]": "locale,description,keywords,whatsNew,promotionalText,marketingUrl,supportUrl",
      limit: PAGE_SIZE,
    });
    return res.data.map((l) => ({ ...l.attributes, id: l.id }));
  });
}

async function readScreenshots(client: ASCClient, localizations: Part<VersionLocalization[]>): Promise<Part<Record<string, ScreenshotSet[]>>> {
  if (!localizations.ok) return failedPart(localizations.reason);
  return read(async () => {
    const pairs = await mapLimit(localizations.value, APPLE_CONCURRENCY, async (loc) => {
      const res = await getEveryPage<{ screenshotDisplayType: string }>(client, `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`, {
        include: "appScreenshots",
        "fields[appScreenshots]": "assetDeliveryState",
        "limit[appScreenshots]": SCREENSHOTS_PER_SET,
        limit: PAGE_SIZE,
      });
      const states = new Map(res.included.map((i) => [i.id, (i.attributes.assetDeliveryState as { state?: string } | null)?.state ?? "UNKNOWN"]));
      const sets = res.data.map((s) => {
        const rel = (s.relationships as { appScreenshots?: { data?: Array<{ id: string }> } } | undefined)?.appScreenshots?.data ?? [];
        return { displayType: s.attributes.screenshotDisplayType, imageStates: rel.map((r) => states.get(r.id) ?? "UNKNOWN") };
      });
      return [loc.locale, sets] as const;
    });
    return Object.fromEntries(pairs);
  });
}

async function readBuild(client: ASCClient, versionId: string): Promise<Part<BuildInfo | null>> {
  return read(async () => {
    const res = (await client.get(`/v1/appStoreVersions/${versionId}/build`)) as unknown as {
      data: null | {
        id: string;
        attributes: { version: string; processingState: string; expired?: boolean; usesNonExemptEncryption?: boolean | null; iconAssetToken?: { templateUrl?: string } | null };
      };
    };
    if (!res.data) return null;
    const a = res.data.attributes;
    // The SDK only decides the Duo rule, and that rule says when it is unknown,
    // so a failure here does not fail the build read.
    const bundles = await read(async () => {
      const b = (await client.get(`/v1/builds/${res.data!.id}`, { include: "buildBundles" })) as unknown as {
        included?: Array<{ type: string; attributes: { bundleType?: string; sdkBuild?: string } }>;
      };
      return b.included?.find((i) => i.type === "buildBundles" && i.attributes.bundleType === "APP")?.attributes.sdkBuild ?? null;
    });
    return {
      version: a.version,
      processingState: a.processingState,
      expired: a.expired === true,
      usesNonExemptEncryption: a.usesNonExemptEncryption ?? null,
      iconFile: a.iconAssetToken?.templateUrl?.split("/").slice(-2, -1)[0] ?? null,
      sdkBuild: bundles.ok ? bundles.value : null,
    };
  });
}

async function readReview(client: ASCClient, versionId: string): Promise<Part<ReviewDetail | null>> {
  return read(async () => {
    try {
      // The demo password is left out of the request: this tool has no use for
      // it, and what is never fetched cannot reach a report.
      const res = (await client.get(`/v1/appStoreVersions/${versionId}/appStoreReviewDetail`, {
        "fields[appStoreReviewDetails]": "contactFirstName,contactLastName,contactPhone,contactEmail,demoAccountName,demoAccountRequired",
      })) as unknown as { data: null | { attributes: ReviewDetail } };
      return res.data?.attributes ?? null;
    } catch (err) {
      // A version that never had review details answers 404. That is the answer.
      if (err instanceof ASCAPIError && err.status === 404) return null;
      throw err;
    }
  });
}

async function readVersion(client: ASCClient, v: RawVersion, all: RawVersion[], isOpen: boolean): Promise<VersionSnapshot> {
  const localizations = await readLocalizations(client, v.id);
  const [screenshots, build, review] = await Promise.all([
    readScreenshots(client, localizations),
    readBuild(client, v.id),
    readReview(client, v.id),
  ]);
  return {
    id: v.id,
    platform: v.attributes.platform,
    versionString: v.attributes.versionString,
    state: v.attributes.appStoreState,
    auditingLive: !isOpen,
    hasPriorRelease: all.some((o) => o.id !== v.id && o.attributes.platform === v.attributes.platform && RELEASED_STATES.has(o.attributes.appStoreState)),
    copyright: v.attributes.copyright ?? null,
    localizations,
    screenshots,
    build,
    review,
  };
}

async function readAppInfo(client: ASCClient, appId: string): Promise<RecordSnapshot["appInfo"]> {
  return read(async () => {
    const { infos, included = [] } = await fetchAppInfos(client, appId, {
      include: "ageRatingDeclaration,primaryCategory",
      "fields[appInfos]": "appStoreState,state,ageRatingDeclaration,primaryCategory",
    });
    const info = pickAuditAppInfo(infos);
    if (!info) throw new Error("Apple returned no app information record");
    const ageId = info.raw.relationships?.ageRatingDeclaration?.data?.id;
    const age = included.find((x) => x.type === "ageRatingDeclarations" && x.id === ageId)?.attributes ?? {};
    // A fresh app has every content declaration null. The two override fields
    // can hold a value on their own and say nothing about the declaration.
    const ageDeclared = Object.entries(age).some(([k, v]) => v !== null && v !== undefined && !/^(ageRatingOverride|koreaAgeRatingOverride)/.test(k));
    const locs = await getEveryPage<AppInfoLocalization>(client, `/v1/appInfos/${info.id}/appInfoLocalizations`, {
      "fields[appInfoLocalizations]": "locale,name,subtitle,privacyPolicyUrl",
      limit: PAGE_SIZE,
    });
    return {
      ageDeclared,
      hasPrimaryCategory: Boolean(info.raw.relationships?.primaryCategory?.data?.id),
      localizations: locs.data.map((l) => l.attributes),
    };
  });
}

/**
 * Whether a price exists. `GET appPriceSchedule` answers with data on an app
 * that has never been priced (seen 2026-10-31 on a real draft app: a schedule
 * object, USA base territory, zero manual prices), so only the price rows count.
 * A free app holds one manual price at the zero point, so this covers free too.
 */
async function readHasManualPrice(client: ASCClient, appId: string): Promise<Part<boolean>> {
  return read(async () => {
    try {
      const res = await client.get(`/v1/appPriceSchedules/${appId}/manualPrices`, { limit: "1" });
      return Array.isArray(res.data) ? res.data.length > 0 : Boolean(res.data);
    } catch (err) {
      if (err instanceof ASCAPIError && err.status === 404) return false;
      throw err;
    }
  });
}

async function readSubscriptions(client: ASCClient, appId: string): Promise<Part<Product[]>> {
  return read(async () => {
    const groups = await getEveryPage(client, `/v1/apps/${appId}/subscriptionGroups`, { limit: PAGE_SIZE });
    const lists = await mapLimit(groups.data, APPLE_CONCURRENCY, (group) =>
      getEveryPage<{ productId: string; state: string }>(client, `/v1/subscriptionGroups/${group.id}/subscriptions`, {
        "fields[subscriptions]": "productId,state",
        limit: PAGE_SIZE,
      }),
    );
    return lists.flatMap((l) => l.data.map((s): Product => ({ productId: s.attributes.productId, state: s.attributes.state, kind: "subscription" })));
  });
}

/**
 * One fetch pass over everything the rules look at. Each resource is read once,
 * and a resource that cannot be read is recorded with the reason.
 * Throws only when the list of versions itself cannot be read, because then
 * there is nothing to audit; `src/index.ts` reports that as an error reply.
 */
export async function gatherRecord(client: ASCClient, appId: string, platform?: string): Promise<RecordSnapshot> {
  const all = await getEveryPage<RawVersion["attributes"]>(client, `/v1/apps/${appId}/appStoreVersions`, {
    "fields[appStoreVersions]": "versionString,platform,appStoreState,createdDate,copyright",
    limit: PAGE_SIZE,
  });
  const raw = all.data as RawVersion[];
  const selected = selectVersions(raw, platform);

  const [app, appInfo, hasManualPrice, iaps, subscriptions, hasCustomEula, versions] = await Promise.all([
    read(async () => {
      const res = (await client.get(`/v1/apps/${appId}`, { "fields[apps]": "name,bundleId,primaryLocale,contentRightsDeclaration" })) as unknown as {
        data: { attributes: { name: string; bundleId: string; primaryLocale?: string | null; contentRightsDeclaration?: string | null } };
      };
      const a = res.data.attributes;
      return { name: a.name, bundleId: a.bundleId, primaryLocale: a.primaryLocale ?? null, contentRights: a.contentRightsDeclaration ?? null };
    }),
    readAppInfo(client, appId),
    readHasManualPrice(client, appId),
    read(async () => {
      const res = await getEveryPage<{ productId: string; state: string }>(client, `/v1/apps/${appId}/inAppPurchasesV2`, {
        "fields[inAppPurchases]": "productId,state",
        limit: PAGE_SIZE,
      });
      return res.data.map((i): Product => ({ productId: i.attributes.productId, state: i.attributes.state, kind: "iap" }));
    }),
    readSubscriptions(client, appId),
    read(async () => {
      try {
        const res = await client.get(`/v1/apps/${appId}/endUserLicenseAgreement`);
        return Boolean(res.data);
      } catch (err) {
        if (err instanceof ASCAPIError && err.status === 404) return false;
        throw err;
      }
    }),
    mapLimit(selected, APPLE_CONCURRENCY, (v) =>
      readVersion(client, v, raw, !RELEASED_STATES.has(v.attributes.appStoreState)),
    ),
  ]);

  return { appId, app, appInfo, hasManualPrice, iaps, subscriptions, hasCustomEula, versions };
}
