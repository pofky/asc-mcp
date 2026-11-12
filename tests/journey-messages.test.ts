/**
 * Replies that decide what a person or an agent does next.
 *
 * Each case drives a tool with a fake client and checks two things: the reply
 * says what the code really did (and did not do), and it names the next step
 * and who takes it. Three of them pin real bugs found by the journey audit:
 * a false "Nothing to set", a phased release started on an unreleased version,
 * and a sales reply the preview gate could not recognise as empty.
 */
import { describe, it, expect } from "vitest";
import { ASCAPIError } from "../src/client.js";
import { setAppMetadata, setAppPrice } from "../src/tools/submission.js";
import { managePhasedRelease } from "../src/tools/release-control.js";
import { submitForReview } from "../src/tools/version-control.js";
import { salesReport } from "../src/tools/sales-report.js";
import { previewReplyKind } from "../src/gate.js";
import { TOOL_NAMES } from "../src/tool-meta.js";

type Call = { method: string; path: string; body?: unknown };

/** Routes by path prefix; anything unrouted answers an empty list. */
function fake(routes: Record<string, unknown | (() => unknown)>, calls: Call[] = []) {
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => path === k) ?? Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return { data: [] };
    const v = routes[key];
    const out = typeof v === "function" ? (v as () => unknown)() : v;
    if (out instanceof Error) throw out;
    return out;
  };
  return {
    calls,
    client: {
      get: async (p: string) => answer("GET", p),
      getAll: async (p: string) => answer("GET", p),
      post: async (p: string, b: unknown) => answer("POST", p, b),
      patch: async (p: string, b: unknown) => answer("PATCH", p, b),
      del: async (p: string) => answer("DELETE", p),
    } as never,
  };
}

const version = (state: string, id = "v1") => ({
  data: [{ id, attributes: { versionString: "1.2.0", appStoreState: state, platform: "IOS" } }],
});

