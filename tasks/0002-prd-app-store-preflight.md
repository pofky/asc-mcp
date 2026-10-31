---
goal: "release_preflight reports what it could not check, loads every URL it names, and scans the local project, so a clean report can be trusted."
priority: high
cost_category: low
---

# PRD-0002: App Store Preflight v2

**Status:** Draft, ready for architect review
**Owner:** the asc-mcp team (next session in this repo)
**Type:** C (Feature / Refactor)
**Created:** 2026-10-31
**Shipped:** not shipped
**Related:** `src/tools/release-preflight.ts`, `launch/competitors.md`. Source research, in the private Ideas repo: `/Volumes/T7/Projects/Ideas/research/2026-10-29_agent_harness_ideas/` (`00_VERDICT.md`, idea #2).

This repo is public. Keep customer names, addresses and D1 row ids out of this file and out of anything derived from it.

---

## 0. Read this first

**Where the idea came from.** On 2026-10-29 we analysed the Startup Ideas Podcast episode with Jon Noronha of Gamma ("Stop building AI wrappers. Start building agent harnesses."). Five personas wrote 50 ideas, 118 buyer phrases went through a demand gate, and a top 20 was scored out of 30. The pattern that won: sell a finished result whose correctness plain code can prove. "App Store Preflight in asc-mcp" ranked second at 25/30 and was called the cheapest test, because this channel has already converted a trial to paid.

**What the research got wrong.** It was written without reading this repo. Checking the code and live sources on 2026-10-31 changed the brief:

| The research said | What is true | Effect on this PRD |
|---|---|---|
| Add a preflight add-on to Pro | `release_preflight` has shipped for months, is a Pro read tool, and is in the five-call preview | This is an upgrade of an existing tool, not a new product |
| The report can check nutrition labels against the SDKs | Apple's public API has no `appDataUsages` (probed live 2026-06-26, `src/tools/privacy.ts:12`; nothing in API release notes 4.0 to 4.5.1 mentions it) | Impossible. We generate a checklist from the manifests instead |
| "Reads the live record" covers required-reason APIs | Those live in the project and binary, not in App Store Connect | Needs a local project scan, a new input |
| "40-ish GitHub stars" as a first audience | 1 star on 2026-10-31 (`gh repo view`) | That audience does not exist |
| Competitor gap scored 3 of 5 | `truongduy2611/app-store-preflight-skills` has 1,405 stars, free, Guidelines synced to the 16 Oct 2026 revision | Gap is closer to 2, total about 24. See §1 for what is still ours |
| Sell at $15 per submission, or raise Pro to $12 | $9/month with cancel any time undercuts $15, and the 7-day trial covers a single submission for free | Both dropped. See §4 decision 1 |
| "Email the existing trial list" | Reminder mail has an opt-out history and the operator ruled out one mail to customers on 18 Oct | Not a launch step without the legal gate. See §9 |

**The honest case for doing this.** Our preflight tool can say "PASS: Ready to submit" when several of its checks silently failed to run. We are selling a promise we do not keep, and fixing that is justified with or without a revenue lift. Everything beyond the fix is a bounded bet with a kill rule (§2).

## 1. Problem

**Who.** Solo and two-person iOS and macOS developers who run a coding agent and ship their own apps, in the hours before pressing Submit or just after a rejection. A rejection costs them a review cycle.

**What they cannot do today.** Trust the tool's clean result. Checked in `src/tools/release-preflight.ts` at `3dbe4ea`:

| # | Where | Defect | Consequence |
|---|---|---|---|
| D1 | `:352`, `:373`, `:401`, `:420`, `:428`, `:437`, `:451`, `:474` | `catch` blocks discard the failure, so the check leaves no trace | Apple outage or a low-role key: the age rating, privacy URL, product, category, price and contact checks vanish, and `:505-506` can still print "PASS: Ready to submit" |
| D2 | `:506`, `:546` | The wording "Ready to submit" | Reads as a promise of approval, which the research's legal note forbids |
| D3 | `:99-104` against `:410` | "Pending" omits `REJECTED`, `METADATA_REJECTED`, `INVALID_BINARY`, though the later list includes the first two | At the moment of highest need, the developer can be told there is no pending version |
| D4 | `:86`, `:108` | Five versions, first match wins, platform ignored | An app with iOS and macOS versions can be audited on the wrong one |
| D5 | `:44-47`, `:274-281` | Warns about each of `APP_IPHONE_67` and `APP_IPHONE_65`; never checks iPad; judges macOS, tvOS and visionOS by iPhone rules | Apple now wants one iPhone set and a 13-inch iPad set if the app runs on iPad, so a true blocker is missed and a false warning is raised |
| D6 | `:240`, `:242`, `:254`, `:258` | Set types pooled across locales, only 5 locales read, an empty set counts as a set, per-locale failures discarded | A set with no images, or a failed upload, passes |
| D7 | `:222`, `:366` | URLs checked for presence only. The privacy URL is a warning, and any one locale satisfies it | A 404 support URL passes. Guideline 5.1.1(i) says all apps must link a privacy policy |
| D8 | `:194` | "First release" is `versionString` equal to `1.0` or `1.0.0` | A first release numbered `0.9` or `2.0` gets a false FAIL for empty What's New |
| D9 | `:133`, `:381`, `:385` | Fixed limits (30 locales, 100 products, 25 groups) with no paging | Larger apps are silently truncated. `client.getAll` already exists (`src/client.ts:87`) |
| D10 | `:393` | `DEVELOPER_ACTION_NEEDED` counts as ready and is reported as a pass | A product Apple has sent back passes |
| D11 | `:458-466` | Any URL containing `terms` or `eula` passes, the URL is not loaded, and a custom EULA in App Store Connect is ignored. The message says Guideline 3.1.2 "auto-rejects", and the comment calls it the most common rejection | False fail with a custom EULA, false pass on a dead link. Neither claim appears in the Guideline text; 3.1.2(c) defers to Schedule 2 of the licence agreement |
| D12 | `:337`, `:358`, `:412`; `:379`, `:442`; `:293`, `:472` | App info fetched three times, products and build twice each | Wasted calls against Apple's rate limit, and a 550-line file doing everything |
| D13 | `README.md:19`, `README.md:124` | "Catches the issues that cause 40% of rejections" | `WORKLOG.md:794` already calls this claim unsupportable and removed it from launch drafts. It is still public on GitHub and npm |

**Current workaround.** Run a free skill or read the Guidelines, then re-read the record by hand in the website.

**Why now.** The tool is the "preflight, then submit" step on our site and in `/asc-rejection-audit`, `/asc-release-go-no-go`, `/asc-ship-release` and `/asc-first-app`. Free rivals are moving fast. Apple also added a dated rule: from April 2027, apps on the iOS 27.1 SDK or later need iPhone Duo screenshots, and API 4.5.1 added the Duo target.

**Competition, re-read 2026-10-31.** Star counts and descriptions are from GitHub; none of these were run by hand.

| Who | Scope | Price | Stars |
|---|---|---|---|
| `truongduy2611/app-store-preflight-skills` | Agent skill: scans the project and pulled metadata against rule files, Guidelines checklists by app type | Free | 1,405 |
| Heimdall, `erayendes/app-store-connect-mcp` | 902-tool MCP server with a "submission readiness" macro | Free, MIT | 54 |
| `zelentsov-dev/asc-mcp` | 502-tool MCP server | Free, MIT | 82 |
| `ilan-uzan/app-store-preflight` | Claude Code skill, says 1,772 checks quoted from Apple | Free | 3 |
| `menansali/ios-ship-doctor` | MCP server: privacy manifests, purpose strings, SDK manifests, placeholder credentials, with fixes | Free, MIT | 2 |
| Appflight | IPA or repo audit, no subscription (from a vendor page, 29 Oct) | Unread | n/a |

**So what is still ours.** Less than the research assumed. Static project scanning is free and table stakes; we add it only so that the one report is complete. Rule count is a losing axis. Reading the record is contested too: the 1,405-star skill reads pulled metadata through the `asc` CLI, and Heimdall has a readiness macro. Fixing is contested for project files: `ios-ship-doctor` and `ilan-uzan/app-store-preflight` both say they fix what they find.

Three things are the bet: (1) a report that **states what it could not check**, (2) **live URL loads plus the rules Apple's API refuses**, the record `launch/competitors.md` already names as our moat, and (3) **fixes to the App Store Connect record** through our confirm-gated write tools in the same conversation, with a re-run to confirm. None of the READMEs we read claims these, but no rival was run, so test each one before making any public comparison. If a rival already does all three, the kill rule should be applied early.

## 1a. Assumptions

| # | Assumption | How we would know it is false | Check order |
|---|---|---|---|
| 1 | Developers will pay for trustworthy preflight rather than use a free skill | §2 kill rule reads zero after 60 days. Today's evidence is thin: 2 of 22 trial starts came from this tool and no attributed buy click, n=1 trial-to-paid overall | Measured last, biggest risk |
| 2 | Apple's API still has no data-usage resource | Re-probe `/v1/appDataUsages` with a real key. If it answers, build the real comparison instead of the checklist | 1 |
| 3 | The required iPhone screenshot rule is what the release notes state | Apple's spec page says "iPhone with Dynamic Island (medium display)" in its summary, yet its table and the release notes describe the large or 6.5-inch set. Upload to a draft version with one set per candidate and read what App Store Connect blocks | 2 |
| 4 | Screenshot `assetDeliveryState` and set contents read reliably | Read the state on real assets with a real key | 3 |
| 5 | A `GET` on `appPriceSchedule` with data means a base price is set (`:422-426`) | Read it on a fresh app with no price | 4 |
| 6 | HEAD or GET from the user's machine tells us a URL is live | Sites that block non-browser agents give false fails. Mitigated by reporting them as `unknown`, not `fail` | 5 |
| 7 | Scanning symbols in a built `.app` finds required-reason use in static SDKs | Compare a scan to an upload with a known ITMS-91053 email | 6 |
| 8 | No client trips on a longer report | Drive it in Claude Code and Claude Desktop with a 30-locale app | 7 |

## 2. Goals & Success Criteria

**Primary goal.** A clean report is honest: every rule ended in pass, warn, fail or `unknown`, and any `unknown` blocks the words "no blocking issues found".

**Secondary goals.** Catch rejection causes the current tool misses (dead URLs, empty screenshot sets, missing iPad sets, manifest gaps). Make the fix-and-recheck loop the visible experience. Earn search traffic on the error strings people already type.

**Non-goals.** Judging subjective Guidelines (4.0 design, 4.2 minimum functionality); a new tool or a raised tool count; a hosted service or anything that sends source code off the machine; launching the build or logging in as the reviewer (a later PRD); guidance on legal, regulated or health claims; Android; Keyword Field Pack and release-notes generation, which are separate ideas in the research.

**Success criteria.**

- Engineering: all acceptance criteria in §8, and every rule in the table has a source URL and verified date.
- Revenue read, from `intent_events`, no new telemetry (the product collects none from the server process, by design). Baseline on 2026-10-31: `trial_started` with `tool=release_preflight` = 2 of 22 all-time; `checkout_click` with `tool=release_preflight` = 0.
- Kill rule, 60 days after release: fewer than 5 new `trial_started` for this tool **and** no paid conversion traceable to it means stop adding rules and keep the honesty fix. These thresholds are judgement at very low volume, not statistics. Mail-scanner rows are noise (see the `/go` item in the bug queue).

## 3. User Flow

No `FLOWS.md` exists yet. Create it from `/Volumes/T7/Projects/autopilot/templates/FLOWS.md` in this change, with **F1 Preflight loop** and **F2 Preflight as first look**. F1 is conversion and retention (the reason to hold Pro in a release week). F2 is activation (the free preview shows the product on the user's own app).

The interface is the agent conversation; the "labels" are the report's exact text.

### Happy path (F1)

1. The user asks "run a preflight before I submit". The agent calls `release_preflight` with `app_id`, and with `project_path` if it knows one.
2. The tool audits the version it selected and says which: `Auditing v2.3 (iOS), state PREPARE_FOR_SUBMISSION`.
3. The report opens with one verdict line:
   - `BLOCKED: 2 failures, 1 could not be checked`
   - `NOT CONFIRMED: no failures, 1 could not be checked`
   - `NO BLOCKING ISSUES FOUND: 34 rules checked. This is not a prediction of App Review's decision.`
4. Each finding is one block: rule id, what was seen, source, and the fix.

   ```
   FAIL  url.support.live  [en-US]
   Saw:  https://example.com/help returned 404 (checked 2026-11-03 14:02 UTC)
   Rule: Guideline 2.1(a), fully functional URLs (verified 2026-10-31)
   Fix:  update_version_metadata support_url
   ```
5. The agent offers the fixes, applies them through the existing confirm-gated write tools, and re-runs.
6. The re-run is identical in shape. It ends with the manual steps Apple keeps on its website, each with a deep link.
7. The closing line carries the date, build number and rule-set version, so it can be pasted into a Resolution Center reply: `Checked 2026-11-03 14:06 UTC, v2.3 build 40, rules 2026-10-31.`

### Alternative paths

- **No `project_path`.** Record and URL rules run. Project rules appear once as `SKIPPED  project.*  Pass project_path to check privacy manifests and purpose strings.`, which does not block the verdict but is shown beside it.
- **Project on a non-Mac, or no built app.** Source and plist rules run; binary rules are `SKIPPED` with the reason.
- **Rejected version.** It is selected, and the report points to `review_status` for Apple's message.
- **Several platforms.** Audit the editable version per platform, one section each.
- **Free user (F2).** It costs one preview call however long the report is. The existing footer applies. Re-runs in the loop spend calls, which is the honest moment for the price and is left as is.
- **Nothing pending.** Audit the latest version, saying so first: `No version is being prepared. This audits the live v2.2; create_version starts the next one.`

### Error states

- **A check cannot run.** `UNKNOWN  iap.state  Apple returned 403. Your key's role may be too low (App Manager or higher).` Never silent.
- **All of Apple is down.** Say so and give no verdict. Start the reply with `Error`, because that prefix is what makes the `safe` wrapper (`src/index.ts:232`) return the preview call.
- **URL blocks us (401, 403, 429, timeout).** `UNKNOWN`, with `Open it in a browser and confirm.`
- **Bad `project_path`.** `SKIPPED  project.*  Path not found: <path>`, and the rest of the audit continues.
- **Stale rules.** Over 90 days past the verified date: `Rule set verified 2026-10-31, over 90 days ago. Update asc-mcp.` This window is a judgement; name it as a constant with that comment.

### Loading

MCP tool calls have no progress screen. Bound the time: URL probes capped at 8 seconds each and 16 at once, whole run target under 30 seconds on a 10-locale app. Measure it, then set the constants.

### Empty

No localizations, no builds and no products each produce a rule result with the next step. An app with no products shows no product rules rather than a zero-count line.

### Success

The verdict line above, then manual steps. Never "ready", "safe to submit", "will pass" or "approved".

## 4. Technical Approach

### Decisions

1. **Price: stays inside $9 Pro, with no new SKU.** $15 per submission loses to one month at $9, and a pass needs licence-server work. A raise to $12 breaks the operator's standing condition that subscribers notice nothing. Revisit only if the kill rule reads strongly positive.
2. **Extend `release_preflight`; add no tool.** The tool count is written into the package, site, llms.txt and registry, and is a losing axis anyway. It stays `read` in `src/tool-meta.ts`, and previewable. A 9 October audit suggested making this tool free (`HANDOFF.md:199-202`); the operator answered that with the five-call preview in 1.9.14, so it stays Pro. Do not reopen that here.
3. **Rules are data.** One table, each entry with `id`, `severity`, `source_url`, `verified`, and the fix tool. Per the no-hardcoding rule, every limit and Apple list lives there with its source, and the report prints its version. Alternative rejected: keeping literals inside checks, which is how D5 went stale.
4. **Four statuses.** `pass | warn | fail | unknown`, plus `skipped` for an input not provided. Every check's failure path returns `unknown`. There is no bare `catch`. A lint-level test enforces it (§7).
5. **One fetch pass, then pure checks.** A `gatherRecord()` fetches each resource once, with `getAll`, into a snapshot that notes which parts failed. Checks are pure functions of the snapshot, which makes them testable without HTTP and resolves D12.
6. **Keep the words FAIL and the "manual steps" section.** `src/tools/guide.ts:76`, `:100` and the prompts tell agents to "fix every FAIL".
7. **Own the rule data; do not copy rivals'.** Sources are Apple's pages. Any reuse of MIT code needs its notice preserved and a line in the PR.

### Rule catalogue, first version

Status marks what exists now. Sources: [Guidelines](https://developer.apple.com/app-store/review/guidelines/) (revision 16 Oct 2026), [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), [third-party SDK list](https://developer.apple.com/support/third-party-SDK-requirements/), [release notes](https://developer.apple.com/help/app-store-connect/release-notes/).

**Layer A, record (fix what exists).**

| Rule | Check | Severity | Now |
|---|---|---|---|
| `version.selected` | Correct platform and state, including rejected states | info | D3, D4 |
| `meta.description`, `.keywords`, `.promo`, `.whatsnew` | Lengths per locale; What's New only if a prior version went live | fail / warn | Exists, D8 |
| `meta.placeholder` | Lorem ipsum, TODO, TBD and similar in text fields, per Guideline 2.1(a) | warn | New |
| `shots.required` | Required sets by the platforms and device families the app actually supports, per locale, after Apple's scaling rules | fail | D5, D6 |
| `shots.nonempty` | Each set has images, all with `assetDeliveryState` complete | fail | D6 |
| `shots.duo` | From April 2027, Duo sets for iOS 27.1+ SDK builds. Warn before that date, using a named date constant | warn then fail | New |
| `build.attached` | Attached and `VALID`; not expired | fail | Exists, partly |
| `build.encryption` | `usesNonExemptEncryption` answered | fail | New here (`set_app_metadata` writes it) |
| `app.age`, `.category`, `.price`, `.content_rights` | Present | fail | Exists, D1; content rights new |
| `review.contact`, `.demo` | Contact present; demo account flagged when login is declared or the project shows sign-in. Never print the password | warn | Contact exists, D1 |
| `iap.state` | Each product by state; `DEVELOPER_ACTION_NEEDED` is a fail | fail | D9, D10 |
| `iap.first_bundle` | First products must go with the version on the website | manual | Exists |
| `sub.terms` | Link in the description or a custom EULA present | fail | D11 |

**Layer B, live URLs (the visible new value).**

| Rule | Check | Severity |
|---|---|---|
| `url.support.live`, `url.marketing.live` | Per locale, loads with 2xx after redirects | fail |
| `url.privacy.set`, `url.privacy.live` | Set for each locale, loads. Guideline 5.1.1(i) | fail |
| `url.privacy.content` | Page is not empty or a parked domain (length and obvious markers only; a warn, never a legal judgement) | warn |
| `url.terms.live` | The Terms or EULA link in the description loads | fail |

**Layer C, local project (table stakes, opt-in by `project_path`).**

| Rule | Check | Severity |
|---|---|---|
| `manifest.present` | `PrivacyInfo.xcprivacy` is in the app target and parses | fail if APIs are used |
| `manifest.reasons` | Required-reason categories found in source or built symbols are declared with valid reason codes | fail (ITMS-91053) |
| `sdk.manifest` | SDKs from Apple's list, found through SPM, CocoaPods or embedded frameworks, carry manifests | fail (ITMS-91061), for new apps or newly added SDKs |
| `plist.purpose` | A privacy-sensitive API in use has its `NS*UsageDescription` key, non-empty | fail |
| `plist.placeholder` | Known sample ids left in `Info.plist` | fail |
| `privacy.checklist` | Data types declared across all manifests, listed against the App Privacy page with its deep link | manual |

The last rule is the honest replacement for the label comparison Apple's API makes impossible.

### File shape

```
src/preflight/
  rules.ts         the table, one list, source and verified date per rule
  gather.ts        one fetch pass into a snapshot, with per-part errors
  checks/          record.ts, urls.ts, project.ts: pure functions
  url-probe.ts     the only code that fetches a user-controlled URL
  project-scan.ts  the only code that reads the project
  report.ts        verdict line and text output
src/tools/release-preflight.ts   thin: gate, gather, check, report
```

Apply `autopilot-code-structure`. Data model: none server-side; no D1 or worker change.

### API

`release_preflight` input gains optional `project_path` (string) and `platform` (`IOS | MAC_OS | TV_OS | VISION_OS`). Calling with `app_id` alone must keep working.

### Security

- **`url-probe.ts`.** URLs come from record fields and description text, so treat them as untrusted. http(s) only; resolve then refuse loopback, private, link-local and metadata addresses, on every redirect hop; at most 5 redirects, 8-second timeout, a body cap; no cookies, no Apple token or licence key, a plain identifying User-Agent. Return status only, and never echo the body into the report, which an agent would read as instructions.
- **`project-scan.ts`.** Read only, stays under `project_path`, skips symlinks that leave it, and never executes project code or build scripts. Findings print a path, a line and a rule, not file contents. Do not shell out with user input; use the fixed-argument pattern from the `release_notes` injection fix (`tasks/0001-fix-security-release-notes-command-injection.md`).
- **Local build artefacts** may hold secrets; only read symbol tables and plists.

## 5. Affected Files

| File | Change |
|---|---|
| `src/tools/release-preflight.ts` | Reduced to orchestration |
| `src/preflight/*` | New, as above |
| `src/index.ts` (`:477`) | Schema: `project_path`, `platform`, description |
| `src/prompts.ts` (`:106`, `:119-130`, `:161`, `:208`, `:251`) | Pass `project_path`; new verdict words. The "top 2026 rejection drivers" text needs a source or a softer wording |
| `src/tools/guide.ts` (`:76`, `:100`) | Keep in step, then `npm run docs` regenerates `USER_GUIDE.md`, `LIMITATIONS.md` |
| `src/instructions.ts` | One line on `project_path` |
| `src/tools/privacy.ts` | Point to `privacy.checklist` |
| `README.md` (`:19`, `:124`, `:167`, `:220-240`) | Remove the 40% claim; replace the example with real output, using an app of ours |
| `plugin/README.md`, `site/llms.txt`, `site/index.html` (`:345-347`, FAQ, JSON-LD) | Describe what is checked. Disclose URL probes and local reads (privacy section) |
| `RELEASE_NOTES.md`, `FLOWS.md` | Release entry; new flows |
| `launch/competitors.md` | Re-read rows from §1; add the preflight rivals |
| `site/writing/itms-91053/index.html`, `site/sitemap.xml` | New page, §9 |
| `tests/preflight/*`, `tests/preview.test.ts` | New; keep the preview test's expectation true |
| Privacy Policy page in `license-worker/src/` | Only if legal says the new reads need it |

## 6. Risks & Trade-offs

- **A free skill is good enough** (top risk). Mitigated by the kill rule, and by keeping the ambition small until it reads.
- **A clean report taken as a promise.** Every clean verdict carries the disclaimer. No marketing uses approval language. Apple's name is used descriptively, with the existing trademark disclaimer.
- **False fails erode trust faster than misses.** Anything uncertain is `warn` or `unknown`. A public false positive is a bug to fix the same day.
- **Rule rot.** Apple changes rules often (Duo, screenshot wording). Dated rules and the stale notice make it visible; re-read the sources at each release and bump the verified dates only for pages actually re-read.
- **Existing subscribers see a new format.** This is a deliberate exception to byte-identical output: state it in the release notes, keep FAIL, and keep the app_id-only call working. Agents read this output, so nothing should depend on old wording beyond what `prompts.ts` already does.
- **Report length.** Group passes as one count line per family; show failures in full. A 30-locale app should not produce hundreds of lines.
- **Build order is a trade-off.** Shipping A alone is defensible; C is free elsewhere and may never convert. That is why it is last.

## 7. Test Plan

- **Unit, pure checks on snapshots.** Every D1 to D11 has a test that fails on today's code. The most important: `app info 403 → UNKNOWN, verdict NOT CONFIRMED`.
- **Honesty test.** Make each part of `gather` fail in turn; assert the verdict is never "no blocking issues found". A source scan fails the test run on any bare `catch` in `src/preflight/`.
- **URL probe.** Local test server for 200, 404, redirect chain, redirect to `127.0.0.1` (refused), slow response, huge body, 403.
- **Project scan.** Small fixture Xcode, SPM and CocoaPods projects, labelled as test data, including a symlink out of the root. Fixtures must be built from Apple's lists in `rules.ts` at test time; a test that restates the expected value verifies nothing.
- **Real account, read only.** Run against this operator's live and draft apps with the real key. Record: which rules each app triggered, then check by hand the ones that look wrong. Include a rejected version if one exists, plus a multi-platform app if available. This resolves §1a rows 2 to 5, and row 7 by comparing to a past Apple email.
- **Independent tester.** Separate from the implementer. Drive the published package in Claude Code as a free user (preview count), as Pro (no footer), and with a low-role key (every affected rule `UNKNOWN`).
- **Full suite** once on the final tree: `npm test`, `npm run lint`, `npm run check:site`, `npm run docs` with no diff left over, `claude plugin validate`.
- **Legal gate** before release: this touches public claims, new local reads and outbound requests. Earlier gates in this repo failed first passes on exactly such wording (`.autopilot/reports/legal-2026-10-09-*`).

## 8. Acceptance Criteria

- [ ] Every D1 to D13 is fixed, each with a test that failed first.
- [ ] No bare `catch` in `src/preflight/`; each failed check appears as `UNKNOWN` naming the cause.
- [ ] "Ready to submit" appears nowhere; all clean verdicts carry the not-a-prediction line.
- [ ] Every rule in the table has a source URL and verified date, and the report prints the rule-set date.
- [ ] A dead support URL fails on a real run. A URL resolving to a private address is never requested.
- [ ] An empty screenshot set fails. An iPad-capable app without a 13-inch set fails, an iPhone-only app does not.
- [ ] Rejected versions are selected. Multi-platform apps get a section each.
- [ ] Each fail that has a fix tool names it, and the named tool exists in `src/tool-meta.ts` (test).
- [ ] App_id-only calls still work; `project_path` rules run when given and show `SKIPPED` when not.
- [ ] The project scan performs no writes and no execution, and no file contents are printed (test).
- [ ] Tool count is unchanged at 41; annotations unchanged.
- [ ] `/v1/appDataUsages` re-probed, result recorded in `LIMITATIONS.md`'s source note and `src/tools/privacy.ts`.
- [ ] 40% claim gone from all public surfaces. `grep -rn "40%" README.md site plugin` is clean of it.
- [ ] Real-account results recorded in `HANDOFF.md`, with anything not driven labelled "implemented, not tested".
- [ ] Independent tester and legal gate reports in `.autopilot/reports/`.

## 9. Rollout Plan

**Order.** Each milestone can ship alone.

1. **M0, same day, separate from the rest.** Remove the 40% claim (D13) and reword D2 and D11. This is a live public claim, so it should not wait.
2. **M1, Layer A.** The rules table, `gather`, four statuses, D1 to D12. This is the part worth doing regardless.
3. **M2, Layer B.** URL probes. The first version we talk about publicly.
4. **M3, Layer C.** Project scan and the ITMS-91053 page. Do it only if M2 has not shown a reason to stop.

The research estimated about a week. That was made before these defects were known; treat M1 + M2 as the week and M3 as further work.

**Release mechanics (traps already hit here).**

- Live paying subscribers exist. Before touching anything licence-related, read `HANDOFF.md`. This PRD should not touch `src/gate.ts` or the worker.
- This repo's `.autopilot/config.toml` has no `[feature]` section, so the turn-mode workflow applies: Classify, PRD, Architect Review, Implement, Independent Test, Commit.
- Pushing `master` publishes the plugin manifest, and the Claude directory listing tracks `master`. A pushed release commit once pinned the plugin to an npm version that did not exist. Use `npm run release -- <version>`, which runs in the right order and re-syncs the pin.
- npm publish needs 2FA with the operator's security key, so that step is the operator's. Deploy site and worker only per `deploy-site.txt`, `deploy-license-worker.txt`.
- Rollback: `npm deprecate` the version and re-point `latest`. No server state changes.

**Distribution (rule 2, DISTRIBUTION.md gets updated in the same change).**

Evidence from the 29 Oct demand gate, Google autocomplete, US only, measured as the characters needed before the phrase is suggested (lower means more searched; "online fax" = 8 for scale). It shows that people search, not how many:

| Phrase | Prefix |
|---|---|
| `itms-91053` | 7 |
| `privacy manifest` | 12 |
| `app store rejection` | 13 |
| `app store review guidelines checklist` | No suggestion |

The strongest search phrase is a build-side error, which only Layer C answers. So:

1. **`/writing/itms-91053/`.** What the email means, how to find the API and SDK responsible, how to declare it, and the tool that checks it, passing SEO, CRO and AEO gates. Follow `site/writing/app-store-connect-api-limits/` as the model, and add a new line to `llms.txt`.
2. **The clip.** Preflight finds a dead URL on a real app, the agent fixes it, re-run comes back clean. Already named in `DISTRIBUTION.md` §6 and never made.
3. **Replies where the problem is raised.** r/iOSProgramming and Apple developer forum threads about ITMS-91053 or rejection under 2.1, within each venue's rules, with real help first. Drafts go in `launch/` as paste-ready `.txt`. No cold outreach, in line with DISTRIBUTION.md §10.
4. **Mail to past trial users is not part of the launch by default.** The research suggested it. Trial mail has a compliance history (`tasks/prd-compliance-c1-reminder-mail-optout.md`), the operator declined a customer note on 18 Oct, and the list is small. If proposed, it needs the legal gate and the operator's decision, and must respect the opt-out column. Product release notes in `RELEASE_NOTES.md` carry the news meanwhile.

**Legal.** Run the six questions. Known answers: no approval promises; Apple names are descriptive only, and never in a product name or domain. Reading the privacy page only tests that it exists and is non-empty, never whether it complies. Confirm the privacy text covers local project reads and outbound URL requests.

## 10. Documentation

`README.md`, `plugin/README.md`, `USER_GUIDE.md` and `LIMITATIONS.md` (generated), `site/` and `llms.txt`, `RELEASE_NOTES.md`, `DISTRIBUTION.md`, `launch/competitors.md`, `FLOWS.md`, `WORKLOG.md`, `HANDOFF.md`. This PRD is amended rather than forked if the scope moves.

## Appendix: evidence and its limits

**Scores from the research (out of 30).** Demand 3, gap 3, willingness to pay 4, harness edge 5, speed 5, channel 5 = 25. These are judgement; §0 explains why the gap and channel look generous now.

**Read directly on 2026-10-31.** This repo at `3dbe4ea`, package `1.9.15`. Production `intent_events`, read-only and aggregated, no personal data: 22 all-time `trial_started` rows, 2 tagged `release_preflight` (most recent 30 Oct), and no `checkout_click` tagged with it. Apple's Guidelines, screenshot spec, third-party SDK list, App Store Connect release notes and API notes 4.0 to 4.5.1. GitHub metadata and READMEs for the rivals.

**Not verified.** Nobody has been quoted saying they would pay for this. Rivals were read, not run. The real-account checks in §1a are still to do. The defects in §1 were found by reading the code and not by reproducing each against Apple, so D3, D4 and D9 in particular should be confirmed by a failing test first. The per-idea harness, buyer and first-customer notes are in the research's `03_persona_toolsmith.md` and `03_persona_contrarian.md`; pain points are in `02_pain_points.md`.
