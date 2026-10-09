Verdict: FAIL

# Legal and platform-policy gate, re-check: free preview of Pro read tools, 9 October 2026

Re-check of the working tree against the first report (B1 to B5 blocking, N1 to N9 non-blocking). Files read as they sit on disk.

Two blocking items remain, both one-line code changes that leave a Pro user's output untouched: a residual on B1, and one new finding (B6) in a previewed tool the first pass did not open far enough. Everything else that was blocking is closed.

Not verified: `git diff` and the test suite (no shell), the deployed worker and site, byte-identity of Pro output against the published 1.9.13 (judged from reading the code paths, not run), and `src/client.ts` (so "a wrong app id throws" for the tools other than list_builds is assumed from the handlers, not confirmed).

## The previewed set, re-derived

src/tool-meta.ts marks 20 tools "read". Minus the five free ones that never call the gate, minus the five in `NOT_PREVIEWED` (src/gate.ts:53-59), leaves exactly ten: list_reviews, sales_report, release_preflight, daily_briefing, release_notes, keyword_insights, competitor_snapshot, metadata_diff, list_builds, list_beta_groups. Every public surface now says ten. No surface says "eleven", and none lists wait_for_build as previewed (RELEASE_NOTES.md:11 and src/instructions.ts:39 name it as excluded).

## Status of the original findings

| ID | Status | Where | Note |
|----|--------|-------|------|
| B1 | OPEN, one path | src/index.ts:247, src/tools/builds.ts:43 | See below. All other paths closed. |
| B2 | CLOSED | src/gate.ts:83 | Writes `{ used }` only. "One number" is true in all four texts (worker :1542, README.md:301, plugin/README.md:75, RELEASE_NOTES.md:15). |
| B3 | CLOSED | license-worker/src/index.ts:1607, :1639 | Ten tools named, "in total per machine", ended trial or subscription excluded, courtesy wording, no self-contradiction. JSON-LD dateModified is 2026-10-09 and matches the visible date at :1594. |
| B4 | CLOSED | site/llms.txt:10 | "10 that only read work 5 times in total per machine with no licence, as a preview; past that, all 35 require Pro or a running trial." |
| B5 | CLOSED | src/doctor.ts:181 | "most of the ones that only read work 5 times in total on this machine". |
| N1 | OPEN, operator | src/index.ts:298 | Unchanged by decision. Still tells the model to ask for an email before a previewed read tool has been refused. See below. |
| N2 | CLOSED | src/instructions.ts:30-45 | Ten tools named, limit stated, exclusions stated, "never describe them as limited" now scoped to the six free tools. |
| N3 | CLOSED | src/gate.ts:112-123 | Count on every preview reply, price and link on the first (left 4) and last (left 0) only. The FIFO is gone (src/gate.ts:98, src/index.ts:236), so a notice can no longer land on another call's reply. |
| N4 | OPEN, operator | Terms :1614 and every "$9/month" | Unchanged by decision. Still a (c) fork: add "plus tax" wording or switch Polar to tax-inclusive. |
| N5 | CLOSED | Terms :1607 | "not part of the paid service, and a later version of the software may change or remove it". |
| N6 | CLOSED, with one acceptance | site/index.html:429, :383 | Pricing item names the ten categories and says "in total". guide.ts:54 and USER_GUIDE.md:38 reverted to 1.9.13: accepted, see below. README table footnote was optional and is not added. |
| N7 | CLOSED except version | site/index.html:635, :637, site/llms.txt:51 | Both JSON-LD sentences and the llms.txt answer carry the ten-tool sentence. `softwareVersion` 1.9.13 (site/index.html:635) and site/llms.txt:7, :64 still to move with the release. |
| N8 | CLOSED | skills/asc-review-triage/SKILL.md:48, plugin/skills/asc-review-triage/SKILL.md:48 | Both copies identical and accurate. |
| N9 | CLOSED | site/llms.txt:15 | Scoped to "the asc-mcp licence server in normal use". |

## Blocking

### B1 residual. list_builds with a wrong app id is counted. src/tools/builds.ts:43 against RELEASE_NOTES.md:11.

RELEASE_NOTES.md:11: "A call that ends in an error is not counted; one that runs and has nothing to show is."

The refund test at src/index.ts:247 is `/^(Error\b|Invalid vendor number|Could not fetch )/`. Checked against every return in the ten handlers:

- Refunded, correctly: any throw (src/index.ts:255); sales_report "Error fetching sales report" (sales-report.ts:74) and "Invalid vendor number" (:69); metadata_diff "Could not fetch localizations" (metadata-diff.ts:144, :151); release_notes four "Error: ..." replies (release-notes.ts:71, :76, :83, :105).
- Not counted at all: sales_report with no vendor_number, now above the gate (sales-report.ts:40-48).
- Counted, and honestly described as "has nothing to show": sales_report "No sales report available for <date>" on a 404 (:72), the "No report" passthrough (:77) and "Report returned no data rows." (:84); list_reviews "No customer reviews found" (list-reviews.ts:92); list_builds "No builds found for this app" (builds.ts:42); list_beta_groups "No beta groups" (testflight.ts:29); competitor_snapshot "No app found" and "No apps found" (competitor-snapshot.ts:123, :129); keyword_insights "No versions found" and "No keywords found" (keyword-insights.ts:86, :126); metadata_diff "Only one version found", "No versions found", "Could not find two distinct versions" (metadata-diff.ts:98, :104, :129, the last starts "Could not find", not "Could not fetch ", so it is counted, which is right); release_preflight "No versions found" (release-preflight.ts:95); daily_briefing "No apps found" (daily-briefing.ts:68). The 404 sales path is the one worth a second look: the default date is yesterday and reports take one to two days, so a first sales call often lands there and spends a call. The sentence discloses exactly that, so it stands.
- Counted, and it is an error: src/tools/builds.ts:43, "No app with id <id> in this account. Run list_apps to get the right app_id." The handler itself has just established that the argument was wrong. It matches none of the three prefixes, so the call is spent and the reply carries the preview footer. src/gate.ts:103-104 also says "a typo in an app id does not spend someone's preview".

