/**
 * Apple's own developer status feed, read only to explain a failure.
 *
 * During a multi-hour App Store Connect outage every tool said "Apple 500, retry
 * shortly" and the setup check said to regenerate the key. The feed names the
 * outage; this module fetches it, caches it briefly, and never throws: any
 * failure (network, timeout, a changed format) reads as "no known outage" and
 * the caller keeps its ordinary hint.
 */

export const STATUS_FEED_URL = "https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js";
export const STATUS_PAGE_URL = "https://developer.apple.com/system-status/";
/** Short, so a broken feed never makes an error reply feel slow. */
export const STATUS_TIMEOUT_MS = 5_000;
/** An outage does not start or end faster than this matters for a retry hint. */
export const STATUS_CACHE_MS = 2 * 60_000;
const SERVICE_PREFIX = "App Store Connect";

export interface AppleOutage {
  service: string;
  startDate: string;
  usersAffected: string;
  message: string;
}

type FeedFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

let fetchImpl: FeedFetch | undefined;
let cache: { at: number; outages: AppleOutage[] | null } | undefined;

/** Tests inject a fetch here; call with no argument to restore the real one. */
export function setStatusFetch(f?: FeedFetch): void {
  fetchImpl = f;
  cache = undefined;
}

/** The JSON sits between the first "{" and the last "}" of the JSONP-like file. */
export function parseStatusFeed(text: string): AppleOutage[] | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(text.slice(start, end + 1)) as { services?: unknown };
    if (!Array.isArray(data.services)) return null;
    const out: AppleOutage[] = [];
    for (const s of data.services as Array<{ serviceName?: unknown; events?: unknown }>) {
      const name = typeof s?.serviceName === "string" ? s.serviceName.trim() : "";
      if (!name.startsWith(SERVICE_PREFIX) || !Array.isArray(s.events)) continue;
      for (const e of s.events as Array<Record<string, unknown>>) {
        if (e?.eventStatus !== "ongoing") continue;
        out.push({
          service: name,
          startDate: typeof e.startDate === "string" ? e.startDate : "",
          usersAffected: typeof e.usersAffected === "string" ? e.usersAffected : "",
          message: typeof e.message === "string" ? e.message : "",
        });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Ongoing App Store Connect events, [] when none, null when the feed could not be read. */
export async function ongoingAscOutages(): Promise<AppleOutage[] | null> {
  if (cache && Date.now() - cache.at < STATUS_CACHE_MS) return cache.outages;
  let outages: AppleOutage[] | null = null;
  try {
    const f = fetchImpl ?? ((u: string, i: { signal: AbortSignal }) => fetch(u, i));
    const res = await f(STATUS_FEED_URL, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    if (res.ok) outages = parseStatusFeed(await res.text());
  } catch {
    outages = null;
  }
  cache = { at: Date.now(), outages };
  return outages;
}

/** The one outage worth naming, or null when there is none or the feed is unreadable. */
export async function currentAscOutage(): Promise<AppleOutage | null> {
  const all = await ongoingAscOutages();
  return all && all.length > 0 ? all[0] : null;
}

/** The sentence shown to the user and the agent. */
export function outageLine(o: AppleOutage): string {
  const since = o.startDate ? `, since ${o.startDate}` : "";
  const users = o.usersAffected ? `, ${o.usersAffected}` : "";
  return `Apple reports an ongoing App Store Connect outage (${o.service}${since}${users}). Nothing to fix on your side; retry after Apple clears it: ${STATUS_PAGE_URL}`;
}
