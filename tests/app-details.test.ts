/** Douse friction row 17: app_details shows each version's copyright and the newest version's review contact. */
import { describe, it, expect } from "vitest";
import { appDetails } from "../src/tools/app-details.js";

function client(reviewDetail: unknown | Error) {
  return {
    get: async (path: string) => {
      if (path === "/v1/apps/1") return { data: { id: "1", attributes: { name: "Live", bundleId: "a.b", sku: "s", primaryLocale: "en-US" } } };
      if (path === "/v1/apps/1/appStoreVersions")
        return { data: [
          { id: "v2", attributes: { versionString: "1.0.2", platform: "IOS", appStoreState: "READY_FOR_SALE", createdDate: "2026-09-30T00:00:00Z", copyright: "2026 Jane Doe" } },
          { id: "v1", attributes: { versionString: "1.0.1", platform: "IOS", appStoreState: "REPLACED_WITH_NEW_VERSION", createdDate: "2026-05-10T00:00:00Z", copyright: null } },
        ] };
      if (path === "/v1/appStoreVersions/v2/appStoreReviewDetail") {
        if (reviewDetail instanceof Error) throw reviewDetail;
        return { data: { id: "r", attributes: reviewDetail } };
      }
      throw new Error("unexpected " + path);
    },
  };
}

describe("app_details", () => {
  it("shows copyright per version and the newest review contact", async () => {
    const out = await appDetails(client({ contactFirstName: "Jane", contactLastName: "Doe", contactPhone: "+100", contactEmail: "s@x.com", demoAccountRequired: false }) as never, { app_id: "1" });
    expect(out).toContain("Copyright: 2026 Jane Doe");
    expect(out).toContain("Copyright: not set");
    expect(out).toContain("App Review contact (v1.0.2)");
    expect(out).toContain("**Name**: Jane Doe");
    expect(out).toContain("**Phone**: +100");
    expect(out).toContain("**Email**: s@x.com");
    expect(out).toContain("**Demo account required**: no");
  });

  it("says the contact is not set when Apple has none", async () => {
    const out = await appDetails(client(new Error("404")) as never, { app_id: "1" });
    expect(out).toContain("Not set yet (set_review_contact writes it).");
  });
});
