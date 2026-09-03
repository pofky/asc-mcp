import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runDoctor, formatDoctor, trialDaysLeft } from "../src/doctor.js";
import { clearLicenseCache } from "../src/license.js";

const SAVED = { ...process.env };

describe("runDoctor", () => {
  beforeEach(() => {
    delete process.env.ASC_KEY_ID;
    delete process.env.ASC_ISSUER_ID;
    delete process.env.ASC_PRIVATE_KEY_PATH;
    delete process.env.ASC_LICENSE_KEY;
  });
  afterEach(() => {
    process.env = { ...SAVED };
    clearLicenseCache();
    vi.restoreAllMocks();
  });

  it("fails clearly when nothing is configured, and never throws", async () => {
    // Point discovery at a definitely-missing path so no real key is found.
    process.env.ASC_PRIVATE_KEY_PATH = "/nonexistent/AuthKey_ABC0000000.p8";
    const report = await runDoctor();
    expect(report.healthy).toBe(false);
    const text = formatDoctor(report);
    expect(text).toContain("Issuer ID");
    expect(text).toContain("Not ready yet");
    // Every failing check carries an actionable fix.
    for (const c of report.checks) {
      if (c.status === "fail") expect(c.fix, `${c.name} needs a fix`).toBeTruthy();
    }
  });

  it("skips the live connection when credentials are incomplete", async () => {
    process.env.ASC_PRIVATE_KEY_PATH = "/nonexistent/AuthKey_ABC0000000.p8";
    const report = await runDoctor();
    const live = report.checks.find((c) => c.name === "Live connection");
    expect(live?.status).toBe("warn");
  });

  it("reports free tier when no license key is set", async () => {
    process.env.ASC_PRIVATE_KEY_PATH = "/nonexistent/AuthKey_ABC0000000.p8";
    const report = await runDoctor();
    const lic = report.checks.find((c) => c.name === "License");
    expect(lic?.status).toBe("warn");
    expect(lic?.detail.toLowerCase()).toContain("free");
  });

  /**
   * A finished trial is not a broken key. The old copy sent that person to look
   * up a licence that is working exactly as designed, and hid the two things
   * they need at that moment: the price and the link.
   */
  it("says the trial ended, rather than blaming the key", async () => {
    process.env.ASC_LICENSE_KEY = "ASC-EXPIRED-0000-0000-0000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ valid: false, tier: "free", reason: "trial_expired" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const text = formatDoctor(await runDoctor());
    expect(text).toContain("7-day trial has ended");
    expect(text).toContain("$9/month");
    expect(text).not.toContain("did not validate as Pro");
  });

  /**
   * The trial clock. A live trial validates as Pro, and the line used to say
   * only "all tools unlocked", so the one number a trial user needs was the one
   * thing the product never told them. Six trials expired in 2026 and none
   * converted.
   */
  const proTrial = (expires: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ valid: true, tier: "pro", trial: true, expires }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  it("counts the days left on a trial instead of just saying Pro", async () => {
    process.env.ASC_LICENSE_KEY = "ASC-AAAAA-BBBBB-CCCCC-DDDDD";
    proTrial(inDays(5));
    const report = await runDoctor();
    const lic = report.checks.find((c) => c.name === "License");
    expect(lic?.status).toBe("ok");
    expect(lic?.detail).toContain("5 days left");
  });

  it("warns and names the price in the last two days, while the key still works", async () => {
    process.env.ASC_LICENSE_KEY = "ASC-AAAAA-BBBBB-CCCCC-DDDDD";
    proTrial(inDays(1));
    const report = await runDoctor();
    const lic = report.checks.find((c) => c.name === "License");
    expect(lic?.status).toBe("warn");
    expect(lic?.detail).toContain("1 day left");
    expect(lic?.fix).toContain("$9/month");
    // A trial nearly up is a warning, never a failure: the key is fine, and a
    // fail here would read as "your licence is broken" two days early.
    expect(report.checks.every((c) => c.name !== "License" || c.status !== "fail")).toBe(true);
  });

  it("says a subscription is Pro without inventing a countdown", async () => {
    process.env.ASC_LICENSE_KEY = "ASC-AAAAA-BBBBB-CCCCC-DDDDD";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ valid: true, tier: "pro", expires: inDays(28) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const lic = (await runDoctor()).checks.find((c) => c.name === "License");
    expect(lic?.status).toBe("ok");
    expect(lic?.detail).toBe("Pro: all tools unlocked.");
  });
});

describe("trialDaysLeft", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("rounds a partial day up, because the key does still work", () => {
    expect(trialDaysLeft("2026-09-03T18:00:00.000Z", now)).toBe(1);
  });

  it("floors at zero rather than counting backwards", () => {
    expect(trialDaysLeft("2026-09-01T12:00:00.000Z", now)).toBe(0);
  });

  it("returns null for anything it cannot count, so no line is shown", () => {
    expect(trialDaysLeft(undefined, now)).toBeNull();
    expect(trialDaysLeft("whenever", now)).toBeNull();
  });
});