describe("set_app_metadata says what it applied and what it could not", () => {
  it("does not claim 'Nothing to set' when only encryption was passed and no build exists", async () => {
    const { client, calls } = fake({
      "/v1/apps/1/appStoreVersions": version("PREPARE_FOR_SUBMISSION"),
      "/v1/appStoreVersions/v1/build": new ASCAPIError(404, "/v1/appStoreVersions/v1/build", "{}"),
      "/v1/builds": { data: [] },
    });
    const out = await setAppMetadata(client, { app_id: "1", uses_non_exempt_encryption: false }, "pro");
    expect(out).not.toContain("Nothing to set");
    expect(out).toMatch(/^Export compliance was not set/);
    expect(out).toContain("upload_binary");
    expect(out).toContain("wait_for_build");
    expect(out).toContain("attach_build");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("keeps 'Nothing to set' for a call with no field, and lists the real argument names", async () => {
    const { client } = fake({});
    const out = await setAppMetadata(client, { app_id: "1" }, "pro");
    expect(out).toMatch(/^Nothing to set/);
    for (const name of ["primary_category", "secondary_category", "copyright", "content_rights", "uses_non_exempt_encryption"]) {
      expect(out).toContain(name);
    }
  });

  it("reports the category it already applied when copyright has no version to go on", async () => {
    const { client, calls } = fake({
      "/v1/apps/1/appStoreVersions": version("READY_FOR_SALE"),
      "/v1/apps/1/appInfos": { data: [{ id: "info1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] },
    });
    const out = await setAppMetadata(client, { app_id: "1", primary_category: "HEALTH_AND_FITNESS", copyright: "2026 X" }, "pro");
    expect(calls.some((c) => c.method === "PATCH" && c.path === "/v1/appInfos/info1")).toBe(true);
    expect(out).toMatch(/^Copyright was not set/);
    expect(out).toContain("Already applied: primary category HEALTH_AND_FITNESS");
    expect(out).toContain("create_version");
  });

  it("appends the skipped export compliance to a partial success", async () => {
    const { client } = fake({
      "/v1/apps/1/appStoreVersions": version("PREPARE_FOR_SUBMISSION"),
      "/v1/appStoreVersions/v1/build": new ASCAPIError(404, "/x", "{}"),
      "/v1/builds": { data: [] },
    });
    const out = await setAppMetadata(client, { app_id: "1", copyright: "2026 X", uses_non_exempt_encryption: false }, "pro");
    expect(out).toContain('- copyright "2026 X"');
    expect(out).toContain("Export compliance was not set");
  });
});

describe("set_app_price", () => {
  it("does not present the requested price as the current one when Apple refuses a second schedule", async () => {
    const { client } = fake({
      "/v1/appPriceSchedules/1/manualPrices": { data: [] },
      "/v1/apps/1/appPricePoints": { data: [{ id: "pp", attributes: { customerPrice: "4.99" } }] },
      "/v1/appPriceSchedules": new ASCAPIError(409, "/v1/appPriceSchedules", "already exists"),
    });
    const out = await setAppPrice(client, { app_id: "1", price_usd: 4.99, confirm: true }, "pro");
    expect(out).toMatch(/^Nothing was changed/);
    expect(out).not.toContain("Current base");
    expect(out).toContain("The requested $4.99 was not applied");
  });
});

describe("manage_phased_release", () => {
  it("refuses to start on a version that is not approved or live", async () => {
    const { client, calls } = fake({ "/v1/apps/1/appStoreVersions": version("PREPARE_FOR_SUBMISSION") });
    const out = await managePhasedRelease(client, { app_id: "1", action: "start", confirm: true }, "pro");
    expect(out).toMatch(/^Nothing was changed/);
    expect(out).toContain("PENDING_DEVELOPER_RELEASE");
    expect(out).toContain("review_status");
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("still starts on a live version", async () => {
    const { client, calls } = fake({
      "/v1/apps/1/appStoreVersions": version("READY_FOR_SALE"),
      "/v1/appStoreVersions/v1/appStoreVersionPhasedRelease": new ASCAPIError(404, "/x", "{}"),
    });
    const out = await managePhasedRelease(client, { app_id: "1", action: "start", confirm: true }, "pro");
    expect(out).toContain("Started phased release");
    expect(calls.some((c) => c.method === "POST" && c.path === "/v1/appStoreVersionPhasedReleases")).toBe(true);
  });
});

describe("submit_for_review", () => {
  it("reports the products it already sent when the review submission cannot be opened", async () => {
    const { client } = fake({
      "/v1/apps/1/appStoreVersions": version("PREPARE_FOR_SUBMISSION"),
      "/v1/apps/1/inAppPurchasesV2": { data: [{ id: "i1", attributes: { productId: "com.x.lifetime", state: "READY_TO_SUBMIT" } }] },
      "/v1/apps/1/subscriptionGroups": { data: [] },
      "/v1/inAppPurchaseSubmissions": { data: { id: "s1" } },
      "/v1/reviewSubmissions": () => undefined,
    });
    const out = await submitForReview(client, { app_id: "1", confirm: true }, "pro");
    expect(out).toMatch(/^Could not open a review submission/);
    expect(out).toContain("com.x.lifetime");
    expect(out).toContain("submit_for_review again with confirm: true");
  });
});

describe("sales_report empty replies", () => {
  it("is recognised as empty by the preview gate, so it is not charged", async () => {
    const client = { getReport: async () => "No report available for the requested date range." } as never;
    const out = await salesReport(client, { vendor_number: "12345678", report_date: "2026-01-01" }, "pro");
    expect(out).toMatch(/^No sales report available for 2026-01-01/);
    expect(previewReplyKind(out)).toBe("empty");
    expect(out).toContain("frequency WEEKLY or MONTHLY");
  });

  it("treats a header-only report the same way", async () => {
    const client = { getReport: async () => "Title\tUnits" } as never;
    const out = await salesReport(client, { vendor_number: "12345678", report_date: "2026-01-01" }, "pro");
    expect(previewReplyKind(out)).toBe("empty");
  });
});

describe("tools named in the replies exist", () => {
  it("every tool the new next-step text names is a real tool", async () => {
    const names = new Set<string>(TOOL_NAMES);
    const replies = [
      await setAppMetadata(fake({}).client, { app_id: "1" }, "pro"),
      await managePhasedRelease(
        fake({ "/v1/apps/1/appStoreVersions": version("PREPARE_FOR_SUBMISSION") }).client,
        { app_id: "1", action: "start", confirm: true },
        "pro",
      ),
    ];
    for (const reply of replies) {
      for (const word of reply.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
        // Argument names (primary_category, uses_non_exempt_encryption) are not tools.
        const looksLikeTool = /^(set|create|list|attach|upload|wait|submit|release|review|manage|update|build|app)_/.test(word);
        const isArgument = ["app_id", "primary_category", "secondary_category", "content_rights", "uses_non_exempt_encryption"].includes(word);
        if (looksLikeTool && !isArgument) expect(names.has(word), word).toBe(true);
      }
    }
  });
});
