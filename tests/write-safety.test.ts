/**
 * Guards on the tools that change a real App Store Connect account.
 *
 * An agent calls these autonomously. Every one of them was found by an audit
 * asking a single question: what happens if the model calls this with the
 * minimum arguments the schema accepts, on a live app? The answers were a
 * permanent version on a shipping app, a staged rollout finished early, a
 * build pushed to every tester, an email to a stranger, and a demo account
 * silently cleared. None of them wrote to the API before the fixes below,
 * because none of them asked first.
 */
import { describe, it, expect } from "vitest";
import { managePhasedRelease } from "../src/tools/release-control.js";
import { assignBuildToGroup, inviteBetaTester } from "../src/tools/testflight.js";
import { setReviewContact } from "../src/tools/submission.js";

/** A client that fails the test if any write reaches it. */
const readOnly = (get: (p: string) => Promise<unknown> = async () => ({ data: [] })) =>
  ({
    get,
    post: async () => {
      throw new Error("wrote to the API without confirmation");
    },
    patch: async () => {
      throw new Error("patched the API without confirmation");
    },
    del: async () => {
      throw new Error("deleted without confirmation");
    },
    getAll: async () => ({ data: [] }),
  }) as never;

describe("manage_phased_release asks before changing a live rollout", () => {
  it.each([
    ["complete", "100% of users"],
    ["start", "staged rollout"],
    ["pause", "pauses"],
    ["resume", "resumes"],
  ])("refuses %s without confirm and explains the effect", async (action, phrase) => {
    const out = await managePhasedRelease(readOnly(), { app_id: "1", action: action as never }, "pro");
    expect(out).toContain(phrase);
    expect(out).toContain("confirm: true");
  });

  // The one that cannot be walked back has to say so.
  it("says completing cannot be undone", async () => {
    const out = await managePhasedRelease(readOnly(), { app_id: "1", action: "complete" }, "pro");
    expect(out).toContain("cannot be undone");
  });
});

describe("TestFlight tools ask before reaching real people", () => {
  it("assign_build_to_group warns that testers are notified and cannot be un-notified", async () => {
    const out = await assignBuildToGroup(readOnly(), { app_id: "1", group_id: "g" }, "pro");
    expect(out).toContain("cannot be recalled");
    expect(out).toContain("confirm: true");
  });

  // Without build_id it picks the newest VALID build, which may be a throwaway.
  it("assign_build_to_group says which build it would pick when none was named", async () => {
    const out = await assignBuildToGroup(readOnly(), { app_id: "1", group_id: "g" }, "pro");
    expect(out).toContain("newest VALID build");
    const named = await assignBuildToGroup(readOnly(), { app_id: "1", group_id: "g", build_id: "b7" }, "pro");
    expect(named).toContain("build b7");
    expect(named).not.toContain("newest VALID build");
  });

  it("invite_beta_tester shows the address before sending", async () => {
    const out = await inviteBetaTester(readOnly(), { group_id: "g", email: "someone@example.com" }, "pro");
    expect(out).toContain("someone@example.com");
    expect(out).toContain("confirm: true");
  });

  // Validation first: prompting a human to approve "not-an-email" wastes the
  // one question this tool gets to ask.
  it("invite_beta_tester rejects a malformed address before asking to confirm", async () => {
    const out = await inviteBetaTester(readOnly(), { group_id: "g", email: "nope" }, "pro");
    expect(out).toContain("not a valid email");
    expect(out).not.toContain("confirm: true");
  });
});

describe("set_review_contact does not clear a demo account it was not told about", () => {
  const capture = () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      get: async () => ({ data: [{ id: "v1", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } }] }),
      post: async (_p: string, body: { data: { attributes: Record<string, unknown> } }) => {
        sent.push(body.data.attributes);
        return { data: { id: "d1" } };
      },
      patch: async (_p: string, body: { data: { attributes: Record<string, unknown> } }) => {
        sent.push(body.data.attributes);
        return { data: { id: "d1" } };
      },
      getAll: async () => ({ data: [] }),
    } as never;
    return { client, sent };
  };

  const base = { app_id: "1", first_name: "A", last_name: "B", phone: "+10000000000", email: "a@b.co" };

  /**
   * The flag used to be computed from "was a demo account passed this time",
   * so updating a phone number sent demoAccountRequired:false and stripped the
   * credentials an app already had. Reviewers then open an app that needs a
   * login and find nothing, which is a plain rejection.
   */
  it("leaves the flag untouched when the caller says nothing about it", async () => {
    const { client, sent } = capture();
    await setReviewContact(client, base, "pro");
    expect(sent.length).toBeGreaterThan(0);
    for (const attrs of sent) expect(attrs).not.toHaveProperty("demoAccountRequired");
  });

  it("sets it true when a demo account is supplied", async () => {
    const { client, sent } = capture();
    await setReviewContact(client, { ...base, demo_account_name: "u", demo_account_password: "p" }, "pro");
    expect(sent.some((a) => a.demoAccountRequired === true)).toBe(true);
  });

  it("clears it only on an explicit instruction", async () => {
    const { client, sent } = capture();
    await setReviewContact(client, { ...base, demo_account_required: false }, "pro");
    expect(sent.some((a) => a.demoAccountRequired === false)).toBe(true);
  });
});
