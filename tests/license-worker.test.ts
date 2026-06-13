import { describe, it, expect } from "vitest";
import {
  computeActiveFlag,
  classifyPolarEvent,
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

  it("treats canceled/revoked as cancellation events", () => {
    expect(classifyPolarEvent("subscription.canceled")).toBe("cancel");
    expect(classifyPolarEvent("subscription.revoked")).toBe("cancel");
  });

  it("ignores unrelated events", () => {
    expect(classifyPolarEvent("order.created")).toBe("ignore");
    expect(classifyPolarEvent("checkout.created")).toBe("ignore");
  });
});
