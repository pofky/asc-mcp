import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runDoctor, formatDoctor } from "../src/doctor.js";
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

});
