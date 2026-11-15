/**
 * create_beta_group, set_beta_test_info, the internal-group guard in
 * invite_beta_tester and the guide's TestFlight flow. Fake client, no network.
 */
import { describe, it, expect } from "vitest";
import { ASCAPIError } from "../src/client.js";
import { createBetaGroup, setBetaTestInfo, INTERNAL_TESTER_MANUAL } from "../src/tools/testflight-setup.js";
import { inviteBetaTester, listBetaGroups } from "../src/tools/testflight.js";
import { ascGuide } from "../src/tools/guide.js";

interface Call { method: string; path: string; body?: unknown }
type Routes = Record<string, unknown>;

/** Longest matching route prefix wins; a value of "404" throws Apple's 404. */
function fake(routes: Routes) {
  const calls: Call[] = [];
  const reply = (path: string) => {
    const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!key || routes[key] === "404") throw new ASCAPIError(404, path, "{}");
    return { data: routes[key] };
  };
  const client = {
    get: async (path: string) => (calls.push({ method: "GET", path }), reply(path)),
    getAll: async (path: string) => (calls.push({ method: "GET", path }), reply(path)),
    post: async (path: string, body: unknown) => (calls.push({ method: "POST", path, body }), { data: { id: "NEW1" } }),
    patch: async (path: string, body: unknown) => (calls.push({ method: "PATCH", path, body }), null),
  } as never;
  return { client, calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

const grp = (id: string, name: string, internal: boolean) => ({ id, attributes: { name, isInternalGroup: internal } });

describe("create_beta_group", () => {
  const base = { app_id: "123", name: "Internal", internal: true };

  it("is Pro", async () => {
    const f = fake({});
    expect(await createBetaGroup(f.client, { ...base, confirm: true }, "free")).toContain("Pro");
    expect(f.calls).toHaveLength(0);
  });

  it("previews without confirm and writes nothing", async () => {
    const f = fake({ "/v1/betaGroups": [] });
    const out = await createBetaGroup(f.client, base, "pro");
    expect(out).toContain("Nothing was changed");
    expect(out).toContain("confirm: true");
    expect(f.writes()).toHaveLength(0);
  });

  it("posts an internal group with the app relationship", async () => {
    const f = fake({ "/v1/betaGroups": [] });
    const out = await createBetaGroup(f.client, { ...base, has_access_to_all_builds: true, confirm: true }, "pro");
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].path).toBe("/v1/betaGroups");
    expect(f.writes()[0].body).toEqual({
      data: {
        type: "betaGroups",
        attributes: { name: "Internal", isInternalGroup: true, hasAccessToAllBuilds: true },
        relationships: { app: { data: { type: "apps", id: "123" } } },
      },
    });
    expect(out).toContain("NEW1");
    expect(out).toContain("invite_beta_tester");
  });

  it("creates an external group and points at invite_beta_tester", async () => {
    const f = fake({ "/v1/betaGroups": [] });
    const out = await createBetaGroup(f.client, { ...base, name: "Friends", internal: false, confirm: true }, "pro");
    expect((f.writes()[0].body as { data: { attributes: Record<string, unknown> } }).data.attributes).toEqual({ name: "Friends", isInternalGroup: false });
    expect(out).toContain("invite_beta_tester");
  });

  it("is idempotent by name: returns the existing group, never posts", async () => {
    const f = fake({ "/v1/betaGroups": [grp("G1", "Internal", true)] });
    const out = await createBetaGroup(f.client, { ...base, confirm: true }, "pro");
    expect(out).toContain("already exists");
    expect(out).toContain("G1");
    expect(f.writes()).toHaveLength(0);
  });

  it("says so when the existing group is the other kind", async () => {
    const f = fake({ "/v1/betaGroups": [grp("G1", "Internal", false)] });
    const out = await createBetaGroup(f.client, { ...base, confirm: true }, "pro");
    expect(out).toContain("external, not internal");
    expect(f.writes()).toHaveLength(0);
  });

  it("rejects an empty name before any call", async () => {
    const f = fake({});
    expect(await createBetaGroup(f.client, { ...base, name: "  " }, "pro")).toContain("needs a name");
    expect(f.calls).toHaveLength(0);
  });
});

