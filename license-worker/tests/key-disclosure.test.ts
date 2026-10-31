/**
 * A license key belongs to whoever reads the mailbox on the subscription. Until
 * 31 October 2026 anyone holding the address could read the key from /key, or
 * from /trial on a subscription no machine had claimed yet. Real handlers, over
 * `schema.sql`, with Brevo stubbed and each mail recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

type Env = Parameters<typeof worker.fetch>[1];
const KEY = "ASC-SECRET-SUBSCRIBER-KEY";
const STRANGER = "c".repeat(64);
const OWNER = "d".repeat(64);
const FUTURE = "2099-01-01T00:00:00.000Z";

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
let mails: Array<{ to: string; body: string }>;
let mailOk: boolean;
let ip = 0;
let address = 0;

const subscribe = (email: string, over: Record<string, string | null> = {}) => {
  const row: Record<string, string | null> = { key: KEY, email, source: "polar", expires_at: FUTURE, polar_subscription_id: `sub_${email}`, ...over };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO licenses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
};
const nextAddress = () => `user${++address}@example.com`;

const request = (path: string, init: RequestInit) =>
  worker.fetch(new Request(`https://worker.test${path}`, { ...init, headers: { "CF-Connecting-IP": `10.0.0.${++ip}`, ...(init.headers as object) } }), env);
const lookup = (email: string) => request("/key", { method: "POST", body: new URLSearchParams({ email }), headers: { "content-type": "application/x-www-form-urlencoded" } });
const trial = (email: string, fingerprint: string) => request("/trial", { method: "POST", body: JSON.stringify({ email, fingerprint }), headers: { "content-type": "application/json" } });

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  env = { DB: d1(db), BREVO_API_KEY: "test" } as unknown as Env;
  mails = [];
  mailOk = true;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: Array<{ email: string }>; htmlContent: string; textContent?: string };
    mails.push({ to: body.to[0].email, body: body.htmlContent + (body.textContent ?? "") });
    return new Response("{}", { status: mailOk ? 201 : 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /key", () => {
  it("mails the key to the address, and never prints it", async () => {
    const email = nextAddress();
    subscribe(email);
    const res = await lookup(email);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(KEY);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(email);
    expect(mails[0].body).toContain(KEY);
  });
  it("answers an address with no license exactly as one with a license", async () => {
    const known = nextAddress();
    const unknown = nextAddress();
    subscribe(known);
    const a = await (await lookup(known)).text();
    const b = await (await lookup(unknown)).text();
    expect(a.replaceAll(known, "X")).toBe(b.replaceAll(unknown, "X"));
    expect(mails).toHaveLength(1);
  });
  it("finds a mixed-case address, and mails the stored one", async () => {
    const email = nextAddress();
    subscribe(email);
    await lookup(email.toUpperCase());
    expect(mails[0]?.to).toBe(email);
  });
  it("says so when the mail fails, rather than telling them to check their inbox", async () => {
    const email = nextAddress();
    subscribe(email);
    mailOk = false;
    const res = await lookup(email);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(KEY);
  });
  it("cannot be used to fill someone's inbox", async () => {
    const email = nextAddress();
    subscribe(email);
    for (let i = 0; i < 8; i++) await lookup(email);
    expect(mails).toHaveLength(3);
  });
});

describe("POST /trial on an address with a subscription", () => {
  it("a stranger on an unclaimed subscription gets no key, and the owner gets the mail", async () => {
    const email = nextAddress();
    subscribe(email);
    const res = await trial(email, STRANGER);
    const raw = await res.text();
    expect(raw).not.toContain(KEY);
    expect(JSON.parse(raw)).toMatchObject({ ok: false, subscription: true });
    expect(mails.map((m) => m.to)).toEqual([email]);
    expect(mails[0].body).toContain(KEY);
  });
  it("records nothing about the stranger's machine", async () => {
    const email = nextAddress();
    subscribe(email);
    await trial(email, STRANGER);
    expect(db.prepare("SELECT claim_fingerprint c FROM licenses WHERE email = ?").get(email)).toEqual({ c: null });
  });
  it("still answers a machine that claimed the subscription before this changed", async () => {
    const email = nextAddress();
    subscribe(email, { claim_fingerprint: OWNER });
    const body = (await (await trial(email, OWNER)).json()) as { ok: boolean; key: string };
    expect(body).toMatchObject({ ok: true, key: KEY, subscription: true });
    expect(mails).toHaveLength(0);
  });
  it("another machine on a claimed subscription gets the mail path, not the key", async () => {
    const email = nextAddress();
    subscribe(email, { claim_fingerprint: OWNER });
    const raw = await (await trial(email, STRANGER)).text();
    expect(raw).not.toContain(KEY);
    expect(mails).toHaveLength(1);
  });
});

describe("bad bodies get a 400, not the catch-all 500", () => {
  it("/validate with a JSON null", async () => {
    const res = await request("/validate", { method: "POST", body: "null", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
  it("/delete with a JSON body", async () => {
    const res = await request("/delete", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /trial, one per Apple account", () => {
  it("lets a second Apple account trial on the same address, so a typed address cannot burn it", async () => {
    const email = nextAddress();
    expect(((await (await trial(email, OWNER)).json()) as { ok: boolean }).ok).toBe(true);
    expect(((await (await trial(email, STRANGER)).json()) as { ok: boolean }).ok).toBe(true);
  });
  it("gives an ended subscription the price, not a new trial", async () => {
    const email = nextAddress();
    subscribe(email, { revoked_at: "2026-01-01 00:00:00", expires_at: "2026-01-01T00:00:00.000Z" });
    db.prepare("UPDATE licenses SET active = 0 WHERE email = ?").run(email);
    const res = await trial(email, STRANGER);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "trial_unavailable" });
  });
  it("still returns the same trial to the machine that started it", async () => {
    const email = nextAddress();
    const first = (await (await trial(email, OWNER)).json()) as { key: string };
    const again = (await (await trial(email, OWNER)).json()) as { key: string; already_started: boolean };
    expect(again).toMatchObject({ key: first.key, already_started: true });
  });
});

describe("a person on a bad address", () => {
  it("gets a page", async () => {
    const res = await request("/nope", { method: "GET", headers: { Accept: "text/html" } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("That page is not here");
  });
  it("a client still gets JSON", async () => {
    expect(await (await request("/nope", { method: "GET" })).json()).toEqual({ error: "Not found" });
  });
});
