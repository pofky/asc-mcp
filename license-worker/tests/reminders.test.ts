/**
 * The trial-reminder cron, driven end to end against a stub D1 and a stub
 * Brevo.
 *
 * `logic.test.ts` covers which rows are due. This covers the part that can lose
 * money in the other direction: that a send failure is retried rather than
 * marked done, and that a successful send stamps the row so the next run is
 * quiet. Those two are the whole reason the feature is safe to leave on a cron.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTrialReminders } from "../src/index.js";

const NOW = new Date("2026-09-03T15:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

interface Row {
  id: number;
  email: string | null;
  key: string;
  expires_at: string | null;
  source: string;
  revoked_at: string | null;
  canceled_at: string | null;
  trial_ending_emailed_at: string | null;
  trial_lapsed_emailed_at: string | null;
}

/** A D1 stand-in that understands only the two statements the job issues. */
function fakeDb(rows: Row[]) {
  const updates: Array<{ column: string; id: number }> = [];
  return {
    updates,
    rows,
    prepare(sql: string) {
      return {
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          this._args = args;
          return this;
        },
        async all<T>() {
          const [from, to] = this._args as [string, string];
          return {
            results: rows.filter(
              (r) =>
                r.source === "trial" &&
                r.expires_at !== null &&
                r.expires_at >= from &&
                r.expires_at <= to,
            ) as unknown as T[],
          };
        },
        async run() {
          const column = /trial_ending_emailed_at/.test(sql)
            ? "trial_ending_emailed_at"
            : "trial_lapsed_emailed_at";
          const [, id] = this._args as [string, number];
          updates.push({ column, id });
          const row = rows.find((r) => r.id === id);
          if (row) (row as unknown as Record<string, unknown>)[column] = this._args[0];
          return {};
        },
      };
    },
  };
}

const row = (over: Partial<Row>): Row => ({
  id: 1,
  email: "trialist@example.com",
  key: "ASC-AAAAA-BBBBB-CCCCC-DDDDD",
  expires_at: days(0.5),
  source: "trial",
  revoked_at: null,
  canceled_at: null,
  trial_ending_emailed_at: null,
  trial_lapsed_emailed_at: null,
  ...over,
});

let sent: Array<Record<string, unknown>>;

beforeEach(() => {
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

const env = (db: unknown) =>
  ({ DB: db, BREVO_API_KEY: "xkeysib-test" }) as unknown as Parameters<typeof runTrialReminders>[0];

describe("runTrialReminders", () => {
  it("mails the two due rows and stamps each one", async () => {
    const db = fakeDb([row({ id: 1, expires_at: days(0.5) }), row({ id: 2, expires_at: days(-1) })]);
    const out = await runTrialReminders(env(db), NOW);

    expect(out).toEqual({ ending: 1, lapsed: 1 });
    expect(sent.map((s) => s.subject)).toEqual([
      "Your asc-mcp Pro trial ends tomorrow",
      "Your asc-mcp trial has ended",
    ]);
    expect(db.updates).toEqual([
      { column: "trial_ending_emailed_at", id: 1 },
      { column: "trial_lapsed_emailed_at", id: 2 },
    ]);
  });

  it("is quiet on the next run, because the stamps are what it reads", async () => {
    const db = fakeDb([row({ id: 1, expires_at: days(0.5) }), row({ id: 2, expires_at: days(-1) })]);
    await runTrialReminders(env(db), NOW);
    sent = [];
    const second = await runTrialReminders(env(db), NOW);

    expect(second).toEqual({ ending: 0, lapsed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("does not mark a row done when the send failed, so the next run retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    const db = fakeDb([row({ id: 1, expires_at: days(0.5) })]);

    expect(await runTrialReminders(env(db), NOW)).toEqual({ ending: 0, lapsed: 0 });
    expect(db.updates).toHaveLength(0);
    expect(db.rows[0].trial_ending_emailed_at).toBeNull();
  });

  it("sends nothing at all when email is not configured", async () => {
    const db = fakeDb([row({ id: 1, expires_at: days(0.5) })]);
    const out = await runTrialReminders(
      { DB: db } as unknown as Parameters<typeof runTrialReminders>[0],
      NOW,
    );

    expect(out).toEqual({ ending: 0, lapsed: 0 });
    expect(sent).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it("carries the plain-text alternative into the actual Brevo payload", async () => {
    const db = fakeDb([row({ id: 1, expires_at: days(0.5) })]);
    await runTrialReminders(env(db), NOW);

    expect(sent[0].textContent).toContain("$9");
    expect(sent[0].htmlContent).toContain("ASC-AAAAA-BBBBB-CCCCC-DDDDD");
    expect((sent[0].to as Array<{ email: string }>)[0].email).toBe("trialist@example.com");
  });

  it("leaves the live table's own rows alone: nothing is due today", async () => {
    // The state on 3 September 2026, which is what makes this safe to deploy:
    // one running trial six days out, four that lapsed in August. Zero mail.
    const db = fakeDb([
      row({ id: 68, expires_at: "2026-09-09T17:53:55.163Z" }),
      row({ id: 53, expires_at: "2026-08-23T22:41:58.028Z" }),
      row({ id: 52, expires_at: "2026-08-17T16:20:24.818Z" }),
      row({ id: 51, expires_at: "2026-08-15T17:43:24.079Z" }),
      row({ id: 50, expires_at: "2026-08-14T05:30:04.842Z" }),
    ]);

    expect(await runTrialReminders(env(db), NOW)).toEqual({ ending: 0, lapsed: 0 });
    expect(sent).toHaveLength(0);
  });
});
