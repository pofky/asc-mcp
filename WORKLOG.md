# WORKLOG, @pofky/asc-mcp

## Currently Active
**v1.8.4, live sweep of every write path (2026-07-30).** Ran all 40 tools against the real
account: confirm guardrails, free-tier gating, instruction-only tools, reads on both a live and
a draft app, reversible writes (read back and restored), and wrong-input paths. 5 of 25 checks
failed; all five fixed, sweep now 25/25.

- **set_app_availability was broken outright.** Create rejected any territory subset: Apple
  requires a territoryAvailability for every territory and returns one 409 per missing one
  ("expects an included resource with type 'territories' and id 'JOR'"), so it now sends all
  175 with the choice in each `available` flag. Update PATCHed
  `/v2/territoryAvailabilities/{id}`, which 404s because the rows are **v1** resources.
  Probed the alternatives to be sure: `PATCH /v2/appAvailabilities/{id}` is 403 (CREATE and
  GET_INSTANCE only), re-POST is 409, `/v1/apps/{id}/relationships/availableTerritories` does
  not exist, `PATCH /v1/territoryAvailabilities/{id}` works. Verified live: all 175 on,
  narrow to 3, back to 175, each state read back. `availableInNewTerritories` is create-only
  and the tool now says so instead of swallowing a failed PATCH.
- **409 hints were misleading.** Apple uses 409 both for state conflicts and for rejected
  attribute values, so a bad phone format told the user to check their version state. The hint
  now names the field from Apple's error pointer.
- create_version threw Apple's raw 409; it now separates "version number already used" from
  "a version is still open", which need different actions.
- create_iap crashed with a TypeError on missing args; it names them.
- list_builds said "no builds found" for a nonexistent app_id (filter[app] returns an empty
  list, not a 404); it now checks whether the app exists.

105 tests. Test app (Adaptale) left clean: availability back to 175/175, copyright restored to
null, build 1 attached (its only build, normal for a draft), review contact set to the real
owner name since the field was empty before the sweep and Apple needs one before submission.

Still not exercised live, and honestly unverified since June: build_and_archive and
upload_binary (need a full Xcode build), the TestFlight write calls (assign_build_to_group,
invite_beta_tester), create_iap/create_subscription success paths (they create real products
that cannot be cleanly deleted), setup_app_store_signing (creates certificates/profiles), and
submit_for_review/release_version with confirm (outward-facing). The June 2026 Glasyn ship
exercised all of those live.

**v1.8.3, customer-reported appInfo bug (2026-07-30, same day as the report).**
Michael Knuesel (the active Pro customer) reported that update_version_metadata's
name/subtitle writes 409 for an app that already has a release, and diagnosed it correctly: an
app holds two appInfos at once (live plus the draft attached to the version being prepared),
Apple lists the live one first, and the code read appInfos with limit=1. Reproduced live:
ClothTrace returns READY_FOR_SALE then WAITING_FOR_REVIEW, and patching the first gives the
exact error "The field 'subtitle' can not be modified in the current state".

Fixed in new `src/app-info.ts`: fetch all appInfos with their state (appStoreState, falling
back to the newer `state`), `pickEditableAppInfo` for writes, `pickAuditAppInfo` for reads,
and a message that names the states present when nothing is editable. The same limit=1
assumption was in three more tools and is fixed there too: set_app_metadata (categories),
set_age_rating (declaration hangs off the appInfo), and release_preflight, which had been
auditing the live name and privacy URL instead of the pending ones. A 409 on the app-level
patch is now a note on the result rather than an exception that discards the version-level
fields that already landed. 13 unit tests; live end-to-end subtitle write verified by reading
it back and restoring it. Published 1.8.3 to npm, registry, and the site.

Open: reply to Michael (draft ready, needs a human to send; /admin/announce can deliver it).

**Distribution + revenue-path session (2026-07-30). Shipped v1.8.1 and v1.8.2.**

The product was healthy; the way people find and keep paying for it was not. Fixed all of it.

Public surfaces, all verified live:
- **Landing page was down.** asc-mcp.pages.dev returned 522 with no working production
  deployment, and the content was a 4 June draft selling "11 tools. 3 free, 8 Pro." Rebuilt
  `site/` for the 40-tool control plane: self-contained inline CSS (no Tailwind CDN, no
  webfont in the critical path), one h1, canonical/OG/Twitter, Organization + WebSite +
  SoftwareApplication + FAQPage JSON-LD, robots.txt with an AI-crawler allowlist,
  sitemap.xml, llms.txt, `_headers` with CSP, og.png generated from og.svg. Signature
  element is App Store Connect's real state machine annotated with which tool drives each
  transition and which stages only the website can do. Live: 457ms load, no console errors,
  no horizontal overflow at 390px. Note: the Pages production branch is **master**;
  deploying to `--branch main` silently lands as a preview, which is what the 522 was.
- **GitHub Pages mirror retired** (workflow + Pages API). It duplicated the site under
  /asc-mcp/ where the absolute asset paths 404.
