/**
 * register_bundle_id: a brand-new app needs an explicit bundle id before its
 * app record. The tool must not write without confirm, must not duplicate an
 * existing id, and signing must create a missing App Store profile only after
 * confirm.
 */
import { describe, it, expect } from "vitest";
import { registerBundleId } from "../src/tools/bundle-id.js";
import { setupAppStoreSigning } from "../src/tools/signing.js";
import { ascGuide } from "../src/tools/guide.js";

interface Call { method: string; path: string; body?: unknown }

function fake(opts: { bundleIds?: unknown[]; certs?: unknown[]; profiles?: unknown[] }) {
  const calls: Call[] = [];
  const reply = (path: string) => {
    if (path.startsWith("/v1/bundleIds")) return { data: opts.bundleIds ?? [] };
    if (path.startsWith("/v1/certificates")) return { data: opts.certs ?? [] };
    if (path.startsWith("/v1/profiles")) return { data: opts.profiles ?? [] };
    if (path.startsWith("/v1/apps/")) return { data: { id: "1", attributes: { bundleId: "app.example.ios" } } };
    return { data: [] };
  };
  const client = {
    get: async (path: string) => (calls.push({ method: "GET", path }), reply(path)),
    getAll: async (path: string) => (calls.push({ method: "GET", path }), reply(path)),
    post: async (path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return { data: { id: "NEWID" } };
    },
  } as never;
  return { client, calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

const existing = { id: "B1", attributes: { identifier: "app.example.ios", name: "Example", platform: "IOS" } };

describe("register_bundle_id", () => {
  it("is a Pro tool", async () => {
    const f = fake({});
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", confirm: true }, "free");
    expect(out).toContain("Pro");
    expect(f.calls).toHaveLength(0);
  });

  it("without confirm previews and writes nothing", async () => {
    const f = fake({});
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example" }, "pro");
    expect(out).toContain("Nothing was changed");
    expect(out).toContain("confirm: true");
    expect(f.writes()).toHaveLength(0);
    expect(f.calls[0].path).toContain("/v1/bundleIds");
  });

  it("with confirm posts the explicit id once", async () => {
    const f = fake({});
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", confirm: true }, "pro");
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].path).toBe("/v1/bundleIds");
    expect(f.writes()[0].body).toEqual({
      data: { type: "bundleIds", attributes: { identifier: "app.example.ios", name: "Example", platform: "IOS" } },
    });
    expect(out).toContain("NEWID");
    expect(out).toContain("app record");
  });

  it("is idempotent: an existing id is returned, never posted", async () => {
    const f = fake({ bundleIds: [existing] });
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", confirm: true }, "pro");
    expect(out).toContain("already registered");
    expect(out).toContain("B1");
    expect(f.writes()).toHaveLength(0);
  });

  it("ignores prefix matches Apple's filter may return", async () => {
    const other = { id: "B2", attributes: { identifier: "app.example.ios.widget", name: "W", platform: "IOS" } };
    const f = fake({ bundleIds: [other] });
    await registerBundleId(f.client, { identifier: "app.example.ios", name: "Example", confirm: true }, "pro");
    expect(f.writes()).toHaveLength(1);
  });

  it.each(["app", "app.example.*", "app example.ios", ""])("rejects invalid identifier %j before any call", async (id) => {
    const f = fake({});
    const out = await registerBundleId(f.client, { identifier: id, name: "Example", confirm: true }, "pro");
    expect(out).toContain("not an explicit bundle id");
    expect(f.calls).toHaveLength(0);
  });

  it("rejects a name with punctuation", async () => {
    const f = fake({});
    const out = await registerBundleId(f.client, { identifier: "app.example.ios", name: "Ex-ample!", confirm: true }, "pro");
    expect(out).toContain("letters, digits and spaces");
    expect(f.calls).toHaveLength(0);
  });
});

describe("setup_app_store_signing with no profile yet", () => {
  const cert = (id: string, exp: string) => ({ id, attributes: { certificateType: "DISTRIBUTION", displayName: id, expirationDate: exp } });
  const future = "2999-01-01T00:00:00.000+0000";

  it("sends the AI to register_bundle_id when the id is not registered", async () => {
    const f = fake({});
    const out = await setupAppStoreSigning(f.client, { app_id: "1", confirm: true }, "pro");
    expect(out).toContain("register_bundle_id");
    expect(f.writes()).toHaveLength(0);
  });

  it("names the manual certificate step when the account has no usable distribution cert", async () => {
    const f = fake({ bundleIds: [existing], certs: [cert("OLD", "2000-01-01T00:00:00.000+0000")] });
    const out = await setupAppStoreSigning(f.client, { app_id: "1", confirm: true }, "pro");
    expect(out).toContain("no unexpired distribution certificate");
    expect(f.writes()).toHaveLength(0);
  });

  it("previews without confirm", async () => {
    const f = fake({ bundleIds: [existing], certs: [cert("C1", future)] });
    const out = await setupAppStoreSigning(f.client, { app_id: "1" }, "pro");
    expect(out).toContain("Nothing was changed");
    expect(out).toContain("confirm: true");
    expect(f.writes()).toHaveLength(0);
  });

  it("with confirm posts an IOS_APP_STORE profile with the bundle id and every live cert", async () => {
    const f = fake({ bundleIds: [existing], certs: [cert("C1", future), cert("OLD", "2000-01-01T00:00:00.000+0000"), cert("C2", future)] });
    await setupAppStoreSigning(f.client, { app_id: "1", confirm: true }, "pro");
    const w = f.writes();
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe("/v1/profiles");
    expect(w[0].body).toEqual({
      data: {
        type: "profiles",
        attributes: { name: "app.example.ios App Store", profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: "B1" } },
          certificates: { data: [{ type: "certificates", id: "C1" }, { type: "certificates", id: "C2" }] },
        },
      },
    });
  });
});

describe("asc_guide names the new step", () => {
  it.each(["binary", "first-app"] as const)("%s lists register_bundle_id before the app record or signing", async (topic) => {
    const out = await ascGuide({ topic });
    const i = out.indexOf("register_bundle_id");
    expect(i).toBeGreaterThan(-1);
    const later = topic === "binary" ? "setup_app_store_signing" : "app RECORD";
    expect(i).toBeLessThan(out.indexOf(later));
  });
});
