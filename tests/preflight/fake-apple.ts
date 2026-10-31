import { ASCAPIError, type ASCClient } from "../../src/client.js";

/**
 * A stand-in for Apple's API, labelled test data. Starts as one complete app and
 * each test changes what it is about. Shapes follow responses read from the real
 * API on 2026-10-31. Fails on any route it does not know, so a new fetch is seen.
 */
export type Route = (params: Record<string, string>) => unknown;

export interface FakeApple {
  client: ASCClient;
  routes: Map<string, Route>;
  set(path: string, body: unknown): void;
  fail(path: string, status: number): void;
  calls: string[];
}

export const APP = "100";
export const VERSION = "v1";
export const LOC = "loc1";
export const BUILD = "b1";
export const INFO = "info1";

export function version(id: string, platform: string, versionString: string, state: string, createdDate = "2026-10-01T00:00:00Z") {
  return { id, type: "appStoreVersions", attributes: { versionString, platform, appStoreState: state, createdDate, copyright: "2026 Test" } };
}

export function localization(overrides: Record<string, unknown> = {}, id = LOC) {
  return {
    id,
    type: "appStoreVersionLocalizations",
    attributes: {
      locale: "en-US",
      description: "A complete description of what this app does for you.",
      keywords: "alpha,beta",
      whatsNew: null,
      promotionalText: null,
      marketingUrl: null,
      supportUrl: null,
      ...overrides,
    },
  };
}

export function screenshotSets(types: string[], states: string[] = ["COMPLETE"]) {
  const data = types.map((t, i) => ({
    id: `set${i}`,
    type: "appScreenshotSets",
    attributes: { screenshotDisplayType: t },
    relationships: { appScreenshots: { data: states.map((_, j) => ({ type: "appScreenshots", id: `s${i}-${j}` })) } },
  }));
  const included = types.flatMap((_, i) =>
    states.map((state, j) => ({ id: `s${i}-${j}`, type: "appScreenshots", attributes: { assetDeliveryState: { state } } })),
  );
  return { data, included };
}

export function build(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: BUILD,
      type: "builds",
      attributes: {
        version: "40",
        processingState: "VALID",
        expired: false,
        usesNonExemptEncryption: false,
        iconAssetToken: { templateUrl: "https://x/thumb/AppIcon60x60@2x.png/{w}x{h}bb.{f}" },
        ...overrides,
      },
    },
  };
}

/** A complete record. `supportUrl` and friends are the caller's, since they get loaded. */
export function fakeApple(urls: { support?: string; privacy?: string } = {}): FakeApple {
  const routes = new Map<string, Route>();
  const calls: string[] = [];
  const set = (path: string, body: unknown) => routes.set(path, () => body);
  const fail = (path: string, status: number) =>
    routes.set(path, () => {
      throw new ASCAPIError(status, path, JSON.stringify({ errors: [{ detail: "test" }] }));
    });

  set(`/v1/apps/${APP}/appStoreVersions`, { data: [version(VERSION, "IOS", "2.0", "PREPARE_FOR_SUBMISSION")] });
  set(`/v1/apps/${APP}`, { data: { id: APP, attributes: { name: "Test App", bundleId: "com.test.app", primaryLocale: "en-US", contentRightsDeclaration: "DOES_NOT_USE_THIRD_PARTY_CONTENT" } } });
  set(`/v1/apps/${APP}/appInfos`, {
    data: [{
      id: INFO,
      type: "appInfos",
      attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" },
      relationships: { ageRatingDeclaration: { data: { id: "age1" } }, primaryCategory: { data: { id: "UTILITIES" } } },
    }],
    included: [
      { type: "ageRatingDeclarations", id: "age1", attributes: { violenceCartoonOrFantasy: "NONE" } },
      { type: "appCategories", id: "UTILITIES", attributes: {} },
    ],
  });
  set(`/v1/appInfos/${INFO}/appInfoLocalizations`, { data: [{ id: "il1", attributes: { locale: "en-US", name: "Test App", subtitle: null, privacyPolicyUrl: urls.privacy ?? null } }] });
  set(`/v1/appPriceSchedules/${APP}/manualPrices`, { data: [{ id: "p1", type: "appPrices", attributes: {} }] });
  set(`/v1/apps/${APP}/inAppPurchasesV2`, { data: [] });
  set(`/v1/apps/${APP}/subscriptionGroups`, { data: [] });
  set(`/v1/apps/${APP}/endUserLicenseAgreement`, { data: null });
  set(`/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`, { data: [localization({ supportUrl: urls.support ?? null })] });
  set(`/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`, screenshotSets(["APP_IPHONE_67"]));
  set(`/v1/appStoreVersions/${VERSION}/build`, build());
  set(`/v1/builds/${BUILD}`, { data: { id: BUILD }, included: [{ type: "buildBundles", id: "bb", attributes: { bundleType: "APP", sdkBuild: "23B77" } }] });
  set(`/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`, {
    data: { attributes: { contactFirstName: "A", contactLastName: "B", contactPhone: "+1", contactEmail: "a@test.invalid", demoAccountName: null, demoAccountRequired: false } },
  });

  const get = async (path: string, params: Record<string, string> = {}) => {
    calls.push(path);
    const route = routes.get(path);
    if (!route) throw new Error(`fake Apple has no route for ${path}`);
    return route(params);
  };
  return { client: { get, getAll: get } as unknown as ASCClient, routes, set, fail, calls };
}

/** Every route the audit reads, for the test that fails each in turn. */
export const AUDIT_READS = [
  `/v1/apps/${APP}`,
  `/v1/apps/${APP}/appInfos`,
  `/v1/appPriceSchedules/${APP}/manualPrices`,
  `/v1/apps/${APP}/inAppPurchasesV2`,
  `/v1/apps/${APP}/subscriptionGroups`,
  `/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`,
  `/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`,
  `/v1/appStoreVersions/${VERSION}/build`,
  `/v1/appStoreVersions/${VERSION}/appStoreReviewDetail`,
  `/v1/appInfos/${INFO}/appInfoLocalizations`,
];
