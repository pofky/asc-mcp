import { describe, it, expect } from "vitest";
import {
  computeActiveFlag,
  classifyPolarEvent,
  isLicenseUsable,
  GRACE_DAYS,
  webhookSecrets,
  verifyPolarSignature,
} from "../license-worker/src/index.js";

// Regression coverage for the bug that twice left paying customers at
// active=0 (and therefore never emailed a key): activation must succeed for
// every live Polar status, not just an exact "active"/"trialing" match.
describe("computeActiveFlag", () => {
  it("activates on a real paid subscription status", () => {
    expect(computeActiveFlag("active")).toBe(1);
  });

  it("activates on trialing", () => {
    expect(computeActiveFlag("trialing")).toBe(1);
  });

  it("activates on incomplete (payment settling) — the status that caused the outage", () => {
    expect(computeActiveFlag("incomplete")).toBe(1);
  });

  it("activates on past_due (still a live, recoverable sub)", () => {
    expect(computeActiveFlag("past_due")).toBe(1);
  });

  it("activates when Polar omits a status", () => {
    expect(computeActiveFlag(undefined)).toBe(1);
    expect(computeActiveFlag("")).toBe(1);
  });

  it("does NOT activate genuinely dead statuses", () => {
    expect(computeActiveFlag("canceled")).toBe(0);
    expect(computeActiveFlag("revoked")).toBe(0);
    expect(computeActiveFlag("incomplete_expired")).toBe(0);
    expect(computeActiveFlag("unpaid")).toBe(0);
  });
});

describe("classifyPolarEvent", () => {
  it("treats created/active/updated as activation events", () => {
    expect(classifyPolarEvent("subscription.created")).toBe("activate");
    expect(classifyPolarEvent("subscription.active")).toBe("activate");
    expect(classifyPolarEvent("subscription.updated")).toBe("activate");
  });

  /**
   * A renewal is what keeps a paying customer's expires_at moving forward.
   * Missing the event Polar actually sends for it demotes them to free once the
   * grace window closes, so every "period continues" event must activate.
   */
  it("treats a renewal or a resumed subscription as activation", () => {
    expect(classifyPolarEvent("subscription.cycled")).toBe("activate");
    expect(classifyPolarEvent("subscription.uncanceled")).toBe("activate");
    expect(classifyPolarEvent("subscription.resumed")).toBe("activate");
  });

  it("treats canceled/revoked as cancellation events", () => {
    expect(classifyPolarEvent("subscription.canceled")).toBe("cancel");
    expect(classifyPolarEvent("subscription.revoked")).toBe("cancel");
  });

  it("ignores unrelated events", () => {
    expect(classifyPolarEvent("order.created")).toBe("ignore");
    expect(classifyPolarEvent("checkout.created")).toBe("ignore");
  });
});

// A renewal reaches us as subscription.updated. If that webhook is late or
// dropped, the stored expiry is already in the past and a paying customer gets
// demoted mid-session. Grace covers our own plumbing, not unpaid time.
describe("isLicenseUsable", () => {
  const future = "2026-12-01T00:00:00Z";
  const now = new Date("2026-07-30T12:00:00Z");

  it("validates a live subscription", () => {
    expect(isLicenseUsable({ expires_at: future, active: 1 }, now)).toEqual({ usable: true });
  });

  it("validates a licence with no expiry set", () => {
    expect(isLicenseUsable({ expires_at: null, active: 1 }, now)).toEqual({ usable: true });
  });

  it("keeps a just-expired licence usable through the grace window, flagged", () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(isLicenseUsable({ expires_at: yesterday, active: 1 }, now)).toEqual({
      usable: true,
      grace: true,
    });
  });

  it("stops validating once the grace window closes", () => {
    const longGone = new Date(now.getTime() - (GRACE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(isLicenseUsable({ expires_at: longGone, active: 1 }, now)).toEqual({
      usable: false,
      reason: "expired",
    });
  });

  it("never validates a revoked licence, even inside the grace window", () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(isLicenseUsable({ expires_at: yesterday, active: 0 }, now)).toEqual({
      usable: false,
      reason: "inactive",
    });
  });

  it("ignores an unparseable expiry rather than locking a customer out", () => {
    expect(isLicenseUsable({ expires_at: "not-a-date", active: 1 }, now)).toEqual({ usable: true });
  });
});

