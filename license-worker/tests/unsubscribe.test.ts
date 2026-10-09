/**
 * Opting out of product mail, against a real SQLite table.
 *
 * `reminders.test.ts` drives the cron through a stand-in that restates the
 * query in JavaScript, which cannot catch a mistake in the query. Everything
 * here runs the worker's own statements against `schema.sql`, because the state
 * that matters, an address that has opted out, is one production has never
 * held: nobody could opt out before this existed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { runTrialReminders } from "../src/index.js";
import {
  buildUnsubscribeUrl,
  signDeleteToken,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  CONTACT_EMAIL,
  CONTROLLER_IDENTITY,
  UNSUBSCRIBE_URL,
} from "../src/logic.js";

const SECRET = "test-signing-secret";
const NOW = new Date("2026-10-09T15:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

type Env = Parameters<typeof runTrialReminders>[0];

/** Just enough of D1's surface, over the real schema. */
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
let sent: Array<Record<string, any>>;
let nextKey = 0;

function addRow(over: Record<string, unknown>) {
  const row = {
    key: `ASC-TEST-${nextKey++}`,
    email: "Trialist@Example.com",
    expires_at: days(0.5),
    source: "trial",
    marketing_opt_out_at: null,
    ...over,
  };
  db.prepare(
    "INSERT INTO licenses (key, email, expires_at, source, marketing_opt_out_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.key, row.email, row.expires_at, row.source, row.marketing_opt_out_at as null);
}

const optOuts = () =>
  db.prepare("SELECT email, marketing_opt_out_at FROM licenses ORDER BY id").all() as Array<{
    email: string;
    marketing_opt_out_at: string | null;
  }>;

const call = (method: string, url: string) =>
  worker.fetch(new Request(url, { method }), env, { waitUntil() {} } as never);

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf-8"));
  env = { DB: d1(db), BREVO_API_KEY: "xkeysib-test", DELETE_SECRET: SECRET } as unknown as Env;
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 201 } as Response;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("unsubscribe token", () => {
  it("round-trips, and ignores the case the address arrived in", async () => {
    const token = await signUnsubscribeToken(SECRET, "Trialist@Example.com");
    expect(await verifyUnsubscribeToken(SECRET, "trialist@example.com", token)).toBe(true);
  });

  it("refuses a token for another address, a tampered one, and another secret's", async () => {
    const token = await signUnsubscribeToken(SECRET, "a@example.com");
    const flipped = (token[0] === "0" ? "1" : "0") + token.slice(1);
    expect(await verifyUnsubscribeToken(SECRET, "b@example.com", token)).toBe(false);
    expect(await verifyUnsubscribeToken(SECRET, "a@example.com", flipped)).toBe(false);
    expect(await verifyUnsubscribeToken("other", "a@example.com", token)).toBe(false);
  });

  it("is not a deletion token, and a deletion token is not one of these", async () => {
    const email = "a@example.com";
    const del = await signDeleteToken(SECRET, email, NOW.getTime() + 3_600_000);
    expect(await verifyUnsubscribeToken(SECRET, email, del)).toBe(false);
    expect(await verifyUnsubscribeToken(SECRET, email, del.split(".")[1])).toBe(false);
  });

  it("gives no link at all without a secret, rather than an unsigned one", async () => {
    expect(await buildUnsubscribeUrl(null, "a@example.com")).toBeNull();
  });
});