Fix, one alternation, Pro output unchanged. src/index.ts:247:

`const failed = /^(Error\b|Invalid vendor number|Could not fetch |No app with id )/.test(body);`

### B6 (new). The previewed daily briefing is not the Pro briefing: it drops reviews and prints an upgrade line. src/tools/daily-briefing.ts:133, :179-181.

The gate lets a preview call through with `tier` still "free". daily-briefing.ts:133 then branches on `tier === "pro"`, and for a preview call takes the else at :180, once per app:

`- Reviews: upgrade to Pro to see review details in briefings`

Before this change that branch was unreachable, because a free call never got past the gate. It is now what every preview briefing returns. Against that:

- RELEASE_NOTES.md:9: "The Pro tools that only read now work five times in total ... the daily briefing".
- site/index.html:383: "also work five times in total with no licence, so you can see them on your own app first".
- The tool's own description (src/index.ts, daily_briefing): "version status, recent reviews, rejections, action items".

So one of the five calls is spent on a cut-down reply with an in-body upsell, which is also the thing the N3 trim removed from the footer. `/asc-weekly-review` (src/prompts.ts:81) starts with this call. It is the only previewed handler that branches on tier after the gate; the other two `tier !== "pro"` checks are in triage_reviews and draft_review_response, which are not previewed.

Fix, Pro output byte-identical because the Pro branch is the one kept. In src/tools/daily-briefing.ts: delete the condition at :133 (`if (tier === "pro") {`) so the try block at :134-178 always runs, delete the else at :179-181, and drop the stale comment at :132. Reaching that line already means the gate passed.

## Non-blocking, still open

### N1. src/index.ts:298, asc_start_trial description. Operator decision, unchanged.

Still says to call it "when they ask for something only a Pro tool can do (... preflight, briefings, keyword or review intelligence) before you hit the refusal". For the first five calls those are not refused. It conflicts with FREE_TIER_INSTRUCTIONS ("just call it") and with "no licence and no email". The instructions string is the stronger signal and is now right, so the practical effect is small, but the description is the text a directory reviewer reads against rule 2B. The earlier replacement wording stands if the operator wants it. Note that this description is shown to Pro users too, so it falls under the byte-identity rule for descriptions if that rule extends past replies.

### N4. Tax wording. Operator decision, unchanged. Terms :1614 remains the place it matters most.

### guide.ts:54 and USER_GUIDE.md:38, reverted to 1.9.13. Accepted.

"the write, control and intelligence tools need Pro" omits the preview. Judged not false: past five calls it is exactly true, and leaving out a benefit harms nobody. The cost is conversion, not compliance: a free-tier model that reads the guide may reach for the trial before using the preview. The instructions string covers that.

### New, minor

- "Ten of the other 35 only read" (license-worker/src/index.ts:1607, src/instructions.ts:32). Fifteen of the 35 carry the read-only annotation. The sentence names its ten, so nobody is misled about what is previewed, but as a count it is loose. Optional: "Ten of the other 35, all of which only read, share a preview of 5 calls in total per machine ...".
- src/tools/sales-report.ts:40-48. With the vendor-number check above the gate, someone whose preview is used up or whose trial has ended is first told to go and find the vendor number and "call sales_report again", and is then refused. No claim is false. Accepted as the cost of keeping Pro output identical.
- Two processes writing preview.json at once can both read the same count, so the allowance can run slightly over five. It errs in the user's favour; no claim affected.
- src/prompts.ts `/asc-weekly-review` still does not warn that it can spend the whole preview in one command. Optional.
- site/index.html:247 demo shows the first sentence of the License line only. States nothing false.

## Action items, in order

1. B6: src/tools/daily-briefing.ts:133 and :179-181, remove the tier branch so a preview briefing includes reviews.
2. B1: src/index.ts:247, add `No app with id ` to the refund pattern.
3. Move `softwareVersion` (site/index.html:635) and site/llms.txt:7, :64 to 1.9.14 with the release.
4. N1 and N4 stay with the operator.

## Addendum by the implementing session, after the re-check (not audited a third time)

Both open blocking items were fixed as the re-check prescribed:

- B6: `src/tools/daily-briefing.ts` no longer branches on tier after the gate; the reviews block
  always runs and the upgrade line is gone. `tests/preview.test.ts` asserts a previewed briefing is
  word for word a subscriber's.
- B1 residual: the refund test in `src/index.ts` also matches `No app with id `.

Pro output was compared byte for byte against the published 1.9.13 after these edits
(instructions, 41 tool definitions, seven tool replies): identical. 304 client and 94 worker
tests pass. N1 (the `asc_start_trial` description) and N4 (tax wording) stay with the operator.