/**
 * Grandfathering the pre-move subscribers means two Polar organizations deliver
 * to the same endpoint at once: the old org sends renewals and cancellations
 * for the existing subscriptions, the new org sends new signups. Each signs
 * with its own secret, so a single-secret check would 401 one of them.
 */
describe("webhookSecrets", () => {
  it("accepts both organizations while the move is in flight", () => {
    expect(
      webhookSecrets({ POLAR_WEBHOOK_SECRET: "old", POLAR_WEBHOOK_SECRET_2: "new" }),
    ).toEqual(["new", "old"]);
  });

  it("is a plain single-secret setup when the second is unset", () => {
    expect(webhookSecrets({ POLAR_WEBHOOK_SECRET: "old" })).toEqual(["old"]);
  });

  it("drops empty values so an unset secret never verifies", () => {
    expect(webhookSecrets({ POLAR_WEBHOOK_SECRET: "", POLAR_WEBHOOK_SECRET_2: "" })).toEqual([]);
    expect(webhookSecrets({})).toEqual([]);
  });
});

/**
 * The signature check is the single point where a paying customer either gets a
 * licence key or silently gets nothing, and it has already broken once over the
 * exact byte derivation of the HMAC key. A dashboard secret is `polar_whs_...`
 * and keys off the raw UTF-8 of the whole string; an API-minted one is
 * `whsec_<base64>` and keys off the decoded remainder. Both must verify.
 */
describe("verifyPolarSignature", () => {
  const ID = "msg_test";
  const BODY = JSON.stringify({ type: "subscription.created", data: { id: "sub_1" } });

  async function sign(keyBytes: Uint8Array, timestamp: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes as unknown as ArrayBufferView,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${ID}.${timestamp}.${BODY}`),
    );
    return Buffer.from(new Uint8Array(buf)).toString("base64");
  }

  function headers(timestamp: string, sig: string): Headers {
    return new Headers({
      "webhook-id": ID,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${sig}`,
    });
  }

  const now = () => String(Math.floor(Date.now() / 1000));

  it("accepts a dashboard secret signed over its raw UTF-8 bytes", async () => {
    const secret = "polar_whs_dashboardsecret";
    const ts = now();
    const sig = await sign(new TextEncoder().encode(secret), ts);
    expect(await verifyPolarSignature(headers(ts, sig), BODY, [secret])).toBe(true);
  });

  it("accepts an API-minted whsec_ secret signed over its decoded bytes", async () => {
    const raw = Buffer.from("an-api-minted-signing-key");
    const secret = `whsec_${raw.toString("base64")}`;
    const ts = now();
    const sig = await sign(new Uint8Array(raw), ts);
    expect(await verifyPolarSignature(headers(ts, sig), BODY, [secret])).toBe(true);
  });

  it("accepts a delivery from the second organization", async () => {
    const secret = "polar_whs_neworg";
    const ts = now();
    const sig = await sign(new TextEncoder().encode(secret), ts);
    const accepted = await verifyPolarSignature(headers(ts, sig), BODY, [
      secret,
      "polar_whs_oldorg",
    ]);
    expect(accepted).toBe(true);
  });

  it("rejects a wrong secret, a tampered body and a stale timestamp", async () => {
    const secret = "polar_whs_real";
    const ts = now();
    const sig = await sign(new TextEncoder().encode(secret), ts);

    expect(await verifyPolarSignature(headers(ts, sig), BODY, ["polar_whs_other"])).toBe(false);
    expect(await verifyPolarSignature(headers(ts, sig), BODY + " ", [secret])).toBe(false);

    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const staleSig = await sign(new TextEncoder().encode(secret), stale);
    expect(await verifyPolarSignature(headers(stale, staleSig), BODY, [secret])).toBe(false);
  });
});
