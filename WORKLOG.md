# WORKLOG, @pofky/asc-mcp

## Currently Active
**Shipped v1.8.0 to npm + customer #4 verified (2026-07-29).** New Pro buyer
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
