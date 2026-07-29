import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runDoctor, formatDoctor } from "../src/doctor.js";

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
});