- **MCP registry was pointing customers at a dead package.** The only published entry was
  `io.github.pofky/appstore-connect-mcp` v0.2.1 (April) referencing npm
  `@pofky/appstore-connect-mcp`, not the real package. Published
  `io.github.pofky/asc-mcp` (now v1.8.2) via a new tag-triggered GitHub Actions OIDC
  workflow, deprecated the old registry entry, and deprecated the old npm package with a
  pointer. Two CI gotchas: `mcp-publisher status` prompts for confirmation (pipe `yes`),
  and republishing an existing version must not abort the deprecation step.
- **npm had no homepage, repository or bugs fields**, so the package page linked nowhere.
  Added.
- **awesome-mcp-servers PR #11198** opened (91.6k stars, one line, alphabetical position).
  Remaining directory work is in `launch/distribution-checklist.md`.
- Launch drafts were all v1.2.0-era (11 tools, read-only positioning, an unsupportable
  "40% of rejections" claim). Rewritten around the real submission plus the honest
  limitation list; added an Indie Hackers draft; deleted a duplicate Reddit draft.

Product fixes found by verifying rather than reading:
- **Credential-less start killed the process before the MCP handshake**, so a first-time
  user saw "server disconnected" and could never reach `asc_setup_check`. Now boots in
  setup mode with `asc_setup_check` + `asc_guide` and a regression test that spawns the
  built server.
- **Licence fairness (revenue).** Polar's `subscription.canceled` means "will not renew",
  but the worker set `active=0` immediately, taking away time customers had already paid
  for. Only `revoked` deactivates now. Also added a 4-day grace window past `expires_at`,
  because renewals arrive as `subscription.updated` and a late or dropped webhook was
  demoting a paying customer to the free tier mid-session with no recourse. 6 tests.
- `sales_report` required `vendor_number`, which is only visible in the ASC website and so
  cannot be guessed by an agent; a missing value surfaced as a raw zod dump. Now optional
  with a reply saying exactly where to find it.

Verification actually run: 86 unit tests, `tsc --noEmit` clean, clean `npx` install of
1.8.2 exposes 40 tools and 6 prompts, live doctor against the real account all OK, and 11
read/intelligence Pro tools called live through the MCP protocol with a Pro licence
(list_apps, app_details, review_status, list_reviews, release_preflight, daily_briefing,
metadata_diff, keyword_insights, competitor_snapshot, list_builds, list_beta_groups) all
returning real data. There is now an owner self-test licence in D1
(`polar_subscription_id = 'owner-selftest'`) so the Pro surface can be checked without a
customer's key.

**Revenue reality check.** D1 has 4 customers: 1 active ($9 MRR, signed up 29 July) and 3
whose subscriptions ended at their first period end (4 June, 11 June, 12 June cohort). The
canceled-vs-revoked bug and the missing renewal grace both plausibly contributed, and both
are now fixed, but retention past month one is the open question, not acquisition. Next
concrete step is the directory checklist plus the Show HN and Indie Hackers posts, which
need a human to post.

### Prior: **Health audit (2026-07-30).** Green: 79/79 tests, `tsc --noEmit` clean, npm `latest` 1.8.0 matches
repo, `npm run docs` produces zero drift, 40 tools + 6 prompts enumerated live off `dist/`, license
worker responds (`/validate` bogus key returns free tier). Fixed (b38f059): credential-less start
called `process.exit(1)` before the MCP handshake, so a new user saw "server disconnected" and could
never reach `asc_setup_check`; now boots in setup mode with `asc_setup_check` + `asc_guide` only
(verified live: connects, prints exact per-check fixes). Also refreshed README's stale 36 tools /
4 prompts and server.json's 1.0.0 pin.
Open: `site/index.html` still advertises "11 tools. 3 free, 8 Pro." (Jun 4, pre-control-plane) and
loads Tailwind from CDN. Not deployed to any domain yet, so nobody is being misinformed, but it
blocks launch and needs a rewrite through the SEO/CRO/AEO gate.

### Prior: **Shipped v1.8.0 to npm + customer #4 verified (2026-07-29).** New Pro buyer
(knuesel.michael@gmail.com, sub 088dbba4) provisioned correctly: D1 row active, key emailed via
Brevo, /validate returns pro, /key recovery returns the key. Found the real gap: npm `latest` was
still 1.3.0 from 2026-04-15, so paying customers got 13 tools instead of 40. Committed master
(ced1419) and published 1.8.0. Verified from a clean install: 40 tools, 6 prompts, all 11 asc_guide
topics, both new prompts, asc_setup_check live-authenticated, list_apps returned all 9 apps.
Worker: fixed un-awaited handlers (bad JSON body to /key returned CF error 1101 instead of a 500),
added admin-guarded /admin/announce (ANNOUNCE_TOKEN secret, recipient must exist in licenses),
and emailed the customer the update instructions.

### Prior: **Productization pass v1.7.0 (2026-06-30).** Glasyn was approved, validating the full flow. Turned
the control plane from a proven-but-raw surface into a premium, self-navigating tool for indie devs
driving it through an agent.

