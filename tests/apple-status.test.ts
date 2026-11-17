import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth.js", () => ({
  getToken: vi.fn(async () => "tok"),
  clearTokenCache: vi.fn(),
}));

import { parseStatusFeed, ongoingAscOutages, setStatusFetch, outageLine } from "../src/apple-status.js";
import { ASCAPIError } from "../src/client.js";
import { explainError, explainErrorLive } from "../src/errors.js";
import { runDoctor, formatDoctor } from "../src/doctor.js";
import { clearLicenseCache } from "../src/license.js";

const feed = (events: unknown[], name = "App Store Connect API  ") =>
  `jsonCallback(${JSON.stringify({
    services: [
      { serviceName: "Apple Music", events: [{ eventStatus: "ongoing", startDate: "x", usersAffected: "y", message: "m" }] },
      { serviceName: name, events },
    ],
  })});`;

const ongoing = { eventStatus: "ongoing", startDate: "11/17/2026 09:10 PST", usersAffected: "Everyone", message: "down" };
const asFetch = (body: string, ok = true) => async () => ({ ok, text: async () => body });

describe("parseStatusFeed", () => {
  it("strips the JSONP wrapper, trims the service name, keeps only ongoing App Store Connect events", () => {
    const out = parseStatusFeed(feed([ongoing, { ...ongoing, eventStatus: "resolved" }]));
    expect(out).toEqual([{ service: "App Store Connect API", startDate: ongoing.startDate, usersAffected: "Everyone", message: "down" }]);
  });
  it("returns [] when nothing is ongoing and null for garbage", () => {
    expect(parseStatusFeed(feed([{ ...ongoing, eventStatus: "resolved" }]))).toEqual([]);
    expect(parseStatusFeed("not json")).toBeNull();
    expect(parseStatusFeed("{ nope }")).toBeNull();
  });
  it("ignores services that do not start with App Store Connect", () => {
    expect(parseStatusFeed(feed([ongoing], "Apple Pay"))).toEqual([]);
  });
});

describe("feed fetching", () => {
  afterEach(() => setStatusFetch());
  it("never throws and returns null on a failed fetch or non-ok response", async () => {
    setStatusFetch(async () => { throw new Error("boom"); });
    expect(await ongoingAscOutages()).toBeNull();
    setStatusFetch(asFetch("x", false));
    expect(await ongoingAscOutages()).toBeNull();
  });
  it("caches for a short while", async () => {
    const f = vi.fn(asFetch(feed([ongoing])));
    setStatusFetch(f);
    await ongoingAscOutages();
    await ongoingAscOutages();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("5xx explanation", () => {
  afterEach(() => setStatusFetch());
  const read5xx = () => new ASCAPIError(500, "/v1/apps", "down");
  const write5xx = () => new ASCAPIError(503, "/v1/appInfos/1", "down", true);

  it("says Apple is down when the feed has an ongoing event", async () => {
    setStatusFetch(asFetch(feed([ongoing])));
    const t = await explainErrorLive(read5xx());
    expect(t).toContain("Apple reports an ongoing App Store Connect outage (App Store Connect API, since 11/17/2026 09:10 PST, Everyone). Nothing to fix on your side; retry after Apple clears it: https://developer.apple.com/system-status/");
    expect(t).not.toContain("matching read tool");
  });
  it("keeps the write caveat for writes", async () => {
    setStatusFetch(asFetch(feed([ongoing])));
    expect(await explainErrorLive(write5xx())).toContain("check first with the matching read tool");
  });
  it("keeps the old hint with no outage or an unreadable feed", async () => {
    const old = explainError(read5xx());
    setStatusFetch(asFetch(feed([])));
    expect(await explainErrorLive(read5xx())).toBe(old);
    setStatusFetch(async () => { throw new Error("offline"); });
    expect(await explainErrorLive(read5xx())).toBe(old);
  });
  it("does not consult the feed for a 4xx", async () => {
    const f = vi.fn(asFetch(feed([ongoing])));
    setStatusFetch(f);
    await explainErrorLive(new ASCAPIError(404, "/v1/apps/1", "{}"));
    expect(f).not.toHaveBeenCalled();
  });
  it("outageLine omits missing fields", () => {
    expect(outageLine({ service: "S", startDate: "", usersAffected: "", message: "" })).toContain("outage (S).");
  });
});

describe("asc_setup_check on a 5xx", () => {
  const SAVED = { ...process.env };
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "asc-status-"));
    const key = join(dir, "AuthKey_ABCDE12345.p8");
    writeFileSync(key, "x");
    process.env.ASC_KEY_ID = "ABCDE12345";
    process.env.ASC_ISSUER_ID = "00000000-0000-0000-0000-000000000000";
    process.env.ASC_PRIVATE_KEY_PATH = key;
    delete process.env.ASC_LICENSE_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  });
  afterEach(() => {
    process.env = { ...SAVED };
    clearLicenseCache();
    setStatusFetch();
    vi.unstubAllGlobals();
  });
  const live = async () => formatDoctor(await runDoctor());

  it("never suggests regenerating the key, and names the outage when there is one", async () => {
    setStatusFetch(asFetch(feed([ongoing])));
    const t = await live();
    expect(t).toContain("App Store Connect returned 500");
    expect(t).toContain("Apple reports an ongoing App Store Connect outage");
    expect(t).not.toMatch(/regenerate/i);
  });
  it("says it is Apple's side without an outage line when the feed shows nothing", async () => {
    setStatusFetch(async () => { throw new Error("offline"); });
    const t = await live();
    expect(t).toContain("This is Apple's side");
    expect(t).not.toMatch(/regenerate/i);
    expect(t).not.toContain("ongoing App Store Connect outage");
  });
});
