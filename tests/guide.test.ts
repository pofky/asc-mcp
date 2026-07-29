import { describe, it, expect } from "vitest";
import { ascGuide, FLOWS, LIMITATIONS } from "../src/tools/guide.js";

describe("asc_guide", () => {
  it("is free: never returns a Pro gate message", async () => {
    const out = await ascGuide({ topic: "first-app" });
    expect(out).not.toContain("Pro license");
  });

  it("overview lists every topic", async () => {
    const out = await ascGuide({});
    for (const t of ["setup", "first-app", "update", "iap", "subscriptions", "binary", "limitations"]) {
      expect(out).toContain(t);
    }
  });

  it("first-app flags the manual first-IAP and app-record constraints", async () => {
    const out = await ascGuide({ topic: "first-app" });
    expect(out).toContain("MANUAL");
    expect(out.toLowerCase()).toContain("app record");
    expect(out.toLowerCase()).toContain("first in-app");
  });

  it("every flow declares at least one manual interruption", () => {
    for (const [name, flow] of Object.entries(FLOWS)) {
      expect(flow.manual.length, `${name} should list manual steps`).toBeGreaterThan(0);
    }
  });

  it("limitations cover the known API gaps", async () => {
    const out = await ascGuide({ topic: "limitations" });
    expect(out).toContain("nutrition label");
    expect(out).toContain("trader status");
    expect(LIMITATIONS.length).toBeGreaterThanOrEqual(8);
  });

  it("unknown topic falls back to overview", async () => {
    const out = await ascGuide({ topic: "nope" as never });
    expect(out).toContain("Topics:");
  });
});
