import { describe, it, expect } from "vitest";
import { formatReviews } from "../src/tools/list-reviews.js";
import { formatDraftForAgent } from "../src/tools/draft-review-response.js";

/**
 * The documented reviews flow is "show me the bad reviews" then "reply to that
 * one". It dead-ended twice, and both ends are covered here.
 */
describe("list_reviews output", () => {
  it("prints the review id draft_review_response asks for", () => {
    const out = formatReviews([
      {
        id: "00000194-2578-4e03-5024-fc0b00000000",
        attributes: {
          rating: 2,
          title: "Crashes",
          body: "Crashes on launch",
          reviewerNickname: "Sam",
          territory: "USA",
          createdDate: "2026-08-01T10:00:00Z",
        },
      },
    ]);
    expect(out).toContain("00000194-2578-4e03-5024-fc0b00000000");
    expect(out).toContain("draft_review_response");
  });
});

describe("draft_review_response without client sampling", () => {
  it("hands the calling model the review and the rules, rather than giving up", () => {
    const out = formatDraftForAgent({
      app_id: "1",
      review_id: "r1",
      locale: "en",
      tone_used: "factual",
      draft: "",
      warning: "Draft only.",
      degraded: true,
      note: "This client does not support Sampling",
      review: {
        rating: 2,
        title: "Crashes",
        body: "Crashes on launch",
        reviewer: "Sam",
        territory: "USA",
      },
      drafting_brief: "Rules: stay factual",
    });
    expect(out).toContain("Crashes on launch");
    expect(out).toContain("Rules: stay factual");
    expect(out).not.toBe("This client does not support Sampling");
  });

  it("still says only the note when there is nothing to hand over", () => {
    const out = formatDraftForAgent({
      app_id: "1",
      review_id: "r1",
      locale: "en",
      tone_used: "factual",
      draft: "",
      warning: "Draft only.",
      degraded: true,
      note: "Sampling failed: timeout",
    });
    expect(out).toBe("Sampling failed: timeout");
  });
});
