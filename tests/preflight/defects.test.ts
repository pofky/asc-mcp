import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { releasePreflight } from "../../src/tools/release-preflight.js";
import { APP, AUDIT_READS, BUILD, LOC, VERSION, build, fakeApple, localization, screenshotSets, version } from "./fake-apple.js";

/**
 * The defects PRD-0002 lists, driven through the tool's public entry only, so
 * this file can also be run against the code from before the rewrite. tasks/0002
 * records that run, and a second one asserting each old bug directly. Local URLs
 * are reached with the guard's test seam.
 */
let server: Server;
let base: string;
const NOW = new Date("2026-11-03T14:02:00Z");

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/gone") {
      res.statusCode = 404;
      res.end("no");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(`<html><body>${"real page text ".repeat(40)}</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const deps = () => ({ now: () => NOW, probe: { allowAddress: () => true } });
const clean = () => fakeApple({ support: `${base}/help`, privacy: `${base}/privacy` });
const run = (apple: ReturnType<typeof fakeApple>, extra: Record<string, unknown> = {}) =>
  (releasePreflight as (...a: unknown[]) => Promise<string>)(apple.client, { app_id: APP, ...extra }, "pro", deps());
const CLEAN_VERDICT = /NO BLOCKING ISSUES FOUND/;

describe("the defects the old tool had", () => {
  it("baseline: a complete record reports no blocking issues and disclaims a prediction", async () => {
    const out = await run(clean());
    expect(out).toMatch(CLEAN_VERDICT);
    expect(out).toContain("This is not a prediction of App Review's decision.");
    expect(out).toContain("rules 2026-");
  });

  it.each(AUDIT_READS)("D1: a 403 on %s can never read as clean, and says why", async (path) => {
    const apple = clean();
    apple.fail(path, 403);
    const out = await run(apple);
    expect(out).not.toMatch(CLEAN_VERDICT);
    expect(out).toMatch(/NOT CONFIRMED|BLOCKED/);
    expect(out).toContain("UNKNOWN");
    expect(out).toContain("403");
  });

  it("D2: never says ready to submit, in any outcome", async () => {
    expect(await run(clean())).not.toMatch(/ready to submit|safe to submit|will pass|approved/i);
    const failing = clean();
    failing.set(`/v1/appStoreVersions/${VERSION}/build`, { data: null });
    expect(await run(failing)).not.toMatch(/ready to submit|safe to submit|will pass/i);
  });

  it.each(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"])("D3: a %s version is audited, not skipped for the live one", async (state) => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version("live", "IOS", "1.0", "READY_FOR_SALE", "2026-11-01T00:00:00Z"), version(VERSION, "IOS", "2.0", state, "2026-10-01T00:00:00Z")],
    });
    apple.set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: [localization({ supportUrl: `${base}/help`, whatsNew: "Fixes" })] });
    const out = await run(apple);
    expect(out).toContain(`v2.0`);
    expect(out).toContain(state);
    expect(out).not.toContain("No version is being prepared");
    expect(out).toContain("UNKNOWN  version.rejected");
    expect(out).toMatch(/NOT CONFIRMED|BLOCKED/);
    expect(out).not.toMatch(CLEAN_VERDICT);
  });

  it("a version the developer withdrew has no rejection to read", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, { data: [version(VERSION, "IOS", "2.0", "DEVELOPER_REJECTED")] });
    const out = await run(apple);
    expect(out).toMatch(CLEAN_VERDICT);
    expect(out).not.toContain("version.rejected");
  });

  it("D4: an app with iOS and macOS versions gets a section for each", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION"), version("mac", "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")],
    });
    apple.set(`/v1/appStoreVersions/mac/appStoreVersionLocalizations`, { data: [localization({ supportUrl: `${base}/help` }, "macloc")] });
    apple.set(`/v1/appStoreVersionLocalizations/macloc/appScreenshotSets`, screenshotSets([]));
    apple.set(`/v1/appStoreVersions/mac/build`, build());
    apple.set(`/v1/appStoreVersions/mac/appStoreReviewDetail`, { data: null });
    const out = await run(apple);
    expect(out).toContain("v2.0 (iOS)");
    expect(out).toContain("v3.0 (macOS)");
    expect(out).toContain("APP_DESKTOP");
  });

  it("D4: platform narrows the audit to one", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION"), version("mac", "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")],
    });
    const out = await run(apple, { platform: "IOS" });
    expect(out).toContain("v2.0");
    expect(out).not.toContain("v3.0");
  });

  it("D5: an iPad-capable build without a 13-inch set fails; an iPhone-only one does not", async () => {
    const universal = clean();
    universal.set(`/v1/appStoreVersions/${VERSION}/build`, build({ iconAssetToken: { templateUrl: "https://x/thumb/AppIcon76x76@2x_U007eipad.png/{w}x{h}bb.{f}" } }));
    const blocked = await run(universal);
    expect(blocked).toMatch(/BLOCKED/);
    expect(blocked).toContain("APP_IPAD_PRO_3GEN_129");

    const iphone = await run(clean());
    expect(iphone).toMatch(CLEAN_VERDICT);
  });

  it("D5: a single large iPhone set is enough, as real apps in review show", async () => {
    const out = await run(clean());
    expect(out).not.toMatch(/Missing screenshot set for APP_IPHONE_65/);
    expect(out).toMatch(CLEAN_VERDICT);
  });

  it("D5: macOS is not judged by iPhone rules", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, { data: [version(VERSION, "MAC_OS", "2.0", "PREPARE_FOR_SUBMISSION")] });
    apple.set(`/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`, screenshotSets(["APP_DESKTOP"]));
    const out = await run(apple);
    expect(out).not.toContain("APP_IPHONE");
    expect(out).toMatch(CLEAN_VERDICT);
  });

  it("D6: an empty screenshot set fails", async () => {
    const apple = clean();
    apple.set(`/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`, screenshotSets(["APP_IPHONE_67"], []));
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("no images");
  });

  it("D6: a failed upload fails", async () => {
    const apple = clean();
    apple.set(`/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`, screenshotSets(["APP_IPHONE_67"], ["COMPLETE", "FAILED"]));
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("did not finish uploading");
  });

  it("D6: every locale's sets are read, past the old limit of five", async () => {
    const apple = clean();
    const locs = Array.from({ length: 7 }, (_, i) => localization({ locale: `l${i}`, supportUrl: `${base}/help` }, `loc${i}`));
    apple.set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: locs });
    for (let i = 0; i < 7; i++) apple.set(`/v1/appStoreVersionLocalizations/loc${i}/appScreenshotSets`, screenshotSets(i === 6 ? [] : ["APP_IPHONE_67"]));
    apple.set(`/v1/appStoreVersionLocalizations/loc6/appScreenshotSets`, screenshotSets(["APP_IPHONE_67"], ["FAILED"]));
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("[l6]");
  });

  it("D7: a dead support URL fails, with the status and when it was checked", async () => {
    const apple = fakeApple({ support: `${base}/gone`, privacy: `${base}/privacy` });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("url.support.live");
    expect(out).toContain("404");
    expect(out).toContain("2026-11-03 14:02 UTC");
  });

  it("D7: a missing privacy policy URL is a failure, not a warning", async () => {
    const apple = fakeApple({ support: `${base}/help` });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("url.privacy.set");
  });

  it("D7: a missing privacy URL in a second language warns, and in the primary language fails", async () => {
    const apple = clean();
    apple.set(`/v1/appInfos/info1/appInfoLocalizations`, { data: [
      { id: "a", attributes: { locale: "en-US", name: "Test App", subtitle: null, privacyPolicyUrl: `${base}/privacy` } },
      { id: "b", attributes: { locale: "de-DE", name: "Test App", subtitle: null, privacyPolicyUrl: null } },
    ] });
    const out = await run(apple);
    expect(out).toMatch(CLEAN_VERDICT);
    expect(out).toContain("WARN  url.privacy.set  [de-DE]");
  });

  it("D8: a first release numbered 2.0 is not failed for an empty What's New", async () => {
    expect(await run(clean())).toMatch(CLEAN_VERDICT);
  });

  it("D8: an update numbered 1.0.0 is failed for an empty What's New", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "1.0.0", "PREPARE_FOR_SUBMISSION", "2026-11-01T00:00:00Z"), version("old", "IOS", "0.9", "READY_FOR_SALE", "2026-01-01T00:00:00Z")],
    });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("meta.whatsnew");
  });

  it("D9: products past the first page are read", async () => {
    const apple = clean();
    const page2 = `/v1/apps/${APP}/inAppPurchasesV2?cursor=2`;
    apple.routes.set(`/v1/apps/${APP}/inAppPurchasesV2`, (params) =>
      params.cursor
        ? { data: [{ id: "i2", attributes: { productId: "second.page", state: "DEVELOPER_ACTION_NEEDED" } }] }
        : { data: [{ id: "i1", attributes: { productId: "first.page", state: "APPROVED" } }], links: { next: `https://api.appstoreconnect.apple.com${page2}` } },
    );
    const out = await run(apple);
    expect(out).toContain("second.page");
    expect(out).toMatch(/BLOCKED/);
  });

  it("D9: a page that fails makes the answer incomplete, not short", async () => {
    const apple = clean();
    apple.routes.set(`/v1/apps/${APP}/inAppPurchasesV2`, (params) => {
      if (!params.cursor) return { data: [], links: { next: `https://api.appstoreconnect.apple.com/v1/apps/${APP}/inAppPurchasesV2?cursor=2` } };
      throw new Error("page two failed");
    });
    const out = await run(apple);
    expect(out).toMatch(/NOT CONFIRMED/);
  });

  it("D10: DEVELOPER_ACTION_NEEDED is a failure", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/inAppPurchasesV2`, { data: [{ id: "i", attributes: { productId: "sent.back", state: "DEVELOPER_ACTION_NEEDED" } }] });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("sent.back");
  });

  describe("D11: subscription terms", () => {
    const withSubscription = (description: string | null, eula: unknown = { data: null }) => {
      const apple = clean();
      apple.set(`/v1/apps/${APP}/subscriptionGroups`, { data: [{ id: "g1", type: "subscriptionGroups", attributes: {} }] });
      apple.set(`/v1/subscriptionGroups/g1/subscriptions`, { data: [{ id: "s1", attributes: { productId: "sub.monthly", state: "APPROVED" } }] });
      apple.set(`/v1/apps/${APP}/endUserLicenseAgreement`, eula);
      apple.set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: [localization({ description, supportUrl: `${base}/help` })] });
      return apple;
    };

    it("a custom EULA in App Store Connect satisfies it with no link", async () => {
      const out = await run(withSubscription("A complete description with no link in it at all.", { data: { id: "e1", attributes: {} } }));
      expect(out).toMatch(CLEAN_VERDICT);
    });

    it("D1: a 403 on the licence agreement cannot read as clean for a subscription app", async () => {
      const apple = withSubscription("A complete description with no link in it at all.");
      apple.fail(`/v1/apps/${APP}/endUserLicenseAgreement`, 403);
      const out = await run(apple);
      expect(out).toMatch(/NOT CONFIRMED/);
      expect(out).toContain("sub.terms");
    });

    it("a link that does not look like Terms is a warning, since only a person can tell", async () => {
      const out = await run(withSubscription(`Great app, read everything here.\nMore: ${base}/conditions`));
      expect(out).toMatch(CLEAN_VERDICT);
      expect(out).toContain("WARN  sub.terms");
    });

    it("a dead terms link fails", async () => {
      const out = await run(withSubscription(`Great app, read everything here.\nTerms of Use: ${base}/gone`));
      expect(out).toMatch(/BLOCKED/);
      expect(out).toContain("url.terms.live");
    });

    it("the report does not claim Apple auto-rejects", async () => {
      const out = await run(withSubscription("A complete description with no link in it at all."));
      expect(out).toMatch(/BLOCKED/);
      expect(out).toContain("sub.terms");
      expect(out).not.toMatch(/auto-reject/i);
      expect(out).toContain("3.1.2(c)");
    });
  });

  it("D12: each Apple resource is fetched once", async () => {
    const apple = clean();
    await run(apple);
    const counts = new Map<string, number>();
    for (const path of apple.calls) counts.set(path, (counts.get(path) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n > 1);
    expect(repeated).toEqual([]);
  });

  it("a price schedule with no price rows is a failure, which the old check passed", async () => {
    const apple = clean();
    apple.set(`/v1/apps/${APP}/appPriceSchedule`, { data: { id: APP, type: "appPriceSchedules" } });
    apple.set(`/v1/appPriceSchedules/${APP}/manualPrices`, { data: [] });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("app.price");
  });

  it("an expired build on an unsubmitted version fails, which the old check passed", async () => {
    const apple = clean();
    apple.set(`/v1/appStoreVersions/${VERSION}/build`, build({ expired: true }));
    apple.set(`/v1/builds/${BUILD}`, { data: { id: BUILD }, included: [] });
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("expired");
  });

  it("unanswered export compliance fails, which the old check never looked at", async () => {
    const apple = clean();
    apple.set(`/v1/appStoreVersions/${VERSION}/build`, build({ usesNonExemptEncryption: null }));
    const out = await run(apple);
    expect(out).toMatch(/BLOCKED/);
    expect(out).toContain("build.encryption");
  });
});
