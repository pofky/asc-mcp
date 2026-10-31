import { beforeEach, describe, expect, it } from "vitest";
import { releasePreflight } from "../../src/tools/release-preflight.js";
import { setAgeRating } from "../../src/tools/age-rating.js";
import { attachBuild } from "../../src/tools/builds.js";
import { setAppMetadata, setAppPrice, setReviewContact } from "../../src/tools/submission.js";
import { uploadScreenshots } from "../../src/tools/screenshots.js";
import { submitForReview } from "../../src/tools/version-control.js";
import { updateVersionMetadata } from "../../src/tools/update-version-metadata.js";
import type { ASCClient } from "../../src/client.js";
import { APP, BUILD, INFO, LOC, VERSION, build, fakeApple, localization, version } from "./fake-apple.js";

/**
 * The F1 loop: a failing rule, the fix tool the report names, a re-run. The fake
 * applies each write to what later reads return, so this only passes when the
 * fix writes the field the check reads, on the record the check looked at.
 */
const NOW = new Date("2026-11-03T14:02:00Z");
/** Any existing file: the tool only checks it exists before it picks a version. */
const SCREENSHOT = new URL(import.meta.url).pathname;
type Apple = ReturnType<typeof fakeApple>;

interface Write {
  method: string;
  path: string;
  body: { data: { attributes?: Record<string, unknown>; relationships?: Record<string, { data: unknown }>; id?: string } };
}

/** Merges a PATCH into every object with that id, wherever a read returns it. */
function merge(node: unknown, id: string, patch: Write["body"]["data"]): void {
  if (Array.isArray(node)) return node.forEach((n) => merge(n, id, patch));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj.id === id && "attributes" in obj || (obj.id === id && patch.relationships)) {
    if (patch.attributes) obj.attributes = { ...(obj.attributes as object), ...patch.attributes };
    if (patch.relationships) obj.relationships = { ...(obj.relationships as object), ...patch.relationships };
  }
  for (const v of Object.values(obj)) merge(v, id, patch);
}

function stateful(apple: Apple): { client: ASCClient; writes: Write[] } {
  const writes: Write[] = [];
  const bodies = () => [...apple.routes.values()].map((r) => {
    try { return r({}); } catch { return null; }
  });
  const patch = async (path: string, body: Write["body"]) => {
    writes.push({ method: "PATCH", path, body });
    const rel = path.match(/^\/v1\/appStoreVersions\/([^/]+)\/relationships\/build$/);
    if (rel) {
      apple.set(`/v1/appStoreVersions/${rel[1]}/build`, build());
      return { data: null };
    }
    const id = body.data.id!;
    for (const b of bodies()) merge(b, id, body.data);
    return { data: body.data };
  };
  const post = async (path: string, body: Write["body"]) => {
    writes.push({ method: "POST", path, body });
    if (path === "/v1/appPriceSchedules") apple.set(`/v1/appPriceSchedules/${APP}/manualPrices`, { data: [{ id: "new", type: "appPrices", attributes: {} }] });
    if (path === "/v1/appStoreReviewDetails") {
      const v = (body.data.relationships!.appStoreVersion.data as { id: string }).id;
      apple.set(`/v1/appStoreVersions/${v}/appStoreReviewDetail`, { data: { id: "rd-new", attributes: body.data.attributes } });
    }
    return { data: { id: "new", ...body.data } };
  };
  return { client: { ...apple.client, patch, post } as unknown as ASCClient, writes };
}

const audit = (client: ASCClient) =>
  (releasePreflight as (...a: unknown[]) => Promise<string>)(client, { app_id: APP }, "pro", { now: () => NOW, probe: { allowAddress: () => true } });

const failsOn = (report: string, rule: string) => new RegExp(`^(FAIL|WARN)\\s+${rule.replace(".", "\\.")}\\b`, "m").test(report);

