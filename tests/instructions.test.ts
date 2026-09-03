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
    expect(FREE).toContain("the free ones are complete");
  });

  it("says the trial takes effect without a restart, which is the whole offer", () => {
    expect(FREE.toLowerCase()).toContain("running session");
  });

  it("tells the model to offer once and stop", () => {
    expect(FREE).toContain("Offer once per conversation");
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