describe("the reminder run and an opted-out address", () => {
  it("mails a due trial, with the link and the client headers in the real payload", async () => {
    addRow({});
    expect(await runTrialReminders(env, NOW)).toEqual({ ending: 1, lapsed: 0 });

    const link = await buildUnsubscribeUrl(SECRET, "Trialist@Example.com");
    expect(link!.startsWith(`${UNSUBSCRIBE_URL}?email=trialist%40example.com&token=`)).toBe(true);
    expect(sent[0].textContent).toContain(link);
    expect(sent[0].headers["List-Unsubscribe"]).toContain(`<${link}>`);
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0].replyTo.email).toBe(CONTACT_EMAIL);
  });

  it("does not select a due trial whose address opted out on another row, in another case", async () => {
    addRow({});
    addRow({ email: "trialist@example.com", source: "manual", expires_at: null, marketing_opt_out_at: days(-3) });
    expect(await runTrialReminders(env, NOW)).toEqual({ ending: 0, lapsed: 0 });
    expect(sent).toHaveLength(0);

    db.prepare("DELETE FROM licenses WHERE source = ?").run("manual");
    expect(await runTrialReminders(env, NOW)).toEqual({ ending: 1, lapsed: 0 });
  });

  it("skips the day-after note for someone who used the link in the day-before mail", async () => {
    addRow({});
    await runTrialReminders(env, NOW);
    const link = (sent[0].textContent as string).match(/Unsubscribe: (\S+)/)![1];

    expect((await call("POST", link)).status).toBe(200);

    const later = new Date(NOW.getTime() + 1.5 * 86_400_000);
    expect(await runTrialReminders(env, later)).toEqual({ ending: 0, lapsed: 0 });
    expect(sent).toHaveLength(1);
  });
});

describe("/unsubscribe", () => {
  const link = () => buildUnsubscribeUrl(SECRET, "trialist@example.com") as Promise<string>;

  it("changes nothing on GET, so a link scanner cannot unsubscribe anyone", async () => {
    addRow({});
    const res = await call("GET", await link());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form method="POST"');
    expect(optOuts()[0].marketing_opt_out_at).toBeNull();
  });

  it("stamps every row for the address on POST, whatever case each was stored in", async () => {
    addRow({});
    addRow({ email: "TRIALIST@example.com", source: "polar" });
    addRow({ email: "someone-else@example.com" });

    expect((await call("POST", await link())).status).toBe(200);

    const rows = optOuts();
    expect(rows[0].marketing_opt_out_at).not.toBeNull();
    expect(rows[1].marketing_opt_out_at).not.toBeNull();
    expect(rows[2].marketing_opt_out_at).toBeNull();
  });

  it("keeps the first opt-out time when the link is used twice", async () => {
    addRow({ marketing_opt_out_at: "2026-01-01T00:00:00.000Z" });
    await call("POST", await link());
    expect(optOuts()[0].marketing_opt_out_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses a tampered token and a missing one, and writes nothing", async () => {
    addRow({});
    const good = await link();
    for (const bad of [good.replace(/token=.{4}/, "token=zzzz"), good.replace(/&token=.*/, "")]) {
      expect((await call("POST", bad)).status).toBe(400);
    }
    expect(optOuts()[0].marketing_opt_out_at).toBeNull();
  });

  it("refuses every link when no signing secret is configured", async () => {
    addRow({});
    const good = await link();
    (env as unknown as Record<string, unknown>).DELETE_SECRET = undefined;
    expect((await call("POST", good)).status).toBe(400);
    expect(optOuts()[0].marketing_opt_out_at).toBeNull();
  });
});

describe("/admin/announce", () => {
  const announce = (email: string) =>
    worker.fetch(
      new Request("https://w.example/admin/announce", {
        method: "POST",
        headers: { "x-announce-token": "announce-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ email, subject: "News", html: "<p>Hello</p>" }),
      }),
      { ...(env as object), ANNOUNCE_TOKEN: "announce-secret" } as Env,
      { waitUntil() {} } as never,
    );

  it("refuses an address that opted out, even on a differently cased row", async () => {
    addRow({ email: "buyer@example.com", source: "polar" });
    addRow({ email: "Buyer@Example.com", marketing_opt_out_at: days(-1) });
    const res = await announce("buyer@example.com");
    expect(res.status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it("adds the footer and the headers to whatever the operator wrote", async () => {
    addRow({ email: "buyer@example.com", source: "polar" });
    expect((await announce("buyer@example.com")).status).toBe(200);
    expect(sent[0].htmlContent).toContain("<p>Hello</p>");
    expect(sent[0].htmlContent).toContain(CONTROLLER_IDENTITY);
    expect(sent[0].htmlContent).toContain("/unsubscribe?email=buyer%40example.com");
    expect(sent[0].headers["List-Unsubscribe"]).toContain("/unsubscribe?email=buyer%40example.com");
  });
});
