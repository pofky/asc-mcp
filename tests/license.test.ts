import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
