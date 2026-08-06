import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TRIAL_DAYS,
  isValidToolName,
  isValidFingerprint,
  isValidEmail,
  trialExpiry,
  daysRemaining,
  buildCheckoutUrl,
  isLicenseUsable,
  pickLookupRow,
  GRACE_DAYS,
  signDeleteToken,
  verifyDeleteToken,
  DELETE_TOKEN_TTL_MS,
  timingSafeEqual,
} from "../license-worker/src/logic.js";
import { fingerprintIssuer, requestTrial, TRIAL_FINGERPRINT_SALT } from "../src/trial.js";
import { requirePro, upgradeUrl, CHECKOUT_URL } from "../src/gate.js";
import { validateLicense, clearLicenseCache } from "../src/license.js";
import { injectLicenseKey, writeServerBlock } from "../src/setup.js";

describe("input validation on /trial and /go", () => {
  it("accepts real tool names and rejects anything that could be injected", () => {
    expect(isValidToolName("submit_for_review")).toBe(true);
    expect(isValidToolName("release_preflight")).toBe(true);
    // The tool name is echoed into a URL and a database row.
    expect(isValidToolName("submit for review")).toBe(false);
    expect(isValidToolName("../../etc/passwd")).toBe(false);
    expect(isValidToolName("a'; DROP TABLE licenses;--")).toBe(false);
    expect(isValidToolName("https://evil.example.com")).toBe(false);
    expect(isValidToolName("Submit_For_Review")).toBe(false);
    expect(isValidToolName("x".repeat(65))).toBe(false);
    expect(isValidToolName("")).toBe(false);
    expect(isValidToolName(undefined)).toBe(false);
  });

  it("requires a 64-char hex fingerprint", () => {
    expect(isValidFingerprint("a".repeat(64))).toBe(true);
    expect(isValidFingerprint("A".repeat(64))).toBe(false); // uppercase is not what we emit
    expect(isValidFingerprint("a".repeat(63))).toBe(false);
    expect(isValidFingerprint("a".repeat(65))).toBe(false);
    expect(isValidFingerprint("g".repeat(64))).toBe(false); // not hex
    expect(isValidFingerprint(null)).toBe(false);
  });

  it("accepts ordinary and unusual addresses, rejects nonsense", () => {
    expect(isValidEmail("dev@example.com")).toBe(true);
    expect(isValidEmail("first.last+asc@sub.domain.co.uk")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("no@tld")).toBe(false);
    expect(isValidEmail("two @spaces.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@b.com`)).toBe(false);
  });
});

describe("trial expiry arithmetic", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("expires exactly TRIAL_DAYS out", () => {
    expect(trialExpiry(now)).toBe("2026-08-13T12:00:00.000Z");
    expect(TRIAL_DAYS).toBe(7);
  });

  it("reports whole days remaining and never goes negative", () => {
    expect(daysRemaining("2026-08-13T12:00:00.000Z", now)).toBe(7);
    expect(daysRemaining("2026-08-07T00:00:00.000Z", now)).toBe(1);
    expect(daysRemaining("2026-08-01T00:00:00.000Z", now)).toBe(0);
    expect(daysRemaining(null, now)).toBe(0);
    expect(daysRemaining("not a date", now)).toBe(0);
  });
});

/**
 * The single most expensive detail to get wrong in either direction: grace must
 * cover a paying customer whose renewal webhook is late, and must not quietly
 * turn a 7-day trial into an 11-day one.
 */
describe("renewal grace applies to subscriptions, never to trials", () => {
  const expired = "2026-08-01T00:00:00.000Z";
  const twoDaysLater = new Date("2026-08-03T00:00:00.000Z");
  const sixDaysLater = new Date("2026-08-07T00:00:00.000Z");

  it("keeps a paid licence alive inside the grace window", () => {
    const v = isLicenseUsable({ expires_at: expired, active: 1, source: "polar" }, twoDaysLater);
    expect(v.usable).toBe(true);
    expect(v.grace).toBe(true);
  });

  it("keeps a pre-migration row (no source) on the paid behaviour", () => {
    expect(isLicenseUsable({ expires_at: expired, active: 1 }, twoDaysLater).usable).toBe(true);
    expect(isLicenseUsable({ expires_at: expired, active: 1, source: null }, twoDaysLater).usable).toBe(true);
  });

  it("cuts a trial off the moment it expires, with no grace", () => {
    const v = isLicenseUsable({ expires_at: expired, active: 1, source: "trial" }, twoDaysLater);
    expect(v.usable).toBe(false);
    expect(v.reason).toBe("trial_expired");
    expect(v.grace).toBeUndefined();
  });

  it("still ends a paid licence once grace runs out", () => {
    expect(isLicenseUsable({ expires_at: expired, active: 1, source: "polar" }, sixDaysLater).usable).toBe(false);
    expect(GRACE_DAYS).toBe(4);
  });

  it("a live trial is usable", () => {
    expect(
      isLicenseUsable({ expires_at: "2026-08-10T00:00:00.000Z", active: 1, source: "trial" }, twoDaysLater).usable,
    ).toBe(true);
  });

  it("gives no grace to a subscription the customer already cancelled", () => {
    const v = isLicenseUsable(
      { expires_at: expired, active: 1, source: "polar", canceled_at: "2026-07-20T00:00:00.000Z" },
      twoDaysLater,
    );
    expect(v.usable).toBe(false);
    expect(v.reason).toBe("canceled");
    expect(v.grace).toBeUndefined();
  });

  it("still honours the paid period of a cancelled subscription", () => {
    expect(
      isLicenseUsable(
        {
          expires_at: "2026-08-10T00:00:00.000Z",
          active: 1,
          source: "polar",
          canceled_at: "2026-07-20T00:00:00.000Z",
        },
        twoDaysLater,
      ).usable,
    ).toBe(true);
  });
});

describe("checkout URL construction", () => {
  it("carries attribution and never redirects off our checkout host", () => {
    const url = new URL(buildCheckoutUrl("submit_for_review", "dev@example.com"));
    expect(url.origin).toBe("https://buy.polar.sh");
    expect(url.searchParams.get("utm_source")).toBe("agent");
    expect(url.searchParams.get("utm_medium")).toBe("mcp");
    expect(url.searchParams.get("utm_content")).toBe("submit_for_review");
    expect(url.searchParams.get("customer_email")).toBe("dev@example.com");
  });

  it("drops invalid input rather than reflecting it", () => {
    const url = new URL(buildCheckoutUrl("../../evil", "not-an-email"));
    expect(url.origin).toBe("https://buy.polar.sh");
    expect(url.searchParams.get("utm_content")).toBeNull();
    expect(url.searchParams.get("customer_email")).toBeNull();
  });
});

describe("which key /key hands back", () => {
  const now = new Date("2026-08-06T00:00:00.000Z");
  const live = "2026-08-20T00:00:00.000Z";
  const dead = "2026-08-01T00:00:00.000Z";

  it("prefers the subscription over a trial the same person also holds", () => {
    const picked = pickLookupRow(
      [
        { key: "ASC-TRIAL", tier: "pro", active: 1, expires_at: live, source: "trial" },
        { key: "ASC-PAID", tier: "pro", active: 1, expires_at: live, source: "polar" },
      ],
      now,
    );
    expect(picked?.key).toBe("ASC-PAID");
  });

  it("never hands back a dead trial key", () => {
    expect(
      pickLookupRow([{ key: "ASC-TRIAL", tier: "pro", active: 1, expires_at: dead, source: "trial" }], now),
    ).toBeNull();
  });

  it("still hands back a paid key inside the renewal grace window", () => {
    const picked = pickLookupRow(
      [{ key: "ASC-PAID", tier: "pro", active: 1, expires_at: "2026-08-04T00:00:00.000Z", source: "polar" }],
      now,
    );
    expect(picked?.key).toBe("ASC-PAID");
  });
});

describe("issuer fingerprint", () => {
  const issuer = "69a6de70-1234-47e3-e053-5b8c7c11a4d1";

  it("is a stable 64-char digest", () => {
    const fp = fingerprintIssuer(issuer);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintIssuer(issuer)).toBe(fp);
  });

  it("is the same for the same account typed differently", () => {
    expect(fingerprintIssuer(` ${issuer.toUpperCase()} `)).toBe(fingerprintIssuer(issuer));
  });

  it("differs per Apple account", () => {
    expect(fingerprintIssuer("69a6de70-0000-47e3-e053-5b8c7c11a4d1")).not.toBe(fingerprintIssuer(issuer));
  });

  /** The Issuer ID itself must never be recoverable from, or present in, what we send. */
  it("does not contain the issuer id", () => {
    expect(fingerprintIssuer(issuer)).not.toContain(issuer);
    expect(fingerprintIssuer(issuer)).not.toContain(issuer.slice(0, 8));
    expect(TRIAL_FINGERPRINT_SALT).toContain("v1");
  });
});

