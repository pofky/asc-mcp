import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLicense, clearLicenseCache } from "../src/license.js";

// The license client decides Free vs Pro for the whole server. If it ever
// returns "pro" for an invalid/expired key, free users get paid tools; if it
// returns "free" for a valid key, a paying customer is locked out. Both are
// revenue bugs, so the resolution logic is pinned here.
function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
    })),
  );
}

describe("validateLicense", () => {
  beforeEach(() => clearLicenseCache());
  afterEach(() => vi.unstubAllGlobals());

  it("returns free when no key is provided (never calls the server)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await validateLicense(undefined)).toBe("free");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns pro for a valid pro key", async () => {
    mockFetchOnce({ valid: true, tier: "pro" });
    expect(await validateLicense("ASC-VALID")).toBe("pro");
  });

  it("returns free for an invalid key", async () => {
    mockFetchOnce({ valid: false, tier: "free" });
    expect(await validateLicense("ASC-BOGUS")).toBe("free");
  });

  it("returns free for an expired key even if tier says pro", async () => {
    mockFetchOnce({ valid: false, tier: "pro", reason: "expired" });
    expect(await validateLicense("ASC-EXPIRED")).toBe("free");
  });

  it("fails open to free on a non-200 response", async () => {
    mockFetchOnce({}, false, 500);
    expect(await validateLicense("ASC-WHATEVER")).toBe("free");
  });

  it("fails open to free on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await validateLicense("ASC-WHATEVER")).toBe("free");
  });

  it("caches the result and does not re-hit the server within the TTL", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ valid: true, tier: "pro" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await validateLicense("ASC-VALID")).toBe("pro");
    expect(await validateLicense("ASC-VALID")).toBe("pro");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// The .mcpb bundle declares the license key as optional, and an optional field
// left blank can arrive as the literal placeholder instead of as an absent
// variable. Sending that to /validate is a guaranteed-invalid round trip on
// every start for someone who has simply not bought anything yet.
describe("license key placeholder from an .mcpb install", () => {
  it("treats an unsubstituted placeholder as no key", async () => {
    expect(await validateLicense("${user_config.asc_license_key}")).toBe("free");
  });
  it("treats whitespace as no key", async () => {
    expect(await validateLicense("   ")).toBe("free");
  });
});

/**
 * A licence-server outage must not demote a paying customer.
 *
 * Validation used to return "free" on any non-ok response and on any network
 * error, and the only cache was in memory, so every new session during an
 * outage silently dropped a subscriber to the free tier with a message telling
 * them to buy what they had already bought.
 */
describe("offline grace when the license server cannot answer", () => {
  const home = mkdtempSync(join(tmpdir(), "asc-offline-"));
  const KEY = "ASC-AAAAA-BBBBB-CCCCC-DDDDD";
  const realHome = process.env.HOME;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.HOME = home;
    clearLicenseCache();
  });
  afterEach(() => {
    process.env.HOME = realHome;
    globalThis.fetch = realFetch;
    clearLicenseCache();
  });

  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status })) as never;
  };

  it("keeps a confirmed subscriber on Pro through a 500 and through a network error", async () => {
    respond({ valid: true, tier: "pro" });
    expect(await validateLicense(KEY)).toBe("pro");

    clearLicenseCache();
    respond({ error: "Internal error" }, 500);
    expect(await validateLicense(KEY)).toBe("pro");

    clearLicenseCache();
    globalThis.fetch = (async () => {
      throw new Error("ENOTFOUND");
    }) as never;
    expect(await validateLicense(KEY)).toBe("pro");
  });

  it("never grants Pro to a different key, and honours a 4xx verdict", async () => {
    respond({ valid: true, tier: "pro" });
    await validateLicense(KEY);

    clearLicenseCache();
    respond({ error: "nope" }, 500);
    expect(await validateLicense("ASC-SOMEONE-ELSES-KEY")).toBe("free");

    // A 4xx is a real verdict on the key, not our plumbing failing.
    clearLicenseCache();
    respond({ error: "bad_request" }, 400);
    expect(await validateLicense(KEY)).toBe("free");
  });

  it("does not remember a free verdict, so an outage cannot upgrade anyone", async () => {
    const never = "ASC-NEVER-WAS-PRO-00000";
    respond({ valid: false, tier: "free" });
    expect(await validateLicense(never)).toBe("free");

    clearLicenseCache();
    respond({}, 503);
    expect(await validateLicense(never)).toBe("free");
  });
});
