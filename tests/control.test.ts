import { describe, it, expect } from "vitest";
import { requirePro } from "../src/gate.js";
import { ASCAPIError } from "../src/client.js";
import { listBuilds } from "../src/tools/builds.js";
import { createIAP } from "../src/tools/iap.js";
import { setAppAvailability } from "../src/tools/availability.js";
import { discoverPrivateKey } from "../src/setup.js";
import { updateVersionMetadata } from "../src/tools/update-version-metadata.js";
import { createVersion, submitForReview } from "../src/tools/version-control.js";
import { listBuilds, attachBuild } from "../src/tools/builds.js";
import { uploadScreenshots } from "../src/tools/screenshots.js";
import { releaseVersion, managePhasedRelease } from "../src/tools/release-control.js";
import { listBetaGroups, assignBuildToGroup, inviteBetaTester } from "../src/tools/testflight.js";
import { buildAndArchive, uploadBinary } from "../src/tools/local-build.js";
import { setAgeRating } from "../src/tools/age-rating.js";
import { setPrivacyNutrition } from "../src/tools/privacy.js";
import { setEUTraderStatus } from "../src/tools/eu-trader.js";
import { createSubscription, createIAP } from "../src/tools/iap.js";
import { setIapReviewScreenshot } from "../src/tools/review-screenshot.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stubClient = {} as never;

describe("requirePro gate", () => {
  it("blocks free tier with an upgrade message", () => {
    const msg = requirePro("free", "Editing metadata");
    expect(msg).toContain("Pro license");
    expect(msg).toContain("Editing metadata");
  });
  it("lets pro through (null)", () => {
    expect(requirePro("pro", "Anything")).toBeNull();
  });
});

describe("control tools refuse on free tier before any API call", () => {
  it("update_version_metadata", async () => {
    const r = await updateVersionMetadata(stubClient, { app_id: "1", description: "x" }, "free");
    expect(r).toContain("Pro license");
  });
  it("create_version", async () => {
    const r = await createVersion(stubClient, { app_id: "1", version_string: "2.0" }, "free");
    expect(r).toContain("Pro license");
  });
  it("submit_for_review", async () => {
    const r = await submitForReview(stubClient, { app_id: "1", confirm: true }, "free");
    expect(r).toContain("Pro license");
  });
});

describe("every control tool refuses on free tier before any API call", () => {
  const f = "free" as const;
  it("list_builds", async () => expect(await listBuilds(stubClient, { app_id: "1" }, f)).toContain("Pro license"));
  it("attach_build", async () => expect(await attachBuild(stubClient, { app_id: "1" }, f)).toContain("Pro license"));
  it("upload_screenshots", async () =>
    expect(await uploadScreenshots(stubClient, { app_id: "1", display_type: "APP_IPHONE_67", files: ["/x.png"] }, f)).toContain("Pro license"));
  it("release_version", async () => expect(await releaseVersion(stubClient, { app_id: "1", confirm: true }, f)).toContain("Pro license"));
  it("manage_phased_release", async () =>
    expect(await managePhasedRelease(stubClient, { app_id: "1", action: "start" }, f)).toContain("Pro license"));
  it("list_beta_groups", async () => expect(await listBetaGroups(stubClient, { app_id: "1" }, f)).toContain("Pro license"));
  it("assign_build_to_group", async () =>
    expect(await assignBuildToGroup(stubClient, { app_id: "1", group_id: "g" }, f)).toContain("Pro license"));
  it("invite_beta_tester", async () =>
    expect(await inviteBetaTester(stubClient, { group_id: "g", email: "a@b.com" }, f)).toContain("Pro license"));
  it("build_and_archive", async () =>
    expect(await buildAndArchive({ project_path: "/x", scheme: "S", export_options_plist: "/p" }, f)).toContain("Pro license"));
  it("upload_binary", async () =>
    expect(await uploadBinary({ keyId: "k", issuerId: "i" }, { ipa_path: "/x.ipa", confirm: true }, f)).toContain("Pro license"));
  it("set_age_rating", async () =>
    expect(await setAgeRating(stubClient, { app_id: "1", declarations: { gambling: false } }, f)).toContain("Pro license"));
  it("set_privacy_nutrition", async () =>
    expect(await setPrivacyNutrition({ app_id: "1", data_not_collected: true }, f)).toContain("Pro license"));
  it("set_eu_trader_status", async () =>
    expect(await setEUTraderStatus({ app_id: "1" }, f)).toContain("Pro license"));
  it("create_subscription", async () =>
    expect(
      await createSubscription(
        stubClient,
        { app_id: "1", group_reference_name: "G", group_display_name: "G", product_id: "p", reference_name: "r", display_name: "d", description: "x", period: "ONE_MONTH", price_usd: 4.99 },
        f,
      ),
    ).toContain("Pro license"));
  it("create_iap", async () =>
    expect(
      await createIAP(
        stubClient,
        { app_id: "1", product_id: "p", reference_name: "r", display_name: "d", description: "x", type: "NON_CONSUMABLE", price_usd: 59.99 },
        f,
      ),
    ).toContain("Pro license"));
  it("set_iap_review_screenshot", async () =>
    expect(await setIapReviewScreenshot(stubClient, { app_id: "1", product_id: "p", file: "/x.png" }, f)).toContain("Pro license"));
});