Done this session:
- New free tool `asc_guide(topic)`: the orientation layer. Returns the exact end-to-end playbook
  per goal (setup, first-app, update, screenshots, iap, subscriptions, reviews, testflight, binary,
  limitations) with every manual ASC-website/Xcode interruption flagged inline. Single source of
  truth in `src/tools/guide.ts`.
- New prompt `/asc-first-app`: drives a brand-new app's 1.0 end to end, stopping at each manual step.
- `USER_GUIDE.md` + `LIMITATIONS.md` generated from guide.ts via `scripts/gen-docs.mjs` (`npm run docs`),
  so docs never drift from the tool.
- Onboarding polish: `asc-mcp init` now prints concrete next steps pointing at list_apps + asc_guide.
- README: asc_guide as "start here", `/asc-first-app`, and a "What stays manual" section.
- 39 tools, 5 prompts, 74 unit tests (added tests/guide.test.ts). All uncommitted on `master`.

Accuracy audit (cross-checked all 39 tool descriptions + guide playbooks vs the code).
Found 10 issues, all fixed:
- 2 real code bugs: (a) "editable version" states drifted across tools (INVALID_BINARY in one,
  not others), so a rejected-binary version could be edited but not re-attached/submitted, now
  one shared `src/editable.ts` constant + regression test; (b) `manage_phased_release` picked an
  unsorted `versions[0]`, now selects the PENDING_DEVELOPER_RELEASE/READY_FOR_SALE version.
- 3 hidden args exposed: create_subscription (group_level, family_sharable), create_iap (family_sharable).
- 5 description/doc accuracy fixes: update_version_metadata (privacy_policy_url), submit_for_review
  (auto-submits products + first-IAP abort), set_age_rating (INFREQUENT/FREQUENT), guide update flow
  (names upload_binary), guide iap flow (immediate state recompute), upload_binary return (wait_for_build).
- Swept all em-dashes from src/ (global rule). 76 tests pass.
Caveat: static code-vs-description audit only; not re-run live against ASC this session (Glasyn ship
on 2026-06-27 is the live proof). Binary build/upload + phased release not re-exercised live.

### Newbie-simplicity pass v1.8.0 (2026-06-30)
Lowered the setup/value barrier for first-time users (free/paid boundary unchanged).
- `src/doctor.ts` + free `asc_setup_check` tool + `asc-mcp doctor` CLI: checks .p8, Key ID, Issuer ID,
  a LIVE authenticated call, and license tier, printing the exact fix per failure. Live path verified
  against the real account (issuer d6dd27de...): all OK, "Authenticated and listed apps".
- Plain-language API errors: `client.ts` ASCAPIError now appends a "what this usually means" hint for
  401/403/404/409/429/5xx (wrong Issuer ID, role too low, bad state, etc.).
- `asc-mcp init --write`: detects Claude Desktop / Claude Code / project config, backs up, merges the
  server block (no manual JSON). Plain `init` still prints the block.
- `/asc-start` prompt: zero-to-oriented onboarding (setup_check, list_apps, free-vs-Pro, next step).
- README: npx-first config, doctor/init --write/asc_setup_check/asc-start documented.
- 40 tools, 6 prompts, 79 unit tests (added tests/doctor.test.ts). All uncommitted on `master`.

### Prior: Control plane v1.5.0 + shipping Glasyn live (2026-06-27)
Drove the full write/control surface against the real ASC account to ship Glasyn (app `6784799368`),
fixing every bug the live runs surfaced.

Done this session:
- New tools: `create_subscription`, `create_iap`, `set_age_rating`, `set_privacy_nutrition`,
  `set_eu_trader_status`, `set_iap_review_screenshot` (33 tools total, 68 unit tests).
- `update_version_metadata` now sets marketing/support/privacy-policy URLs and survives Apple's
  atomic-PATCH gotcha (drops a non-editable attribute and retries).
- `release_preflight` now also checks age rating, privacy URL, and IAP/subscription readiness.
- Glasyn live: version 1.0 metadata + URLs, age rating 12+, build attached, 1 screenshot,
  privacy policy URL. Lifetime IAP READY_TO_SUBMIT. Both subs priced in all 175 territories
  (USA base + equalized) with 175 free-trial intro offers + review screenshots.

Resolved: subscriptions stayed MISSING_METADATA because their state recomputes only on a
subscription-level PATCH, not when sub-resources change. `create_subscription` now does a final
no-op name PATCH; all 3 products are READY_TO_SUBMIT. `release_preflight` on Glasyn v1.0 = PASS
(0 fail, 1 warn: APP_IPHONE_65 set recommended). glasyn.app turned out to be already deployed,
so the Support URL was never a real blocker.

Ship blockers outside the API (ASC UI, must precede submit): privacy nutrition label
"Data Not Collected", EU trader status (legal), registered legal name in privacy.html; plus more
screenshots (recommended). `submit_for_review` is outward-facing (confirm:true) - ask operator.

Full gotcha log: `CONTROL_PLANE.md`.