describe("invite_beta_tester on an internal group", () => {
  const users = [{ id: "U1", attributes: { username: "Owner@Example.com", firstName: "Ann", lastName: "Owner", roles: ["ADMIN"] } }];

  it("adds an account user with their own name after confirm", async () => {
    const f = fake({ "/v1/betaGroups/G1": grp("G1", "Internal", true), "/v1/users": users });
    const out = await inviteBetaTester(f.client, { group_id: "G1", email: "owner@example.com", confirm: true }, "pro");
    expect(out).toContain("Added Ann Owner");
    const w = f.writes();
    expect(w).toHaveLength(1);
    expect(w[0].path).toBe("/v1/betaTesters");
    expect(JSON.stringify(w[0].body)).toContain('"id":"G1"');
    expect(JSON.stringify(w[0].body)).toContain("Owner@Example.com");
  });

  it("previews without confirm and never posts", async () => {
    const f = fake({ "/v1/betaGroups/G1": grp("G1", "Internal", true), "/v1/users": users });
    const out = await inviteBetaTester(f.client, { group_id: "G1", email: "owner@example.com" }, "pro");
    expect(out).toContain("confirm: true");
    expect(f.writes()).toHaveLength(0);
  });

  it("refuses an email that is not an account user", async () => {
    const f = fake({ "/v1/betaGroups/G1": grp("G1", "Internal", true), "/v1/users": users });
    const out = await inviteBetaTester(f.client, { group_id: "G1", email: "stranger@example.com", confirm: true }, "pro");
    expect(out).toContain("not a user on this App Store Connect account");
    expect(out).toContain("Ann Owner");
    expect(f.writes()).toHaveLength(0);
  });

  it("falls back to the website when the key cannot read users", async () => {
    const f = fake({ "/v1/betaGroups/G1": grp("G1", "Internal", true) });
    const client = f.client as unknown as { getAll: unknown };
    client.getAll = async () => { throw new ASCAPIError(403, "/v1/users", "{}"); };
    const out = await inviteBetaTester(f.client, { group_id: "G1", email: "owner@example.com", confirm: true }, "pro");
    expect(out).toContain(INTERNAL_TESTER_MANUAL);
    expect(f.writes()).toHaveLength(0);
  });

  it("still invites to an external group", async () => {
    const f = fake({ "/v1/betaGroups/G2": grp("G2", "Friends", false) });
    const out = await inviteBetaTester(f.client, { group_id: "G2", email: "a@b.co", confirm: true }, "pro");
    expect(out).toContain("Invited");
    expect(f.writes()[0].path).toBe("/v1/betaTesters");
  });
});

describe("list_beta_groups with none", () => {
  it("names create_beta_group, not the website", async () => {
    const f = fake({ "/v1/betaGroups": [] });
    const out = await listBetaGroups(f.client, { app_id: "123" }, "pro");
    expect(out).toContain("create_beta_group");
    expect(out).not.toContain("the human adds a group");
  });
});

