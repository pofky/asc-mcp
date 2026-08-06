/**
 * Regression tests for the licence worker's decision logic.
 *
 * Every rule in logic.ts is annotated with the incident that produced it, and
 * until now none of them had a test: the worker shipped with no test suite at
 * all, so the only thing standing between a refactor and a paying customer
 * losing access was the comment above the branch. These lock the behaviour the
 * comments describe.
 */
import { describe, it, expect } from "vitest";
import {
  GRACE_DAYS,
  TRIAL_DAYS,
  buildCheckoutUrl,
  candidateKeys,
  classifyPolarEvent,
  computeActiveFlag,
  daysRemaining,
  isLicenseUsable,
  isOwnProduct,
  isValidEmail,
  isValidFingerprint,
  isValidToolName,
  pickLookupRow,
  resolveProductId,
  shouldBeActive,
  timingSafeEqual,
  trialExpiry,
  verifyPolarSignature,
  webhookSecrets,
  type LookupRow,
} from "../src/logic.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("input validation", () => {
  it("accepts real tool names and rejects anything that could be echoed as markup", () => {
    expect(isValidToolName("release_preflight")).toBe(true);
    expect(isValidToolName("set_app_metadata")).toBe(true);
    for (const bad of ["<script>", "Release_Preflight", "a b", "", "x".repeat(65), 42, null])
      expect(isValidToolName(bad)).toBe(false);
  });

  it("requires a fingerprint to be a full lowercase SHA-256 digest", () => {
    expect(isValidFingerprint("a".repeat(64))).toBe(true);
    expect(isValidFingerprint("A".repeat(64))).toBe(false);
    expect(isValidFingerprint("a".repeat(63))).toBe(false);
    expect(isValidFingerprint("")).toBe(false);
  });

  it("is loose about email, because rejecting a valid address costs a lead", () => {
    for (const ok of ["a@b.co", "first+tag@sub.domain.example", "ünïcode@exämple.de"])
      expect(isValidEmail(ok)).toBe(true);
    for (const bad of ["nope", "a@b", "a b@c.d", "", `${"a".repeat(250)}@b.co`])
      expect(isValidEmail(bad)).toBe(false);
  });
});

describe("expiry arithmetic", () => {
  it("issues a trial of exactly TRIAL_DAYS", () => {
    expect(trialExpiry(NOW)).toBe(days(TRIAL_DAYS));
  });

  it("reports whole days left, floored at zero, and never negative", () => {
    expect(daysRemaining(days(7), NOW)).toBe(7);
    expect(daysRemaining(days(0.5), NOW)).toBe(1);
    expect(daysRemaining(days(-3), NOW)).toBe(0);
    expect(daysRemaining(null, NOW)).toBe(0);
    expect(daysRemaining("not a date", NOW)).toBe(0);
  });
});

describe("isLicenseUsable", () => {
  const paid = (over: Partial<Parameters<typeof isLicenseUsable>[0]> = {}) => ({
    expires_at: days(30),
    active: 1,
    source: "polar",
    canceled_at: null,
    ...over,
  });

  it("honours a live subscription and a perpetual row", () => {
    expect(isLicenseUsable(paid(), NOW).usable).toBe(true);
    expect(isLicenseUsable(paid({ expires_at: null }), NOW).usable).toBe(true);
  });

  it("refuses an inactive row whatever its expiry says", () => {
    expect(isLicenseUsable(paid({ active: 0 }), NOW)).toEqual({ usable: false, reason: "inactive" });
  });

  // The grace window exists so a late renewal webhook cannot demote someone who
  // has paid. Its edges are the part that matters.
  it("grants a paid row exactly GRACE_DAYS past expiry, then stops", () => {
    expect(isLicenseUsable(paid({ expires_at: days(-1) }), NOW)).toEqual({ usable: true, grace: true });
    expect(isLicenseUsable(paid({ expires_at: days(-GRACE_DAYS) }), NOW).usable).toBe(true);
    expect(isLicenseUsable(paid({ expires_at: days(-GRACE_DAYS - 0.001) }), NOW)).toEqual({
      usable: false,
      reason: "expired",
    });
  });

  it("never gives a trial grace, which would silently make every trial 11 days", () => {
    expect(isLicenseUsable(paid({ source: "trial", expires_at: days(-0.001) }), NOW)).toEqual({
      usable: false,
      reason: "trial_expired",
    });
  });

  it("never gives a cancelled subscription grace: no renewal is coming", () => {
    expect(
      isLicenseUsable(paid({ expires_at: days(-1), canceled_at: days(-5) }), NOW),
    ).toEqual({ usable: false, reason: "canceled" });
  });

  it("treats a row predating the source column as paid, not as a trial", () => {
    expect(isLicenseUsable({ expires_at: days(-1), active: 1 }, NOW).usable).toBe(true);
  });
});

