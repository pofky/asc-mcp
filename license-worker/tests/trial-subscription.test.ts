/**
 * A trial key whose owner has since subscribed, against a real SQLite table.
 *
 * The state is the one production first held on 18 October: a trial started on
 * the 12th, a subscription bought from the trial-ending mail on the 18th, and
 * the trial key still on the customer's machine, due to expire on the 19th.
 * Every statement here is the worker's own, over `schema.sql`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

type Env = Parameters<typeof worker.fetch>[1];

const TRIAL_START = "2026-10-12 15:57:54";
const TRIAL_END = "2026-10-19T15:57:53.939Z";
const BOUGHT = "2026-10-18 15:17:13";
const PAID_UNTIL = "2026-11-18T15:17:11.270421Z";
const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);

function d1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = db.prepare(sql);
      return {
        bind(...a: unknown[]) {
          args = a;
          return this;
        },
        async all<T>() {
          return { results: stmt.all(...(args as never[])) as T[] };
        },
        async first<T>() {
          return (stmt.get(...(args as never[])) as T | undefined) ?? null;
        },
        async run() {
          stmt.run(...(args as never[]));
          return {};
        },
      };
    },
  };
}

let db: DatabaseSync;
let env: Env;

function insert(row: Record<string, string | number | null>) {
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO licenses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  ).run(...(Object.values(row) as never[]));
}

function trial(over: Record<string, string | number | null> = {}) {
  insert({
    key: "ASC-TRIAL",
    email: "steve@example.com",
    source: "trial",
    expires_at: TRIAL_END,
    trial_fingerprint: FINGERPRINT,
    created_at: TRIAL_START,
    ...over,
  });
}

function subscription(over: Record<string, string | number | null> = {}) {
  insert({
    key: "ASC-PAID",
    email: "steve@example.com",
    source: "polar",
    polar_subscription_id: "sub-1",
    expires_at: PAID_UNTIL,
    created_at: BOUGHT,
    ...over,
  });
}

async function validate(key: string, at: string) {
  vi.setSystemTime(new Date(at));
  const res = await worker.fetch(
    new Request("https://worker.test/validate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ key }),
    }),
    env,
    { waitUntil() {} } as never,
  );
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf-8"));
  env = { DB: d1(db) } as unknown as Env;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a trial key after its owner subscribed", () => {
  it("keeps working past the trial's end, as the subscription", async () => {
    trial();
    subscription();
    const res = await validate("ASC-TRIAL", "2026-10-20T09:00:00Z");
    expect(res).toEqual({ valid: true, tier: "pro", expires: PAID_UNTIL });
  });

  it("stops counting trial days the moment they pay", async () => {
    trial();
    subscription();
    const res = await validate("ASC-TRIAL", "2026-10-18T16:00:00Z");
    expect(res.trial).toBeUndefined();
    expect(res.expires).toBe(PAID_UNTIL);
  });

  it("matches the address in any case", async () => {
    trial({ email: "steve@example.com" });
    subscription({ email: "Steve@Example.com" });
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(true);
  });

  it("follows the subscription when it is claimed by the machine that ran the trial", async () => {
    trial();
    subscription({ claim_fingerprint: FINGERPRINT });
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(true);
  });

  it("ends when the subscription is revoked", async () => {
    trial();
    subscription({ active: 0, revoked_at: "2026-10-25T00:00:00Z" });
    const res = await validate("ASC-TRIAL", "2026-10-26T09:00:00Z");
    expect(res).toEqual({ valid: false, tier: "free", reason: "trial_expired" });
  });

  it("does not change the paid key's own answer", async () => {
    trial();
    subscription();
    expect(await validate("ASC-PAID", "2026-10-20T09:00:00Z")).toEqual({
      valid: true,
      tier: "pro",
      expires: PAID_UNTIL,
    });
  });
});

describe("a trial key that must not borrow a subscription", () => {
  it("is still a trial when nobody has bought", async () => {
    trial();
    const res = await validate("ASC-TRIAL", "2026-10-18T16:00:00Z");
    expect(res).toEqual({ valid: true, tier: "pro", expires: TRIAL_END, trial: true });
    expect(await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).toEqual({
      valid: false,
      tier: "free",
      reason: "trial_expired",
    });
  });

  it("ignores another address's subscription", async () => {
    trial();
    subscription({ email: "someone-else@example.com" });
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(false);
  });

  it("ignores a subscription bought before the trial began", async () => {
    subscription({ created_at: "2026-10-01 10:00:00", expires_at: PAID_UNTIL });
    trial();
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(false);
  });

  it("ignores a subscription claimed by a different machine", async () => {
    trial();
    subscription({ claim_fingerprint: OTHER_FINGERPRINT });
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(false);
  });

  it("compares the two timestamp shapes correctly", async () => {
    // /trial writes datetime('now'); a hand-issued row may carry an ISO T.
    // A space sorts below T, so without the replace a same-day purchase
    // written with a T would compare as earlier than a trial written without.
    trial({ created_at: "2026-10-18 10:00:00" });
    subscription({ created_at: "2026-10-18T15:17:13Z" });
    expect((await validate("ASC-TRIAL", "2026-10-20T09:00:00Z")).valid).toBe(true);
  });
});
