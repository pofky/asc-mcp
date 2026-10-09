# Bug Fix: Automated trial mails carry no opt-out, no sender identity, and one false promise [COMPLIANCE-CRITICAL]

Source: `.autopilot/queues/compliance-findings.md` C-1 (periodic scan, 2026-09-25).
Type B (mini-PRD). Touches outbound email to real people, so the legal gate must re-run on the diff before deploy.

## Symptom
- The policy (`license-worker/src/index.ts:1526`) says every product email names us, says why the reader is getting it, and has a free opt-out, and that after an objection we will not email about the product again.
- The two cron mails (`license-worker/src/logic.ts:854-904` and `logic.ts:911-942`) have none of these.
- The "ends tomorrow" mail says "you will not hear from us again about it" (`logic.ts:874`, `logic.ts:896-897`). The "has ended" mail follows about 2 days later.
- A "stop" reply changes nothing in code.
- `/admin/announce` (`index.ts:1160-1215`) sends operator-written HTML with no footer.
- The policy's Email delivery paragraph (`index.ts:1507`) does not list the reminder mails.

## Root Cause
The reminders were built on 3 Sep. The legal-basis sentence was added on 22 Sep, and it described the manual letters in `Marketing/` (which do have footers). It was never checked against the automated senders.

## Fix Approach
1. Migration `0004-marketing-opt-out.sql`: `ALTER TABLE licenses ADD COLUMN marketing_opt_out_at TEXT;`. Mirror it in `schema.sql`.
2. `logic.ts`: add a pure `marketingFooter(email, unsubscribeUrl)` returning HTML and text. The text is: "Povilas Konopackas, sole trader, <address or Lithuania until M-3 lands>. povkonop@gmail.com. You are getting this because you started a free trial of asc-mcp. Unsubscribe: <link>, or reply stop." Append it in `trialEndingEmailContent` and `trialLapsedEmailContent`.
3. Replace the false line in `logic.ts:874` and `logic.ts:896-897` with: "Not for you? Nothing to cancel. One short note goes out the day after it ends, then nothing more about the trial." Keep the unsubscribe link in the footer.
4. Add signed unsubscribe links, reusing the HMAC in `signDeleteToken` and `verifyDeleteToken` with a separate purpose prefix and no expiry, or a long one.
   - `GET /unsubscribe` shows a confirm button.
   - `POST /unsubscribe` sets `marketing_opt_out_at = datetime('now')` on every row where `lower(email) = ?`.
   - The POST path satisfies RFC 8058 one-click unsubscribe.
5. `sendTransactional`: accept optional `headers` and pass `List-Unsubscribe: <https://...>, <mailto:povkonop@gmail.com?subject=stop>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` through the Brevo `headers` field.
6. Cron query (`index.ts:204-219`): add `AND NOT EXISTS (SELECT 1 FROM licenses o WHERE lower(o.email) = lower(t.email) AND o.marketing_opt_out_at IS NOT NULL)`.
7. `/admin/announce`: refuse opted-out addresses and append the footer on the server side.
8. Policy (`index.ts:1507`): list "trial key, a reminder the day before a trial ends and a note the day after". Keep the `index.ts:1526` wording, which becomes true, and add the unsubscribe link as a route. Bump the policy date and the JSON-LD `dateModified`.
9. The Terms need no change.

## Affected Files
- `license-worker/src/logic.ts`
- `license-worker/src/index.ts`
- `license-worker/schema.sql`
- `license-worker/migrations/0004-marketing-opt-out.sql` (new)
- `license-worker/tests/logic.test.ts`
- a new `license-worker/tests/unsubscribe.test.ts`

## Test Plan
- Pure tests:
  - Both reminder bodies, HTML and text, contain the trader name, the reason line and an unsubscribe URL.
  - Neither contains "will not hear from us again".
- Constructed-fixture test: a trial row due an "ending" mail plus an opted-out row for the same address with different case is not selected. With the opt-out removed, it is selected. This follows the lesson in memory `asc-mcp-new-feature-fixtures`: build the state production has never held.
- Local D1: the unsubscribe token round-trips, a tampered token is refused, and the POST sets the column on every case variant of the address.
- `/admin/announce` returns a refusal for an opted-out address.
- `tsc --noEmit` is clean and all existing worker tests pass.

## Risks
- A one-click unsubscribe link with no expiry is a capability URL. It only suppresses marketing, which is harmless if leaked. Never let it delete or revoke anything.
- Deliverability: `List-Unsubscribe` usually helps with Gmail and Yahoo bulk-sender rules.
- Migration ordering: select the new column defensively, as `/validate` does, or apply the migration before deploy (production-safety skill).

## Verification
- Run the cron against a synthetic row pointed at the operator's inbox with `wrangler dev --remote --test-scheduled` (HANDOFF Environment). Confirm the footer is present, the unsubscribe link works, and a second run after unsubscribing sends nothing.
- The legal-compliance auditor re-runs on the diff.
- Deploy is an operator command file, because deploys are refused in agent sessions (memory `asc-mcp-sandbox-blocks-prod-writes`).

## Stopgap (if not shipped before the next 15:00 UTC run)
Remove `[triggers] crons` from `license-worker/wrangler.toml` and deploy, which pauses the reminders. The `atilihsan38@gmail.com` trial (expires 26 Sep) is due its "ending" mail today and its "lapsed" mail on 27 Sep.

---

## Amendment 2026-10-09 (periodic compliance scan, findings N-1 and N-3)

Status: still open. The code is unchanged at `logic.ts:874, 896-897`. Nothing in `license-worker/` mentions unsubscribe or opt-out. The cron is still in `wrangler.toml:9-10`. The stopgap was not applied.

New facts that change how this ships:

1. **Production is behind the repo.** The live worker 404s on `/b`, and its `/privacy` is dated September 7, 2026. That live policy has no lawful-basis bullet for these mails at all. It gives only Art 6(1)(b) for the trial email, and it has no Art 21(2) objection notice. So today production sends these mails with no stated basis, no stated purpose and no opt-out.
2. **The pending worker deploy must not go out alone.** `HANDOFF.md:331-334` (item 1, `deploy-license-worker.txt`) would publish `index.ts:1526`, which is false until this PRD lands. Add the following to Scope:
   - Ship this fix in the same deploy as the 22 September worker changes (`/b`, the `/go` classifier, the new policy).
   - If the deploy has to go first, edit `index.ts:1526` in that deploy to describe the mails as they are, and handle stop replies by hand.
3. **Fix the in-agent collection notice in the same release.** Add `src/index.ts:236` and `src/index.ts:309` to Affected Files. Today they say the trial stores the email and hash and "Nothing else", and they give the email's only purpose as key delivery. Replace them with the wording in compliance-findings N-3, which lists the reminder mails and the "reply stop" opt-out. This needs an npm release, so follow memory `asc-mcp-npm-publish-lag` and `asc-mcp-npm-staged-publish`.
4. Add to Verification: after deploy, `curl -sI https://asc-mcp-license.remewdy.workers.dev/b?p=/` returns 204, `/privacy` shows the new date, and the `/privacy` text at the policy's legal-basis bullet matches what the mails now contain.