/** Sets a route's localization, app or similar record with one change, then proves red, fix, green. */
async function loop(apple: Apple, rule: string, fix: (c: ASCClient) => Promise<string>): Promise<{ first: string; reply: string; second: string; writes: Write[] }> {
  const { client, writes } = stateful(apple);
  const first = await audit(client);
  expect(failsOn(first, rule), `${rule} should be reported first:\n${first}`).toBe(true);
  const reply = await fix(client);
  const second = await audit(client);
  expect(failsOn(second, rule), `${rule} should clear. Fix said: ${reply}\n${second}`).toBe(false);
  return { first, reply, second, writes };
}

const withLoc = (over: Record<string, unknown>) => {
  const a = fakeApple();
  a.set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: [localization(over)] });
  return a;
};
const app = (a: Apple, over: Record<string, unknown>) => {
  const body = a.routes.get(`/v1/apps/${APP}`)!({}) as { data: { attributes: Record<string, unknown> } };
  Object.assign(body.data.attributes, over);
};
const withBuildsList = (a: Apple, ids: string[] = [BUILD]) =>
  a.set("/v1/builds", { data: ids.map((id) => ({ id, type: "builds", attributes: { version: "40" } })) });

describe("each failing rule clears with the fix the report names", () => {
  let apple: Apple;
  beforeEach(() => {
    apple = fakeApple();
  });

  it("meta.description", async () => {
    await loop(withLoc({ description: "" }), "meta.description", (c) => updateVersionMetadata(c, { app_id: APP, description: "A complete description of what this app does." }, "pro"));
  });
  it("meta.keywords", async () => {
    await loop(withLoc({ keywords: "" }), "meta.keywords", (c) => updateVersionMetadata(c, { app_id: APP, keywords: "alpha" }, "pro"));
  });
  it("meta.promo", async () => {
    await loop(withLoc({ promotionalText: "x".repeat(171) }), "meta.promo", (c) => updateVersionMetadata(c, { app_id: APP, promotional_text: "short" }, "pro"));
  });
  it("meta.placeholder", async () => {
    await loop(withLoc({ description: "lorem ipsum dolor sit amet" }), "meta.placeholder", (c) => updateVersionMetadata(c, { app_id: APP, description: "A complete description of what this app does." }, "pro"));
  });
  it("meta.name, on the app info record", async () => {
    apple.set(`/v1/appInfos/${INFO}/appInfoLocalizations`, { data: [{ id: "il1", attributes: { locale: "en-US", name: "", subtitle: null, privacyPolicyUrl: null } }] });
    await loop(apple, "meta.name", (c) => updateVersionMetadata(c, { app_id: APP, name: "Test App" }, "pro"));
  });
  it("url.privacy.set, on the app info record", async () => {
    apple.set(`/v1/appInfos/${INFO}/appInfoLocalizations`, { data: [{ id: "il1", attributes: { locale: "en-US", name: "Test App", subtitle: null, privacyPolicyUrl: null } }] });
    await loop(apple, "url.privacy.set", (c) => updateVersionMetadata(c, { app_id: APP, privacy_policy_url: "https://example.org/privacy" }, "pro"));
  });
  it("url.support.set", async () => {
    await loop(apple, "url.support.set", (c) => updateVersionMetadata(c, { app_id: APP, support_url: "https://example.org/help" }, "pro"));
  });
  it("app.copyright", async () => {
    const noCopyright = version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION");
    (noCopyright.attributes as Record<string, unknown>).copyright = null;
    apple.set(`/v1/apps/${APP}/appStoreVersions`, { data: [noCopyright] });
    await loop(apple, "app.copyright", (c) => setAppMetadata(c, { app_id: APP, copyright: "2026 Test" }, "pro"));
  });
  it("app.content_rights", async () => {
    app(apple, { contentRightsDeclaration: null });
    await loop(apple, "app.content_rights", (c) => setAppMetadata(c, { app_id: APP, content_rights: "DOES_NOT_USE_THIRD_PARTY_CONTENT" }, "pro"));
  });
  it("app.category", async () => {
    const info = apple.routes.get(`/v1/apps/${APP}/appInfos`)!({}) as { data: Array<{ relationships: Record<string, unknown> }> };
    info.data[0].relationships.primaryCategory = { data: null };
    await loop(apple, "app.category", (c) => setAppMetadata(c, { app_id: APP, primary_category: "UTILITIES" }, "pro"));
  });
  it("app.price", async () => {
    apple.set(`/v1/appPriceSchedules/${APP}/manualPrices`, { data: [] });
    apple.set(`/v1/apps/${APP}/appPricePoints`, { data: [{ id: "pp0", attributes: { customerPrice: "0.0" } }] });
    await loop(apple, "app.price", (c) => setAppPrice(c, { app_id: APP, price_usd: 0 }, "pro"));
  });
  it("app.age", async () => {
    const info = apple.routes.get(`/v1/apps/${APP}/appInfos`)!({}) as { included: Array<{ type: string; attributes: Record<string, unknown> }> };
    info.included.find((x) => x.type === "ageRatingDeclarations")!.attributes = {};
    await loop(apple, "app.age", (c) => setAgeRating(c, { app_id: APP, declarations: { violenceCartoonOrFantasy: "NONE" } }, "pro"));
  });
  it("review.contact, when no detail exists yet", async () => {
    apple.fail(`/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`, 404);
    await loop(apple, "review.contact", (c) => setReviewContact(c, { app_id: APP, first_name: "A", last_name: "B", phone: "+1", email: "a@test.invalid" }, "pro"));
  });
  it("review.demo", async () => {
    apple.set(`/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`, { data: { id: "rd", attributes: { contactFirstName: "A", contactLastName: "B", contactPhone: "+1", contactEmail: "a@test.invalid", demoAccountRequired: true, demoAccountName: null } } });
    await loop(apple, "review.demo", (c) => setReviewContact(c, { app_id: APP, first_name: "A", last_name: "B", phone: "+1", email: "a@test.invalid", demo_account_name: "demo", demo_account_password: "pw" }, "pro"));
  });
  it("build.attached", async () => {
    apple.set(`/v1/appStoreVersions/${VERSION}/build`, { data: null });
    withBuildsList(apple);
    await loop(apple, "build.attached", (c) => attachBuild(c, { app_id: APP }, "pro"));
  });
  it("build.encryption, when the attached build is the newest", async () => {
    apple.set(`/v1/appStoreVersions/${VERSION}/build`, build({ usesNonExemptEncryption: null }));
    withBuildsList(apple);
    await loop(apple, "build.encryption", (c) => setAppMetadata(c, { app_id: APP, uses_non_exempt_encryption: false }, "pro"));
  });
});