describe("requestTrial sends a digest, never the issuer id", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("posts only fingerprint, email and tool", async () => {
    let seen: any = null;
    globalThis.fetch = (async (_url: string, init: any) => {
      seen = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ key: "ASC-AAAAA-BBBBB-CCCCC-DDDDD", expires: "2026-08-13T00:00:00Z", days_remaining: 7 }),
        { status: 200 },
      );
    }) as never;

    const issuer = "69a6de70-1234-47e3-e053-5b8c7c11a4d1";
    const r = await requestTrial({ issuerId: issuer, email: "dev@example.com", tool: "submit_for_review" });

    expect(Object.keys(seen).sort()).toEqual(["email", "fingerprint", "tool"]);
    expect(seen.fingerprint).toBe(fingerprintIssuer(issuer));
    expect(JSON.stringify(seen)).not.toContain(issuer);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.key).toBe("ASC-AAAAA-BBBBB-CCCCC-DDDDD");
  });

  it("turns a refusal into something the agent can say out loud", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "trial_used", message: "Your trial has ended.", checkout_url: "https://buy.polar.sh/x" }), {
        status: 409,
      })) as never;

    const r = await requestTrial({ issuerId: "i", email: "dev@example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("trial_used");
      expect(r.message).toBe("Your trial has ended.");
      expect(r.checkout_url).toBe("https://buy.polar.sh/x");
    }
  });

  it("never throws when the licence server is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as never;

    const r = await requestTrial({ issuerId: "i", email: "dev@example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("nothing was created");
  });

  it("survives a non-JSON response", async () => {
    globalThis.fetch = (async () => new Response("<html>502</html>", { status: 502 })) as never;
    const r = await requestTrial({ issuerId: "i", email: "dev@example.com" });
    expect(r.ok).toBe(false);
  });
});

