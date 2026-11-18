/** review_status names the attached build and each product's review state (test-app friction row 25). */
import { describe, it, expect } from "vitest";
import { reviewStatus } from "../src/tools/review-status.js";

type Product = { productId: string; state: string };

function client(opts: { state: string; build?: string; iaps?: Product[] | Error; subs?: Product[] }) {
  return {
    get: async (path: string) => {
      if (path === "/v1/apps/1/appStoreVersions")
        return {
          data: [{
            id: "v1",
            attributes: { versionString: "1.0", platform: "IOS", appStoreState: opts.state, createdDate: "2026-11-18T00:00:00Z" },
            relationships: { build: { data: opts.build ? { type: "builds", id: "b6" } : null } },
          }],
          included: opts.build ? [{ type: "builds", id: "b6", attributes: { version: opts.build, processingState: "VALID" } }] : [],
        };
      if (path === "/v1/apps/1/inAppPurchasesV2") {
        if (opts.iaps instanceof Error) throw opts.iaps;
        return { data: (opts.iaps ?? []).map((p, i) => ({ id: `i${i}`, attributes: p })) };
      }
      if (path === "/v1/apps/1/subscriptionGroups")
        return { data: [], included: (opts.subs ?? []).map((p, i) => ({ type: "subscriptions", id: `s${i}`, attributes: p })) };
      throw new Error("unexpected " + path);
    },
  };
}

describe("review_status", () => {
  it("shows the attached build and that every product went with the version", async () => {
    const out = await reviewStatus(client({
      state: "WAITING_FOR_REVIEW",
      build: "6",
      iaps: [{ productId: "tip.small", state: "WAITING_FOR_REVIEW" }, { productId: "tip.large", state: "WAITING_FOR_REVIEW" }],
    }) as never, { app_id: "1" });
    expect(out).toContain("**Build**: 6 attached");
    expect(out).toContain("- tip.small (in-app purchase): WAITING_FOR_REVIEW");
    expect(out).toContain("All 2 product(s) went to review with this version.");
    expect(out).not.toContain("Not in this review");
  });

  it("warns when the version is in review but a product was left behind", async () => {
    const out = await reviewStatus(client({
      state: "WAITING_FOR_REVIEW",
      build: "6",
      iaps: [{ productId: "tip.small", state: "READY_TO_SUBMIT" }],
      subs: [{ productId: "pro.monthly", state: "WAITING_FOR_REVIEW" }],
    }) as never, { app_id: "1" });
    expect(out).toContain("**Not in this review**: tip.small.");
    expect(out).toContain("cancel_submission");
    expect(out).toContain("- pro.monthly (subscription): WAITING_FOR_REVIEW");
  });

  it("says no build is attached instead of staying silent", async () => {
    const out = await reviewStatus(client({ state: "PREPARE_FOR_SUBMISSION" }) as never, { app_id: "1" });
    expect(out).toContain("**Build**: none attached");
    expect(out).toContain("attach_build");
  });

  it("never reports 'no products' when the product list could not be read", async () => {
    const out = await reviewStatus(client({ state: "WAITING_FOR_REVIEW", build: "6", iaps: new Error("500") }) as never, { app_id: "1" });
    expect(out).toContain("Could not read in-app purchases just now");
    expect(out).not.toContain("went to review with this version");
  });

  it("adds no product section for an app that sells nothing", async () => {
    const out = await reviewStatus(client({ state: "READY_FOR_SALE", build: "3" }) as never, { app_id: "1" });
    expect(out).not.toContain("In-app purchases and subscriptions");
  });
});
