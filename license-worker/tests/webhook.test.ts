/**
 * The Polar webhook through the real handler, signature included, over schema.sql.
 * Delivery order and retries are Polar's to choose, so the tests choose badly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

type Env = Parameters<typeof worker.fetch>[1];
const SECRET = "polar_whs_test_secret";
const FUTURE = "2099-01-01T00:00:00.000Z";
const PRODUCT = "our-product";

function d1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = db.prepare(sql);
      return {
        bind(...a: unknown[]) { args = a; return this; },
        async all<T>() { return { results: stmt.all(...(args as never[])) as T[] }; },
        async first<T>() { return (stmt.get(...(args as never[])) as T | undefined) ?? null; },
        async run() { stmt.run(...(args as never[])); return {}; },
      };
    },
  };
}

let db: DatabaseSync;
let env: Env;
let mails: string[];
let mailOk: boolean;
let n = 0;

const deliver = (type: string, data: Record<string, unknown>, secret = SECRET) => {
  const body = JSON.stringify({ type, data: { product_id: PRODUCT, customer: { email: "Buyer@Example.com" }, ...data } });
  const id = `msg_${++n}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${ts}.${body}`).digest("base64");
  return worker.fetch(
    new Request("https://worker.test/webhook/polar", { method: "POST", body, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
};
const row = (id = "sub_1") => db.prepare("SELECT * FROM licenses WHERE polar_subscription_id = ?").get(id) as Record<string, unknown> | undefined;
const validate = async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/validate", { method: "POST", body: JSON.stringify({ key: row()!.key }), headers: { "content-type": "application/json" } }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
  return res.json() as Promise<{ valid: boolean; tier: string; reason?: string }>;
};

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  env = { DB: d1(db), BREVO_API_KEY: "test", POLAR_WEBHOOK_SECRET: SECRET, POLAR_EXTRA_PRODUCT_IDS: PRODUCT } as unknown as Env;
  mails = [];
  mailOk = true;
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    mails.push((JSON.parse(String(init.body)) as { to: Array<{ email: string }> }).to[0].email);
    return new Response("{}", { status: mailOk ? 201 : 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const created = { id: "sub_1", status: "active", current_period_end: FUTURE };

describe("a new subscription", () => {
  it("makes a live row with the address lowercased, and mails the key once", async () => {
    expect((await deliver("subscription.created", created)).status).toBe(200);
    await deliver("subscription.active", created);
    await deliver("subscription.updated", created);
    expect(row()).toMatchObject({ email: "buyer@example.com", active: 1, key_emailed: 1 });
    expect(mails).toEqual(["buyer@example.com"]);
    expect(await validate()).toMatchObject({ valid: true, tier: "pro" });
  });
  it("retries the mail on the next delivery when the first send failed", async () => {
    mailOk = false;
    await deliver("subscription.created", created);
    expect(row()).toMatchObject({ key_emailed: 0 });
    mailOk = true;
    await deliver("subscription.active", created);
    expect(row()).toMatchObject({ key_emailed: 1 });
    expect(mails).toHaveLength(2);
  });
  it("does not change the key when a duplicate arrives", async () => {
    await deliver("subscription.created", created);
    const key = row()!.key;
    await deliver("subscription.created", created);
    expect(row()!.key).toBe(key);
  });
});

describe("what the webhook refuses", () => {
  it("a bad signature", async () => {
    expect((await deliver("subscription.created", created, "polar_whs_wrong")).status).toBe(401);
    expect(row()).toBeUndefined();
  });
  it("another product in the same organization", async () => {
    await deliver("subscription.created", { ...created, product_id: "someone-elses-product" });
    expect(row()).toBeUndefined();
  });
});

describe("the life of a subscription", () => {
  it("a renewal moves the expiry", async () => {
    await deliver("subscription.created", created);
    await deliver("subscription.updated", { ...created, current_period_end: "2099-02-01T00:00:00.000Z" });
    expect(row()!.expires_at).toBe("2099-02-01T00:00:00.000Z");
  });
  it("past_due keeps access", async () => {
    await deliver("subscription.created", created);
    await deliver("subscription.updated", { ...created, status: "past_due" });
    expect(await validate()).toMatchObject({ valid: true });
  });
  it("cancelling keeps access until the period ends", async () => {
    await deliver("subscription.created", created);
    await deliver("subscription.canceled", { ...created, status: "canceled" });
    expect(row()!.canceled_at).toBeTruthy();
    expect(await validate()).toMatchObject({ valid: true });
  });
  it("uncancelling clears the mark", async () => {
    await deliver("subscription.created", created);
    await deliver("subscription.canceled", { ...created, status: "canceled" });
    await deliver("subscription.uncanceled", created);
    expect(row()!.canceled_at).toBeNull();
  });
  it("revoking ends access, and a late active event cannot undo it", async () => {
    await deliver("subscription.created", created);
    await deliver("subscription.revoked", { ...created, status: "canceled" });
    await deliver("subscription.updated", created);
    expect(row()).toMatchObject({ active: 0 });
    expect(await validate()).toMatchObject({ valid: false, reason: "revoked" });
  });
  it("a first payment that never completes switches the key off", async () => {
    await deliver("subscription.created", { ...created, status: "incomplete" });
    await deliver("subscription.updated", { ...created, status: "incomplete_expired" });
    expect(await validate()).toMatchObject({ valid: false });
  });
});

describe("events out of order", () => {
  it("a revoke that beats its own create leaves no working key, and mails nothing", async () => {
    await deliver("subscription.revoked", { ...created, status: "canceled" });
    await deliver("subscription.created", created);
    await deliver("subscription.active", created);
    expect(row()).toMatchObject({ active: 0 });
    expect(row()!.revoked_at).toBeTruthy();
    expect(mails).toHaveLength(0);
    expect(await validate()).toMatchObject({ valid: false });
  });
});