describe("the gate message", () => {
  it("leads with the trial, then the attributed buy link", () => {
    const msg = requirePro("free", "Submitting for review", "submit_for_review")!;
    expect(msg).toContain("Submitting for review requires Pro");
    expect(msg.indexOf("asc_start_trial")).toBeLessThan(msg.indexOf("$9/month"));
    expect(msg).toContain("/go?tool=submit_for_review");
    // The direct link survives a licence-server outage.
    expect(msg).toContain(CHECKOUT_URL);
  });

  it("says nothing to a Pro user", () => {
    expect(requirePro("pro", "Anything", "list_builds")).toBeNull();
  });

  it("refuses to reflect a bogus tool name into the URL", () => {
    expect(upgradeUrl("../evil")).not.toContain("evil");
    expect(upgradeUrl()).toMatch(/\/go$/);
  });
});

describe("injectLicenseKey", () => {
  const dir = mkdtempSync(join(tmpdir(), "asc-cfg-"));

  function cfg(name: string, body: unknown): { label: string; path: string } {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(body, null, 2));
    return { label: name, path };
  }

  it("adds the key without disturbing other servers or other env vars", () => {
    const c = cfg("claude.json", {
      mcpServers: {
        other: { command: "node", args: ["other.js"] },
        "appstore-connect": {
          command: "npx",
          args: ["-y", "@pofky/asc-mcp"],
          env: { ASC_ISSUER_ID: "abc", ASC_KEY_ID: "K123" },
        },
      },
    });

    const { updated } = injectLicenseKey("ASC-NEW-KEY", [c]);
    expect(updated).toEqual([c.path]);

    const after = JSON.parse(readFileSync(c.path, "utf-8"));
    expect(after.mcpServers["appstore-connect"].env).toEqual({
      ASC_ISSUER_ID: "abc",
      ASC_KEY_ID: "K123",
      ASC_LICENSE_KEY: "ASC-NEW-KEY",
    });
    expect(after.mcpServers.other).toEqual({ command: "node", args: ["other.js"] });
    expect(existsSync(`${c.path}.bak`)).toBe(true);
  });

  it("finds the block under any server name", () => {
    const c = cfg("renamed.json", {
      mcpServers: { "my-apple-tools": { command: "npx", args: ["-y", "@pofky/asc-mcp"] } },
    });
    expect(injectLicenseKey("ASC-K", [c]).updated).toEqual([c.path]);
    expect(JSON.parse(readFileSync(c.path, "utf-8")).mcpServers["my-apple-tools"].env.ASC_LICENSE_KEY).toBe("ASC-K");
  });

  it("leaves a config with no asc-mcp block completely alone", () => {
    const c = cfg("unrelated.json", { mcpServers: { other: { command: "node", args: ["x.js"] } } });
    const before = readFileSync(c.path, "utf-8");
    expect(injectLicenseKey("ASC-K", [c]).updated).toEqual([]);
    expect(readFileSync(c.path, "utf-8")).toBe(before);
  });

  it("reports, rather than destroys, a config it cannot parse", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ not json");
    const { updated, skipped } = injectLicenseKey("ASC-K", [{ label: "broken", path }]);
    expect(updated).toEqual([]);
    expect(skipped[0]).toContain("not valid JSON");
    expect(readFileSync(path, "utf-8")).toBe("{ not json");
  });

  it("ignores a path that does not exist", () => {
    expect(injectLicenseKey("ASC-K", [{ label: "nope", path: join(dir, "absent.json") }])).toEqual({
      updated: [],
      skipped: [],
    });
  });
});