describe("set_beta_test_info", () => {
  const app = { id: "123", attributes: { primaryLocale: "en-US" } };
  const routes = (extra: Routes = {}): Routes => ({
    "/v1/apps/123/betaAppLocalizations": [],
    "/v1/apps/123/betaAppReviewDetail": { id: "RD1", attributes: {} },
    "/v1/apps/123": app,
    "/v1/builds/B1/betaBuildLocalizations": [],
    "/v1/builds/B1": { id: "B1", attributes: { version: "1" } },
    ...extra,
  });
  const info = { app_id: "123", feedback_email: "fb@example.com", description: "A test app", marketing_url: "https://example.com", privacy_policy_url: "https://example.com/privacy" };

  it("is Pro", async () => {
    const f = fake(routes());
    expect(await setBetaTestInfo(f.client, { ...info, confirm: true }, "free")).toContain("Pro");
    expect(f.calls).toHaveLength(0);
  });

  it("previews without confirm and writes nothing", async () => {
    const f = fake(routes());
    const out = await setBetaTestInfo(f.client, info, "pro");
    expect(out).toContain("Nothing was changed");
    expect(out).toContain("en-US, create");
    expect(f.writes()).toHaveLength(0);
  });

  it("creates the localization in the app's primary locale", async () => {
    const f = fake(routes());
    await setBetaTestInfo(f.client, { ...info, confirm: true }, "pro");
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].path).toBe("/v1/betaAppLocalizations");
    expect(f.writes()[0].body).toEqual({
      data: {
        type: "betaAppLocalizations",
        attributes: { locale: "en-US", feedbackEmail: "fb@example.com", description: "A test app", marketingUrl: "https://example.com", privacyPolicyUrl: "https://example.com/privacy" },
        relationships: { app: { data: { type: "apps", id: "123" } } },
      },
    });
  });

  it("updates an existing localization with only the fields given", async () => {
    const f = fake(routes({ "/v1/apps/123/betaAppLocalizations": [{ id: "L1", attributes: { locale: "en-US" } }] }));
    await setBetaTestInfo(f.client, { app_id: "123", description: "New", confirm: true }, "pro");
    expect(f.writes()).toEqual([
      { method: "PATCH", path: "/v1/betaAppLocalizations/L1", body: { data: { type: "betaAppLocalizations", id: "L1", attributes: { description: "New" } } } },
    ]);
  });

  it("an explicit locale skips reading the app", async () => {
    const f = fake(routes());
    await setBetaTestInfo(f.client, { ...info, locale: "fr-FR", confirm: true }, "pro");
    expect(f.calls.some((c) => c.path === "/v1/apps/123")).toBe(false);
    expect((f.writes()[0].body as { data: { attributes: { locale: string } } }).data.attributes.locale).toBe("fr-FR");
  });

  it("sets What to Test on a build", async () => {
    const f = fake(routes());
    await setBetaTestInfo(f.client, { app_id: "123", whats_new: "Try onboarding", build_id: "B1", confirm: true }, "pro");
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].path).toBe("/v1/betaBuildLocalizations");
    expect(f.writes()[0].body).toEqual({
      data: {
        type: "betaBuildLocalizations",
        attributes: { locale: "en-US", whatsNew: "Try onboarding" },
        relationships: { build: { data: { type: "builds", id: "B1" } } },
      },
    });
  });

  it("updates an existing build localization", async () => {
    const f = fake(routes({ "/v1/builds/B1/betaBuildLocalizations": [{ id: "BL1", attributes: { locale: "en-US" } }] }));
    await setBetaTestInfo(f.client, { app_id: "123", whats_new: "x", build_id: "B1", confirm: true }, "pro");
    expect(f.writes()[0].method).toBe("PATCH");
    expect(f.writes()[0].path).toBe("/v1/betaBuildLocalizations/BL1");
  });

  it("an unknown build is an error, nothing written", async () => {
    const f = fake(routes({ "/v1/builds/B9": "404" }));
    const out = await setBetaTestInfo(f.client, { app_id: "123", whats_new: "x", build_id: "B9", confirm: true }, "pro");
    expect(out).toContain("no build with id B9");
    expect(f.writes()).toHaveLength(0);
  });

  it("patches the Beta App Review contact", async () => {
    const f = fake(routes());
    await setBetaTestInfo(
      f.client,
      { app_id: "123", review_contact_first_name: "A", review_contact_last_name: "B", review_contact_email: "a@b.co", review_contact_phone: "+10000000000", confirm: true },
      "pro",
    );
    expect(f.writes()).toEqual([
      {
        method: "PATCH",
        path: "/v1/betaAppReviewDetails/RD1",
        body: { data: { type: "betaAppReviewDetails", id: "RD1", attributes: { contactFirstName: "A", contactLastName: "B", contactEmail: "a@b.co", contactPhone: "+10000000000" } } },
      },
    ]);
  });

  it.each([
    [{ feedback_email: "nope" }, "feedback_email"],
    [{ marketing_url: "example.com" }, "marketing_url"],
    [{ privacy_policy_url: "ftp://x.y" }, "privacy_policy_url"],
    [{ review_contact_email: "x" }, "review_contact_email"],
    [{ whats_new: "x" }, "build_id"],
    [{ build_id: "B1" }, "whats_new"],
    [{ description: "  " }, "description is empty"],
  ])("rejects %j before any call", async (bad, needle) => {
    const f = fake(routes());
    const out = await setBetaTestInfo(f.client, { app_id: "123", ...bad, confirm: true }, "pro");
    expect(out).toContain("Nothing was changed");
    expect(out).toContain(needle);
    expect(f.calls).toHaveLength(0);
  });

  it("nothing to set says what to pass and invents nothing", async () => {
    const f = fake(routes());
    const out = await setBetaTestInfo(f.client, { app_id: "123", confirm: true }, "pro");
    expect(out).toContain("Nothing to set");
    expect(f.calls).toHaveLength(0);
  });

  it("an unreadable primary locale stops rather than guessing", async () => {
    const f = fake(routes({ "/v1/apps/123": { id: "123", attributes: {} } }));
    const out = await setBetaTestInfo(f.client, { ...info, confirm: true }, "pro");
    expect(out).toContain("primary locale could not be read");
    expect(f.writes()).toHaveLength(0);
  });
});

describe("asc_guide testflight", () => {
  it("names the steps in order and how internal testers are added", async () => {
    const out = await ascGuide({ topic: "testflight" });
    const order = ["create_beta_group", "invite_beta_tester", "set_beta_test_info", "assign_build_to_group"].map((t) => out.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("App Store Connect user on the account");
  });

  it("limitations no longer list internal testers as manual", async () => {
    expect(await ascGuide({ topic: "limitations" })).not.toContain("internal TestFlight group");
  });
});