describe("Polar status handling", () => {
  it("activates on anything that is not a known-dead status", () => {
    for (const s of [undefined, "active", "trialing", "past_due", "incomplete", "canceled"])
      expect(computeActiveFlag(s)).toBe(1);
    for (const s of ["revoked", "incomplete_expired", "unpaid"]) expect(computeActiveFlag(s)).toBe(0);
  });

  // `canceled` means "will not renew", not "access ends now". Listing it as a
  // dead status demoted paying customers the instant they cancelled.
  it("keeps a customer who cancelled mid-period", () => {
    expect(shouldBeActive("canceled", days(10), NOW)).toBe(1);
  });

  it("refuses to resurrect a lapsed subscription from a replayed event", () => {
    expect(shouldBeActive("active", days(-1), NOW)).toBe(0);
    expect(shouldBeActive("active", days(1), NOW)).toBe(1);
    expect(shouldBeActive("active", null, NOW)).toBe(1);
    expect(shouldBeActive("active", "garbage", NOW)).toBe(1);
    expect(shouldBeActive("revoked", days(365), NOW)).toBe(0);
  });

  it("classifies every event this worker acts on", () => {
    for (const t of [
      "subscription.created",
      "subscription.updated",
      "subscription.active",
      "subscription.cycled",
      "subscription.uncanceled",
      "subscription.resumed",
    ])
      expect(classifyPolarEvent(t)).toBe("activate");
    for (const t of ["subscription.canceled", "subscription.revoked"])
      expect(classifyPolarEvent(t)).toBe("cancel");
    for (const t of ["order.created", "checkout.updated", "benefit.granted", ""])
      expect(classifyPolarEvent(t)).toBe("ignore");
  });
});

describe("product guard", () => {
  const OWN = "7cd3dd0b-7ee2-43db-a920-f7d4371f9d9a";
  const LEGACY = "7cf11984-03f1-4251-b765-4c0abb3ab99f";

  it("reads the product id from every shape Polar has used", () => {
    expect(resolveProductId({ product_id: OWN })).toBe(OWN);
    expect(resolveProductId({ productId: OWN })).toBe(OWN);
    expect(resolveProductId({ product: { id: OWN } })).toBe(OWN);
    expect(resolveProductId({})).toBeNull();
    expect(resolveProductId({ product_id: "" })).toBeNull();
  });

  it("accepts both organizations and rejects a sibling product's sale", () => {
    expect(isOwnProduct({ product_id: OWN })).toBe(true);
    expect(isOwnProduct({ product: { id: LEGACY } })).toBe(true);
    expect(isOwnProduct({ product_id: "00000000-0000-0000-0000-000000000000" })).toBe(false);
  });

  // A false negative here costs a paying customer their key, and the legacy
  // payload shape carries no product id at all.
  it("treats an event with no product id as ours", () => {
    expect(isOwnProduct({})).toBe(true);
  });
});

describe("webhook signature", () => {
  const SECRET = "polar_whs_abcdefghijklmnop";

  const sign = async (id: string, ts: string, body: string, secret: string) => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    return Buffer.from(new Uint8Array(buf)).toString("base64");
  };

  const headers = (over: Record<string, string>) =>
    new Headers({ "webhook-id": "evt_1", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), ...over });

  it("accepts a correctly signed body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"subscription.active"}';
    const sig = await sign("evt_1", ts, body, SECRET);
    const h = headers({ "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
    expect(await verifyPolarSignature(h, body, [SECRET])).toBe(true);
  });

  it("rejects a tampered body, a wrong secret and a missing header", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"subscription.active"}';
    const sig = await sign("evt_1", ts, body, SECRET);
    const h = headers({ "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
    expect(await verifyPolarSignature(h, body + " ", [SECRET])).toBe(false);
    expect(await verifyPolarSignature(h, body, ["polar_whs_wrongwrongwrong"])).toBe(false);
    expect(await verifyPolarSignature(h, body, [])).toBe(false);
    expect(await verifyPolarSignature(headers({}), body, [SECRET])).toBe(false);
  });

  it("rejects a replay outside the five-minute window", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 301);
    const body = "{}";
    const sig = await sign("evt_1", ts, body, SECRET);
    const h = headers({ "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
    expect(await verifyPolarSignature(h, body, [SECRET])).toBe(false);
  });

  // Both organizations deliver during the migration, each signing with its own
  // secret, so a signature from any configured secret has to pass.
  it("accepts a signature from the second configured secret", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "{}";
    const sig = await sign("evt_1", ts, body, "polar_whs_second_org_secret");
    const h = headers({ "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
    expect(await verifyPolarSignature(h, body, [SECRET, "polar_whs_second_org_secret"])).toBe(true);
  });

  it("accepts a header carrying several space-delimited signatures", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "{}";
    const sig = await sign("evt_1", ts, body, SECRET);
    const h = headers({ "webhook-timestamp": ts, "webhook-signature": `v1,AAAA v1,${sig}` });
    expect(await verifyPolarSignature(h, body, [SECRET])).toBe(true);
  });
});