describe("new tools validate before any API call (pro tier)", () => {
  it("set_age_rating rejects an unknown declaration key", async () =>
    expect(await setAgeRating(stubClient, { app_id: "1", declarations: { bogusKey: "NONE" } }, "pro")).toContain("unknown declaration key"));
  it("set_age_rating rejects a bad frequency value", async () =>
    expect(await setAgeRating(stubClient, { app_id: "1", declarations: { medicalOrTreatmentInformation: "SOMETIMES" } }, "pro")).toContain("invalid age-rating"));
  it("set_privacy_nutrition (data not collected) returns the deep-link steps", async () => {
    const r = await setPrivacyNutrition({ app_id: "42", data_not_collected: true }, "pro");
    expect(r).toContain("Data Not Collected");
    expect(r).toContain("/apps/42/distribution/privacy");
  });
  it("set_eu_trader_status returns the deep-link steps", async () => {
    const r = await setEUTraderStatus({ app_id: "42" }, "pro");
    expect(r).toContain("Trader Status");
    expect(r).toContain("/apps/42/");
  });
  it("create_subscription rejects an over-limit display name", async () =>
    expect(
      await createSubscription(
        stubClient,
        { app_id: "1", group_reference_name: "G", group_display_name: "G", product_id: "p", reference_name: "r", display_name: "x".repeat(31), description: "x", period: "ONE_MONTH", price_usd: 4.99 },
        "pro",
      ),
    ).toContain("display_name too long"));
  it("set_iap_review_screenshot reports a missing file", async () =>
    expect(await setIapReviewScreenshot(stubClient, { app_id: "1", product_id: "p", file: "/nope-xyz.png" }, "pro")).toContain("File not found"));
  it("create_iap rejects an over-limit description", async () =>
    expect(
      await createIAP(
        stubClient,
        { app_id: "1", product_id: "p", reference_name: "r", display_name: "d", description: "x".repeat(46), type: "NON_CONSUMABLE", price_usd: 59.99 },
        "pro",
      ),
    ).toContain("description too long"));
});

describe("outward-facing control tools require confirm on pro", () => {
  it("release_version refuses without confirm", async () =>
    expect(await releaseVersion(stubClient, { app_id: "1" }, "pro")).toContain("confirm: true"));
  it("upload_binary refuses without confirm", async () =>
    expect(await uploadBinary({ keyId: "k", issuerId: "i" }, { ipa_path: "/x.ipa" }, "pro")).toContain("confirm: true"));
});

describe("input validation before any API/shell call (pro tier)", () => {
  it("invite_beta_tester rejects bad email", async () =>
    expect(await inviteBetaTester(stubClient, { group_id: "g", email: "not-an-email" }, "pro")).toContain("not a valid email"));
  it("upload_screenshots reports missing files", async () =>
    expect(await uploadScreenshots(stubClient, { app_id: "1", display_type: "APP_IPHONE_67", files: ["/nope-xyz.png"] }, "pro")).toContain("not found"));
  it("build_and_archive reports missing project (after xcodebuild check)", async () => {
    const r = await buildAndArchive({ project_path: "/nope-xyz.xcodeproj", scheme: "S", export_options_plist: "/p" }, "pro");
    // Either xcodebuild is absent, or the project path is reported missing.
    expect(r === null || /not found|xcodebuild/.test(r)).toBe(true);
  });
});

describe("submit_for_review requires explicit confirm", () => {
  it("refuses without confirm even on pro", async () => {
    const r = await submitForReview(stubClient, { app_id: "1" }, "pro");
    expect(r).toContain("confirm: true");
  });
});

describe("update_version_metadata validates character limits before writing", () => {
  it("rejects over-limit subtitle without touching the client", async () => {
    const r = await updateVersionMetadata(
      stubClient,
      { app_id: "1", subtitle: "x".repeat(31) },
      "pro",
    );
    expect(r).toContain("over Apple's character limits");
    expect(r).toContain("subtitle");
  });
});

describe("discoverPrivateKey", () => {
  it("returns null when dir absent", () => {
    expect(discoverPrivateKey(join(tmpdir(), "definitely-not-here-xyz"))).toBeNull();
  });
  it("parses Key ID from AuthKey filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "asc-key-"));
    writeFileSync(join(dir, "AuthKey_ABCDE12345.p8"), "stub");
    const found = discoverPrivateKey(dir);
    expect(found?.keyId).toBe("ABCDE12345");
    expect(found?.path).toContain("AuthKey_ABCDE12345.p8");
  });
});

