/**
 * Capabilities on a bundle id (test-app friction row 6) and the profile Apple
 * invalidates when one is turned on: register_bundle_id turns capabilities on
 * idempotently, and setup_app_store_signing never installs an INVALID profile.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerBundleId } from "../src/tools/bundle-id.js";
import { setupAppStoreSigning } from "../src/tools/signing.js";
import { ASCAPIError } from "../src/client.js";

interface Call { method: string; path: string; body?: unknown }
const existing = { id: "B1", attributes: { identifier: "app.example.ios", name: "Example", platform: "IOS" } };

function capClient(on: string[], refuse: string[] = []) {
  const calls: Call[] = [];
  const client = {
    getAll: async (path: string) => {
      calls.push({ method: "GET", path });
      if (path === "/v1/bundleIds") return { data: [existing] };
      return { data: [] };
    },
    get: async (path: string, params?: Record<string, string>) => {
      calls.push({ method: "GET", path });
      // Apple answers 400 when `limit` is sent on this relationship.
      if (params && "limit" in params) throw new ASCAPIError(400, "limit can not be used with this request", path);
      if (path.endsWith("/bundleIdCapabilities")) return { data: on.map((c, i) => ({ id: `c${i}`, attributes: { capabilityType: c } })) };
      return { data: [] };
    },
    post: async (path: string, body: { data: { attributes: { capabilityType: string } } }) => {
      calls.push({ method: "POST", path, body });
      const cap = body.data.attributes.capabilityType;
      if (refuse.includes(cap)) throw new ASCAPIError(409, `{"errors":[{"detail":"${cap} needs settings"}]}`, path);
      return { data: { id: "NEW" } };
    },
  } as never;
  return { client, posts: () => calls.filter((c) => c.method === "POST") };
}

describe("register_bundle_id capabilities", () => {
  it("previews on an existing id and writes nothing", async () => {
    const f = capClient([]);
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", capabilities: ["push_notifications"] }, "pro");
    expect(out).toContain("Confirming turns on PUSH_NOTIFICATIONS");
    expect(out).toContain("Nothing was changed");
    expect(f.posts()).toHaveLength(0);
  });

  it("turns on only what is off, and points at the invalidated profile", async () => {
    const f = capClient(["IN_APP_PURCHASE", "ICLOUD"]);
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", capabilities: ["ICLOUD", "PUSH_NOTIFICATIONS"], confirm: true }, "pro");
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0].body).toEqual({
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
        relationships: { bundleId: { data: { type: "bundleIds", id: "B1" } } },
      },
    });
    expect(out).toContain("Turned on for app.example.ios: PUSH_NOTIFICATIONS.");
    expect(out).toContain("Already on: ICLOUD.");
    expect(out).toContain("setup_app_store_signing with confirm: true");
  });

  it("names a capability Apple refuses without hiding the ones that worked", async () => {
    const f = capClient([], ["DATA_PROTECTION"]);
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", capabilities: ["DATA_PROTECTION", "GAME_CENTER"], confirm: true }, "pro");
    expect(out).toContain("Turned on for app.example.ios: GAME_CENTER.");
    expect(out).toContain("Apple refused: DATA_PROTECTION");
    expect(out).toContain("Developer portal");
  });

  it("rejects an unknown capability name before calling Apple", async () => {
    const f = capClient([]);
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", capabilities: ["PUSH"], confirm: true }, "pro");
    expect(out).toContain("Unknown capability type: PUSH");
    expect(out).toContain("PUSH_NOTIFICATIONS");
    expect(f.posts()).toHaveLength(0);
  });

  it("says App Groups still needs the group made in the portal", async () => {
    const f = capClient([]);
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", capabilities: ["APP_GROUPS"], confirm: true }, "pro");
    expect(out).toContain("the group itself is created in the Developer portal");
  });
});

describe("setup_app_store_signing with an invalidated profile", () => {
  const plist = (team: string, bundle: string) =>
    Buffer.from(
      `junk<plist version="1.0"><dict><key>Name</key><string>P</string><key>TeamIdentifier</key><array><string>${team}</string></array>` +
        `<key>application-identifier</key><string>${team}.${bundle}</string></dict></plist>junk`,
    ).toString("base64");
  const cert = { id: "C1", attributes: { certificateType: "DISTRIBUTION", displayName: "C1", expirationDate: "2999-01-01T00:00:00.000+0000" } };
  let home: string;
  let oldHome: string | undefined;
  beforeAll(() => {
    oldHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "asc-sign-"));
    process.env.HOME = home;
  });
  afterAll(() => {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  });

  function signClient() {
    const calls: Call[] = [];
    let profiles = [{ id: "OLDP", attributes: { name: "old", uuid: "u-old", profileType: "IOS_APP_STORE", profileState: "INVALID", profileContent: plist("TEAM1", "app.example.ios") } }];
    const client = {
      get: async () => ({ data: { id: "1", attributes: { bundleId: "app.example.ios" } } }),
      getAll: async (path: string) => {
        calls.push({ method: "GET", path });
        if (path === "/v1/profiles") return { data: profiles };
        if (path === "/v1/bundleIds") return { data: [existing] };
        if (path === "/v1/certificates") return { data: [cert] };
        return { data: [] };
      },
      post: async (path: string, body: unknown) => {
        calls.push({ method: "POST", path, body });
        profiles = [{ id: "NEWP", attributes: { name: "app.example.ios App Store", uuid: "u-new", profileType: "IOS_APP_STORE", profileState: "ACTIVE", profileContent: plist("TEAM1", "app.example.ios") } }];
        return { data: { id: "NEWP" } };
      },
      del: async (path: string) => {
        calls.push({ method: "DELETE", path });
        return { data: null };
      },
    } as never;
    return { client, writes: () => calls.filter((c) => c.method !== "GET") };
  }

  it("never installs it, and previews the replacement without confirm", async () => {
    const f = signClient();
    const out = await setupAppStoreSigning(f.client, { app_id: "1", output_plist: join(home, "E.plist") }, "pro");
    expect(out).toContain("no longer valid");
    expect(out).toContain("Nothing was changed");
    expect(f.writes()).toHaveLength(0);
  });

  it("with confirm deletes it, creates a fresh one and installs only that", async () => {
    const f = signClient();
    await setupAppStoreSigning(f.client, { app_id: "1", confirm: true, output_plist: join(home, "E.plist") }, "pro");
    expect(f.writes().map((w) => `${w.method} ${w.path}`)).toEqual(["DELETE /v1/profiles/OLDP", "POST /v1/profiles"]);
    const installed = readdirSync(join(home, "Library", "MobileDevice", "Provisioning Profiles"));
    expect(installed).toEqual(["u-new.mobileprovision"]);
  });
});