describe("candidateKeys", () => {
  // The dashboard's polar_whs_ secret is keyed on its raw UTF-8; a secret minted
  // through the API is whsec_<base64> and keyed on the decoded bytes. Getting
  // this wrong meant the first paying customer got no key at all.
  it("always offers the raw UTF-8 of the whole secret first", () => {
    const keys = candidateKeys("polar_whs_notbase64!!");
    expect(keys[0]).toEqual(new TextEncoder().encode("polar_whs_notbase64!!"));
  });

  it("also offers the base64-decoded remainder when the tail decodes", () => {
    const keys = candidateKeys("whsec_" + Buffer.from("hunter2").toString("base64"));
    expect(keys).toHaveLength(2);
    expect(new TextDecoder().decode(keys[1])).toBe("hunter2");
  });

  it("returns nothing for an empty secret", () => {
    expect(candidateKeys("")).toEqual([]);
  });
});

describe("timingSafeEqual", () => {
  it("compares by value and rejects a length mismatch", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("pickLookupRow", () => {
  const row = (over: Partial<LookupRow>): LookupRow => ({
    key: "K",
    tier: "pro",
    active: 1,
    expires_at: days(30),
    source: "polar",
    ...over,
  });

  // Newest-first alone handed a paying customer their dead trial key, which
  // validates as free and looks exactly like "I paid and it does not work".
  it("prefers the paid row over a live trial", () => {
    const picked = pickLookupRow(
      [row({ key: "TRIAL", source: "trial", expires_at: days(3) }), row({ key: "PAID" })],
      NOW,
    );
    expect(picked?.key).toBe("PAID");
  });

  it("falls back to a live trial when there is no subscription", () => {
    expect(pickLookupRow([row({ key: "TRIAL", source: "trial", expires_at: days(3) })], NOW)?.key).toBe("TRIAL");
  });

  it("offers nothing rather than a key that will not validate", () => {
    expect(pickLookupRow([row({ source: "trial", expires_at: days(-1) })], NOW)).toBeNull();
    expect(pickLookupRow([row({ active: 0 })], NOW)).toBeNull();
    expect(pickLookupRow([], NOW)).toBeNull();
  });
});

describe("webhookSecrets", () => {
  it("puts the newest secret first and drops the ones that are unset", () => {
    expect(webhookSecrets({ POLAR_WEBHOOK_SECRET: "a", POLAR_WEBHOOK_SECRET_2: "b" })).toEqual(["b", "a"]);
    expect(webhookSecrets({ POLAR_WEBHOOK_SECRET: "a" })).toEqual(["a"]);
    expect(webhookSecrets({ POLAR_WEBHOOK_SECRET: "" })).toEqual([]);
    expect(webhookSecrets({})).toEqual([]);
  });
});

describe("buildCheckoutUrl", () => {
  it("always points at the one checkout constant, so /go cannot be an open redirect", () => {
    const url = new URL(buildCheckoutUrl("release_preflight", "a@b.co"));
    expect(url.origin).toBe("https://buy.polar.sh");
    expect(url.searchParams.get("utm_content")).toBe("release_preflight");
    expect(url.searchParams.get("customer_email")).toBe("a@b.co");
  });

  it("drops attacker-shaped attribution instead of echoing it", () => {
    const url = new URL(buildCheckoutUrl("<script>", "not-an-email"));
    expect(url.searchParams.has("utm_content")).toBe(false);
    expect(url.searchParams.has("customer_email")).toBe(false);
    expect(url.searchParams.get("utm_source")).toBe("agent");
  });
});