// Apple returns 409 both for "wrong state" and for "you sent a bad value".
// Telling someone to check their version state when Apple rejected their phone
// number format sends them chasing the wrong thing (found by a live sweep).
describe("ASCAPIError 409 hints", () => {
  const attrBody = JSON.stringify({
    errors: [
      {
        code: "ENTITY_ERROR.ATTRIBUTE.INVALID",
        detail: "The phone number must be in a valid format.",
        source: { pointer: "/data/attributes/contactPhone" },
      },
    ],
  });
  const stateBody = JSON.stringify({
    errors: [{ code: "STATE_ERROR", detail: "The field 'name' can not be modified in the current state" }],
  });

  it("names the rejected field instead of blaming the version state", () => {
    const err = new ASCAPIError(409, "/v1/appStoreReviewDetails", attrBody);
    expect(err.message).toContain("contactPhone");
    expect(err.message).not.toContain("PREPARE_FOR_SUBMISSION");
  });

  it("still explains a genuine state conflict", () => {
    const err = new ASCAPIError(409, "/v1/appInfoLocalizations/x", stateBody);
    expect(err.message).toContain("State conflict");
  });
});

// Found by a live sweep of every write path: these all used to throw a raw API
// error or a TypeError at the caller instead of explaining the problem.
describe("write-path failure messages", () => {
  const stub = (post: () => Promise<unknown>, get?: () => Promise<unknown>) =>
    ({ post, get: get ?? (async () => ({ data: [] })), patch: async () => ({}) }) as never;

  it("create_version explains a version number that was already used", async () => {
    const body = JSON.stringify({
      errors: [{ code: "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE", detail: "The version number has been previously used." }],
    });
    const out = await createVersion(
      stub(async () => {
        throw new ASCAPIError(409, "/v1/appStoreVersions", body);
      }),
      { app_id: "1", version_string: "1.0" },
      "pro",
    );
    expect(out).toContain("already used");
    expect(out).toContain("higher version number");
  });

  it("create_version explains a version that is still open, separately", async () => {
    const body = JSON.stringify({
      errors: [{ code: "ENTITY_ERROR.RELATIONSHIP.INVALID", detail: "You cannot create a new version of the App in the current state." }],
    });
    const out = await createVersion(
      stub(async () => {
        throw new ASCAPIError(409, "/v1/appStoreVersions", body);
      }),
      { app_id: "1", version_string: "2.0" },
      "pro",
    );
    expect(out).toContain("still open or in review");
    expect(out).not.toContain("already used");
  });

  it("list_builds distinguishes an empty app from a wrong app_id", async () => {
    const noApp = await listBuilds(
      {
        get: async (path: string) => {
          if (path === "/v1/builds") return { data: [] };
          throw new ASCAPIError(404, path, "{}");
        },
      } as never,
      { app_id: "999" },
      "pro",
    );
    expect(noApp).toContain("No app with id 999");

    const emptyApp = await listBuilds(
      { get: async (path: string) => (path === "/v1/builds" ? { data: [] } : { data: { id: "1" } }) } as never,
      { app_id: "1" },
      "pro",
    );
    expect(emptyApp).toContain("No builds found for this app");
  });

  it("create_iap names the missing arguments instead of throwing", async () => {
    const out = await createIAP({} as never, { app_id: "1" } as never, "pro");
    expect(out).toContain("product_id");
    expect(out).toContain("display_name");
  });
});

// Taking an app off sale everywhere is the required first step before the
// website lets you remove an app record, and an empty territory list used to
// fall through to "all territories on", i.e. the exact opposite.
describe("set_app_availability territory semantics", () => {
  function stubClient(existing: boolean) {
    const rows = ["USA", "GBR", "JPN"].map((t, i) => ({
      id: `row${i}`,
      attributes: { available: true },
      relationships: { territory: { data: { id: t } } },
    }));
    const patched: Array<{ path: string; available: boolean }> = [];
    const client = {
      getAll: async () => ({ data: ["USA", "GBR", "JPN"].map((id) => ({ id })) }),
      get: async (path: string) => {
        if (path.includes("appAvailabilityV2")) {
          if (!existing) throw new ASCAPIError(404, path, "{}");
          return { data: { id: "avail1", attributes: { availableInNewTerritories: true } } };
        }
        return { data: rows };
      },
      patch: async (path: string, body: { data: { attributes: { available: boolean } } }) => {
        patched.push({ path, available: body.data.attributes.available });
        return {};
      },
      post: async () => ({}),
    } as never;
    return { client, patched };
  }

  it("turns every territory off when given an empty array", async () => {
    const { client, patched } = stubClient(true);
    const out = await setAppAvailability(client, { app_id: "1", territories: [] }, "pro");
    expect(patched.every((p) => p.available === false)).toBe(true);
    expect(patched).toHaveLength(3);
    expect(out).toContain("0 of 3");
    expect(out).toContain("Remove App");
  });

  it("still means all territories when the argument is omitted", async () => {
    const { client, patched } = stubClient(true);
    const out = await setAppAvailability(client, { app_id: "1" }, "pro");
    expect(patched).toHaveLength(0); // already all on, nothing to change
    expect(out).toContain("3 of 3");
  });

  it("patches the v1 territoryAvailabilities path, not v2", async () => {
    const { client, patched } = stubClient(true);
    await setAppAvailability(client, { app_id: "1", territories: ["USA"] }, "pro");
    expect(patched.length).toBeGreaterThan(0);
    expect(patched.every((p) => p.path.startsWith("/v1/territoryAvailabilities/"))).toBe(true);
  });
});