describe("the fix lands on the record the finding was about", () => {
  it("build.encryption, when a newer build is uploaded than the one attached", async () => {
    const apple = fakeApple();
    apple.set(`/v1/appStoreVersions/${VERSION}/build`, build({ usesNonExemptEncryption: null }));
    withBuildsList(apple, ["newer-build"]);
    await loop(apple, "build.encryption", (c) => setAppMetadata(c, { app_id: APP, uses_non_exempt_encryption: false }, "pro"));
  });

  it("an iOS and a macOS version in progress: a macOS finding is not written to iOS", async () => {
    const apple = fakeApple();
    const mac = "v-mac";
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION"), version(mac, "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")],
    });
    apple.set(`/v1/appStoreVersions/${mac}/appStoreVersionLocalizations`, { data: [localization({ description: "" }, "loc-mac")] });
    apple.set(`/v1/appStoreVersionLocalizations/loc-mac/appScreenshotSets`, { data: [], included: [] });
    apple.set(`/v1/appStoreVersions/${mac}/build`, { data: null });
    apple.fail(`/v1/appStoreVersions/${mac}/appStoreReviewDetail`, 404);
    const { client, writes } = stateful(apple);
    const first = await audit(client);
    expect(first).toMatch(/v3\.0 \(macOS\)[\s\S]*FAIL\s+meta\.description/);
    expect(first).toContain("Fix:  update_version_metadata platform MAC_OS, description");

    const refused = await updateVersionMetadata(client, { app_id: APP, description: "A complete description of what this app does." }, "pro");
    expect(refused).toContain("more than one platform");
    expect(refused).toContain("v3.0 (MAC_OS)");
    expect(writes).toHaveLength(0);

    await updateVersionMetadata(client, { app_id: APP, platform: "MAC_OS", description: "A complete description of what this app does." }, "pro");
    expect(writes.map((w) => w.path)).toEqual(["/v1/appStoreVersionLocalizations/loc-mac"]);
    const second = await audit(client);
    expect(second).not.toMatch(/v3\.0 \(macOS\)[\s\S]*FAIL\s+meta\.description/);
  });

  it("two platforms: an app-level field needs no platform, since it is not about a version", async () => {
    const apple = fakeApple();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION"), version("v-mac", "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")],
    });
    const { client, writes } = stateful(apple);
    await updateVersionMetadata(client, { app_id: APP, name: "Test App" }, "pro");
    expect(writes.map((w) => w.path)).toEqual(["/v1/appInfoLocalizations/il1"]);
  });

  it.each([
    ["attach_build", (c: ASCClient) => attachBuild(c, { app_id: APP }, "pro")],
    ["set_review_contact", (c: ASCClient) => setReviewContact(c, { app_id: APP, first_name: "A", last_name: "B", phone: "+1", email: "a@test.invalid" }, "pro")],
    ["set_app_metadata copyright", (c: ASCClient) => setAppMetadata(c, { app_id: APP, copyright: "2026 Test" }, "pro")],
    ["set_app_metadata, nothing half done", (c: ASCClient) => setAppMetadata(c, { app_id: APP, content_rights: "DOES_NOT_USE_THIRD_PARTY_CONTENT", copyright: "2026 Test" }, "pro")],
    ["upload_screenshots", (c: ASCClient) => uploadScreenshots(c, { app_id: APP, display_type: "APP_IPHONE_67", files: [SCREENSHOT] }, "pro")],
    ["submit_for_review", (c: ASCClient) => submitForReview(c, { app_id: APP, confirm: true }, "pro")],
  ])("two platforms: %s refuses, and writes nothing", async (_name, call) => {
    const apple = fakeApple();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION"), version("v-mac", "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")],
    });
    const { client, writes } = stateful(apple);
    expect(await call(client)).toContain("more than one platform");
    expect(writes).toHaveLength(0);
  });

  it("a Mac-only app with no platform argument submits as macOS, not iOS", async () => {
    const apple = fakeApple();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, { data: [version("v-mac", "MAC_OS", "3.0", "PREPARE_FOR_SUBMISSION")] });
    const { client, writes } = stateful(apple);
    await submitForReview(client, { app_id: APP, confirm: true }, "pro").catch(() => "");
    const opened = writes.find((w) => w.path === "/v1/reviewSubmissions");
    expect(opened?.body.data.attributes?.platform).toBe("MAC_OS");
  });

  it("a platform with nothing in progress is named, not guessed", async () => {
    const apple = fakeApple();
    const { client, writes } = stateful(apple);
    const reply = await updateVersionMetadata(client, { app_id: APP, platform: "MAC_OS", description: "A complete description." }, "pro");
    expect(reply).toContain("no version is in progress on MAC_OS");
    expect(writes).toHaveLength(0);
  });

  it("a locked version plus an editable one: the audit and the fix agree", async () => {
    const apple = fakeApple();
    apple.set(`/v1/apps/${APP}/appStoreVersions`, {
      data: [version("live", "IOS", "1.0", "READY_FOR_SALE", "2026-01-01"), version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION", "2026-10-01")],
    });
    apple.set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: [localization({ description: "", whatsNew: "New things" })] });
    await loop(apple, "meta.description", (c) => updateVersionMetadata(c, { app_id: APP, description: "A complete description of what this app does." }, "pro"));
  });
});