describe("the deletion confirmation link", () => {
  const SECRET = "test-delete-secret";
  const EMAIL = "customer@example.com";

  it("round-trips a token it just signed", async () => {
    const t = await signDeleteToken(SECRET, EMAIL, Date.now() + DELETE_TOKEN_TTL_MS);
    expect(await verifyDeleteToken(SECRET, EMAIL, t, Date.now())).toBe(true);
  });

  /**
   * The whole point: /delete used to remove a paying customer's licence on a
   * bare form post, so anyone who knew their address could revoke their access.
   */
  it("cannot be forged without the secret", async () => {
    const t = await signDeleteToken("attacker-guess", EMAIL, Date.now() + DELETE_TOKEN_TTL_MS);
    expect(await verifyDeleteToken(SECRET, EMAIL, t, Date.now())).toBe(false);
  });

  it("is bound to one address, so it cannot be replayed against another customer", async () => {
    const t = await signDeleteToken(SECRET, EMAIL, Date.now() + DELETE_TOKEN_TTL_MS);
    expect(await verifyDeleteToken(SECRET, "someone.else@example.com", t, Date.now())).toBe(false);
  });

  it("expires", async () => {
    const t = await signDeleteToken(SECRET, EMAIL, Date.now() - 1000);
    expect(await verifyDeleteToken(SECRET, EMAIL, t, Date.now())).toBe(false);
  });

  it("rejects junk instead of throwing", async () => {
    for (const junk of ["", ".", "abc", "999999999999.nothex", `${Date.now() + 1000}.`]) {
      expect(await verifyDeleteToken(SECRET, EMAIL, junk, Date.now())).toBe(false);
    }
  });

  it("does not accept a token whose expiry was edited to extend it", async () => {
    const realExpiry = Date.now() - 1000;
    const t = await signDeleteToken(SECRET, EMAIL, realExpiry);
    const tampered = `${Date.now() + 60_000}.${t.split(".")[1]}`;
    expect(await verifyDeleteToken(SECRET, EMAIL, tampered, Date.now())).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("matches equal strings and rejects everything else", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("the gate adapts to a trial that has already been spent", () => {
  afterEach(() => clearLicenseCache());

  it("offers the trial to someone who has never had one", () => {
    clearLicenseCache();
    const msg = requirePro("free", "Submitting for review", "submit_for_review")!;
    expect(msg).toContain("Free for 7 days");
    expect(msg).not.toContain("has ended");
  });

  /**
   * Telling someone whose trial just expired to start a trial sends them into a
   * refusal and makes the product look broken at the exact moment they were
   * deciding whether to pay.
   */
  it("does not offer a second trial once the first has expired", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ valid: false, tier: "free", reason: "trial_expired" }), {
        status: 200,
      })) as never;
    await validateLicense("ASC-EXPIRED-TRIAL-KEY");
    globalThis.fetch = realFetch;

    const msg = requirePro("free", "Submitting for review", "submit_for_review")!;
    expect(msg).toContain("Your 7-day trial has ended");
    expect(msg).not.toContain("Free for 7 days");
    // and it still tells a converted customer how to recover their paid key
    expect(msg).toContain("already subscribed");
  });
});

