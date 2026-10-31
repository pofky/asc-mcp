import { BASE_INSTRUCTIONS, instructionsFor } from "../src/instructions.js";
/**
 * The server instructions, which are the only thing every client hands the
 * model on every conversation.
 *
 * They matter more than any single tool description: a free user who never asks
 * for something locked never sees a paywall message, never sees a tool
 * description for a tool that is not registered as usable, and until 1.9.9 was
 * told nothing at all about the other 35 tools. Roughly one install in forty
 * started a trial. These tests lock both halves of the fix: the free tier says
 * what is locked and what unlocks it, and Pro never carries a word of it.
 */
import { describe, it, expect } from "vitest";
import { BASE_INSTRUCTIONS, FREE_TIER_INSTRUCTIONS } from "../src/instructions.js";

const FREE = BASE_INSTRUCTIONS + FREE_TIER_INSTRUCTIONS;

describe("server instructions", () => {
  it("tells a free user the trial exists, and that it needs no card", () => {
    expect(FREE).toContain("asc_start_trial");
    expect(FREE).toContain("7 days");
    expect(FREE).toContain("no credit card");
  });

  it("names the free tools, so the model does not apologise for ones that work", () => {
    for (const tool of [
      "asc_setup_check",
      "asc_guide",
      "asc_start_trial",
      "list_apps",
      "app_details",
      "review_status",
    ]) {
      expect(FREE).toContain(tool);
    }
    expect(FREE).toContain("The six free tools are complete");
  });

  it("says the trial takes effect without a restart, which is the whole offer", () => {
    expect(FREE.toLowerCase()).toContain("running session");
  });

  it("tells the model to offer once and stop", () => {
    expect(FREE).toContain("once per conversation");
    expect(FREE).toContain("never invent one");
  });

  it("says nothing about tiers, trials or prices to a Pro user", () => {
    for (const word of ["trial", "locked", "free", "credit card", "$9"]) {
      expect(BASE_INSTRUCTIONS.toLowerCase()).not.toContain(word);
    }
  });

  it("keeps the sampling and no-auto-post promises in both tiers", () => {
    for (const text of [BASE_INSTRUCTIONS, FREE]) {
      expect(text).toContain("Sampling");
      expect(text).toContain("never");
      expect(text).toContain("draft only");
    }
  });
});

describe("instructionsFor never pitches what the server will refuse", () => {
  it.each(["trial_expired", "revoked", "canceled", "inactive"])("%s: no trial, no preview", (reason) => {
    const out = instructionsFor("free", reason, false);
    expect(out).toContain("no free trial or preview is available");
    expect(out).not.toContain("7 days");
  });
  it("a key with no answer: no price, no trial", () => {
    const out = instructionsFor("free", undefined, true);
    expect(out).toContain("says nothing about the key");
    expect(out).not.toContain("7 days");
  });
  it("a new user still gets the free tier text", () => {
    expect(instructionsFor("free", undefined, false)).toContain("7 days");
  });
  it("Pro is unchanged", () => {
    expect(instructionsFor("pro", undefined, false)).toBe(BASE_INSTRUCTIONS);
  });
});