describe("injectLicenseKey only touches blocks that really are this server", () => {
  const dir2 = mkdtempSync(join(tmpdir(), "asc-cfg2-"));
  function cfg2(name: string, body: unknown) {
    const path = join(dir2, name);
    writeFileSync(path, JSON.stringify(body, null, 2));
    return { label: name, path };
  }

  /**
   * A substring test on the command wrote the paid licence key into any server
   * whose binary path merely contained "asc-mcp": a wrapper, a proxy, a local
   * checkout. That hands a paid key to a process with no claim to it.
   */
  it("does not write the key into an unrelated server with a similar binary name", () => {
    const c = cfg2("wrapper.json", {
      mcpServers: {
        "my-wrapper": { command: "/usr/local/bin/asc-mcp-proxy", args: ["--serve"] },
        "appstore-connect": { command: "npx", args: ["-y", "@pofky/asc-mcp"], env: {} },
      },
    });
    injectLicenseKey("ASC-SECRET-KEY", [c]);
    const after = JSON.parse(readFileSync(c.path, "utf-8"));
    expect(after.mcpServers["my-wrapper"].env).toBeUndefined();
    expect(after.mcpServers["appstore-connect"].env.ASC_LICENSE_KEY).toBe("ASC-SECRET-KEY");
  });

  it("still finds a genuine global install by its binary name", () => {
    const c = cfg2("global.json", {
      mcpServers: { "appstore-connect": { command: "/opt/homebrew/bin/asc-mcp", env: {} } },
    });
    injectLicenseKey("ASC-K", [c]);
    expect(JSON.parse(readFileSync(c.path, "utf-8")).mcpServers["appstore-connect"].env.ASC_LICENSE_KEY).toBe("ASC-K");
  });
});

describe("client config candidates per platform", () => {
  /**
   * `init --write` offered only the macOS Claude Desktop path, so a Windows
   * user was never shown their real config and had no way to understand why.
   */
  it("points at the right Claude Desktop config on each platform", async () => {
    const { clientConfigCandidatesForTest } = await import("../src/setup.js");
    const win = clientConfigCandidatesForTest("win32", "C:\\Users\\dev", "C:\\Users\\dev\\AppData\\Roaming");
    expect(win[0].path).toContain("AppData");
    expect(win[0].path).toContain("Claude");

    const mac = clientConfigCandidatesForTest("darwin", "/Users/dev");
    expect(mac[0].path).toBe("/Users/dev/Library/Application Support/Claude/claude_desktop_config.json");

    const linux = clientConfigCandidatesForTest("linux", "/home/dev");
    expect(linux[0].path).toBe("/home/dev/.config/Claude/claude_desktop_config.json");

    for (const list of [win, mac, linux]) {
      expect(list.some((c) => c.label.includes("Claude Code"))).toBe(true);
      expect(list).toHaveLength(3);
    }
  });
});

describe("init --write never costs a paying customer their key", () => {
  const dir3 = mkdtempSync(join(tmpdir(), "asc-cfg3-"));

  /**
   * writeServerBlock replaced the whole env block. A subscriber who re-ran
   * `init --write` to correct their Issuer ID, and pressed Enter at the
   * optional licence prompt, silently lost ASC_LICENSE_KEY and dropped to the
   * free tier with nothing telling them why.
   */
  it("keeps env vars this run did not ask about", () => {
    const path = join(dir3, "claude.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          other: { command: "node", args: ["x.js"] },
          "appstore-connect": {
            command: "npx",
            args: ["-y", "@pofky/asc-mcp"],
            env: { ASC_ISSUER_ID: "old", ASC_LICENSE_KEY: "ASC-PAID-KEY", CUSTOM_VAR: "v" },
          },
        },
      }),
    );

    const status = writeServerBlock(path, { ASC_ISSUER_ID: "new", ASC_KEY_ID: "K1" });
    const after = JSON.parse(readFileSync(path, "utf-8")).mcpServers;

    expect(after["appstore-connect"].env.ASC_LICENSE_KEY).toBe("ASC-PAID-KEY");
    expect(after["appstore-connect"].env.CUSTOM_VAR).toBe("v");
    expect(after["appstore-connect"].env.ASC_ISSUER_ID).toBe("new");
    expect(after.other).toEqual({ command: "node", args: ["x.js"] });
    expect(status).toContain("Kept your existing");
  });

  /** A second write must not replace the pristine backup with a modified copy. */
  it("keeps the first backup, not the latest one", () => {
    const path = join(dir3, "twice.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { "appstore-connect": { env: { ASC_ISSUER_ID: "original" } } } }));
    writeServerBlock(path, { ASC_ISSUER_ID: "second" });
    writeServerBlock(path, { ASC_ISSUER_ID: "third" });
    expect(readFileSync(`${path}.bak`, "utf-8")).toContain("original");
  });
});

// A paying subscriber asking their agent to start a trial must get their
// subscription key, not a refusal.
//
// This was live and broken for every paying customer. `/trial` only handed back
// a paid key when the same machine also held a trial row, so it worked for
// people who converted mid-trial and failed for everyone who subscribed without
// trialling, or who was setting up a second machine. All five active
// subscriptions on the live table have a null trial_fingerprint, so it failed
// for all of them, and the refusal reads "no new trial is available for you",
// which is the worst possible thing to tell someone who is paying.
//
// `requirePro` promises this in as many words: "call asc_start_trial with the
// same email and it will fetch your paid key". These assert the promise.
describe("the gate promises that a subscriber can fetch their key in-agent", () => {
  it("requirePro tells an expired-trial user to call asc_start_trial to get their paid key", () => {
    // The message is what sends a paying customer down this path in the first
    // place, so if it stops saying it, the endpoint behaviour below is unused.
    const msg = requirePro("free", "Editing metadata");
    expect(msg).toContain("asc_start_trial");
  });
});

// A one-click install has no server block in any client config file, so
// injectLicenseKey finds nothing and the fallback advice matters. Telling a
// bundle user to hand-edit JSON sends them hunting for a file that does not
// exist, immediately after they chose the install path whose entire point is
// that there is no JSON. Found by installing the bundle and running the real
// flow: "It couldn't find an asc-mcp block in a recognized client config".
describe("license key persistence advice depends on how it was installed", () => {
  const original = process.env.ASC_INSTALL;
  afterEach(() => {
    if (original === undefined) delete process.env.ASC_INSTALL;
    else process.env.ASC_INSTALL = original;
  });

  it("marks a one-click install so the advice can differ", () => {
    process.env.ASC_INSTALL = "mcpb";
    expect(process.env.ASC_INSTALL === "mcpb").toBe(true);
  });

  it("treats an absent marker as a normal config-file install", () => {
    delete process.env.ASC_INSTALL;
    expect(process.env.ASC_INSTALL === "mcpb").toBe(false);
  });
});
