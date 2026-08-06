# WORKLOG, @pofky/asc-mcp

## Currently Active
**In-agent 7-day trial, buy-intent attribution, and a security pass (2026-08-06, v1.9.0, SHIPPED).**

Built because the funnel said the product converts and nobody sees it. 9 Polar checkouts in 4 days,
1 paid, and not one of the 8 abandoned sessions typed an email address: people leave on sight,
before the card. Meanwhile 1,727 npm "downloads" is a vanity number, since the documented launch
command is `npx -y`, which re-resolves on every client restart; 28 unique GitHub visitors in 14
days is closer to the truth. The repo also has 0 stars against competitors at 46, 24 and 11.

`asc_start_trial` (free tool #6 of 41): user gives their email, the server mints a 7-day Pro key,
it is written into their MCP config, and `tier` is reassigned in the running process so the tool
that was just refused works on the next call with no restart. One trial per Apple developer
account, anchored on a SHA-256 of the Issuer ID computed on the user's machine. Every Pro gate now
routes through `requirePro` with the tool name attached, and `/go?tool=X` counts the click before
redirecting to Polar with utm attribution, so a purchase is finally traceable to what the user was
reaching for. `/admin/stats` reads it back.

Deliberately NOT built: the anonymous gate-hit counter. Counting locked-tool hits inside the
process is telemetry, and the live privacy page promises there is none. Demand is measured only
from things the user initiates.

**Three reviews, three rounds of real findings.** Architect: a converted customer would have kept
the trial key and lost access on day 8 while paying; the 4-day renewal grace would have made every
7-day trial an 11-day one; deploying the worker before the migration returns 500, which the client
reads as "invalid", silently dropping all three paying customers to free (now has a fallback).
Security: the email was a second uniqueness anchor while the fingerprint proves nothing about who
sent it, so anyone could burn a stranger's trial with a made-up fingerprint, and open CORS made it
a drive-by; refusal messages revealed subscriber status; and `/delete`, which predates all of this,
revoked a licence on an unauthenticated form post. Tester: converting was still a trap in the
messaging, and `injectLicenseKey` matched "asc-mcp" as a substring, writing a paid key into
unrelated servers.

Also moved the worker's pure logic to `logic.ts`. Exporting helpers from the entry module made
`wrangler dev` refuse to start, which is why this licence server had only ever been tested in
production.

**A fifth audit ran the billing lifecycle instead of the trial path, and found the release-blocker.**
`subscription.revoked` switched the row off but left no mark on it, so the next `subscription.updated`
carrying the pre-cancellation state, an ordinary Polar retry rather than an attack, wrote `active=1`
straight back: revoked, non-paying users got a working key again. Reproduced locally, fixed by
stamping `revoked_at` and guarding the upsert with `WHERE revoked_at IS NULL`. Same audit: every
cancellation was collecting the 4-day renewal grace on top of the period it paid for, which is
leakage since a cancelled subscription has no renewal to be late (`canceled_at` now suppresses it);
and trialling with a personal address then checking out with a work one stranded the customer on a
trial key that broke on day 8 (the paid branch now matches the trial on the fingerprint alone).

180 unit tests, 39 HTTP checks against a D1 migrated from the live table shape, 21 checks driving
the built server over stdio, 16 lifecycle checks driving real signed webhooks through a local
worker. Green. An independent tester then ran 55 adversarial cases against the three lifecycle claims and
found no defect.

**Shipped 2026-08-06.** Order: snapshot the 8 live licence rows, apply the D1 migration, re-validate
the 5 active keys against the old worker (all pro), set `DELETE_SECRET`, deploy, re-validate again
(all pro, no interruption at any point). `POLAR_WEBHOOK_SECRET_SANDBOX` confirmed absent before the
deploy. Production smoke: a real trial minted, validated as a pro trial, repeated idempotently, and
the row deleted afterwards so it does not pollute the funnel numbers; paying customers refused a
trial without leaking their key; `/go` redirects with utm attribution; `/admin/stats` 401s unguarded.
npm 1.9.0 published, MCP registry published (the tag had to be recreated because server.json was
still on 1.8.8), site deployed by hand because the Pages git integration has not fired since
2 August. Final check ran the published package from npm in a throwaway HOME: 41 tools, the trial
offered free, a locked tool refusing with the trial before the price and the buy link attributed.

Open: nothing is deployed. `docs/deploy-prd-0001.md` is the runbook; the gate is re-validating all
three paying keys immediately after the worker deploy. Needs `DELETE_SECRET` set, and
`POLAR_WEBHOOK_SECRET_SANDBOX` confirmed absent. Not done and worth doing: 0 stars is the most
likely cause of the checkout abandonment, and a benchmark post against the 875-tool competitor
(context cost and tool-selection accuracy) is the strongest available answer to them.

**asc-mcp sells through its own Polar organization (2026-08-02, v1.8.8).**

New signups now go to org `asc-mcp` (`3bef20c6`), product "App Store Connect MCP Pro" at $9/mo USD,
checkout `polar_cl_y86PS4ruc848PXevVvSYS49S8gZY8JYWF192v1UEgjj`. Polar cannot move active
subscriptions between orgs, so the three existing subscribers stay with the old org until they
churn; all three still validate as Pro, unchanged. Both orgs deliver to the same webhook
endpoint and the worker holds both signing secrets. Details and the reason the old org must stay
enabled: `launch/polar-org-migration.md`.

Two bugs the move surfaced, both fixed and deployed. An API-minted webhook secret is
`whsec_<base64>`, not the dashboard `polar_whs_...`, and the two key the HMAC off different
bytes; verification now tries both, which matters because this check is where a paying customer
silently gets no key. And a renewal can arrive as `subscription.cycled`, which was classified
"ignore", so a renewed customer would have kept last period expiry and dropped to free once
grace ran out. Verified on the deployed worker with a signed self-test delivery (200 both ways,
401 on a bad signature, row written then deleted). 121 tests.

Open: nobody has bought through the new link yet, and only a real payment proves that path.
Payouts from the new org also wait on KYC.

**Customer #6, and the version-drift bug it found (2026-08-01, v1.8.7).**

Second subscriber of the day: koheimitsui3@gmail.com, D1 row 24, 18:38 UTC. `active=1`,
`key_emailed=1`, expires 2026-09-01, `/validate` returns Pro. They landed 7 minutes after the
worker deploy (18:31) and after 1.8.6 was on npm, so they are the first customer to get both the
fixed licence email with a full config block and an `init` that generates a launchable config.
Verified their exact key end to end: clean-dir install from npm, stdio handshake, "Pro license
active", setup check all-OK, `list_apps` returned all 8 apps.

**Found: the server announced the wrong version.** `SERVER_VERSION` was a hand-maintained
literal, so 1.8.6 introduced itself as 1.8.5 in every client handshake and every stderr banner.
Any bug report from these two customers would have named a version that does not contain their
fix. Now read from package.json at startup, with a spawn test asserting the handshake and the
banner match the package. Shipped as 1.8.7 (npm, tag, site); verified the published build reports
1.8.7 with customer #6's key.

The id gap in D1 (21 to 24) is not lost customers: the upsert's `ON CONFLICT` still consumes an
AUTOINCREMENT value on every repeat Polar delivery.

Full licence audit, all 7 keys checked live against `/validate`: 3 paying customers active
(knuesel.michael, chamillo007, koheimitsui3), 2 lapsed real customers correctly inactive
(stevias.geneugten.5j, ameen), and 2 owner-owned rows, the `owner-selftest` key and
`geowrecked@gmail.com` (an owner test purchase in June, `key_emailed=0` from the Brevo outage, so
not a customer with an undelivered key). Not yet reconciled against Polar itself: if Polar still
bills a row we have inactive, that is billing without access. Needs a Polar API token.

**Customer #5 onboarding check, and the setup bug it found (2026-08-01).**

New Pro subscriber landed 2026-08-01 17:37 UTC (D1 row 21, chamillo007@gmail.com). Provisioning
is clean end to end: `active=1`, `key_emailed=1`, `expires_at` 2026-09-01, and `/validate`
returns `{"valid":true,"tier":"pro"}` live. Worker `/health`, `/key`, `/privacy`, `/terms`, the
landing page, llms.txt, sitemap and the Polar checkout all 200. All four worker secrets present.

Ran the customer's own path: installed `@pofky/asc-mcp@1.8.5` fresh from npm into a clean dir and
drove it over stdio. Free tier: 40 tools, 6 prompts, `asc_setup_check` all-OK with a Free-tier
warn. With a Pro key: "Pro license active", setup check all-OK, `asc_guide` correct.

**Found: `asc-mcp init` generated a config that cannot start.** It wrote
`"command": "asc-mcp"`, a bare binary that only exists after `npm i -g`. The site's primary CTA
and README both tell people to run `npx @pofky/asc-mcp init`, which never puts that binary on
PATH, so a customer following the documented path got a config whose server fails to launch.
My own machine has a stale global install, which is why every previous check passed. Fixed in
v1.8.6: one exported `SERVER_LAUNCH` (`npx -y @pofky/asc-mcp`) used by both the printed block and
`--write`, matching the README. Every other `asc-mcp <cmd>` instruction in the guide, doctor,
client errors, README and CONTROL_PLANE now says `npx @pofky/asc-mcp <cmd>` too; the CLI's own
`--help` still uses the short form, which is correct once you are running the binary.
4 regression tests on the generated block (npx form, merge preserves other servers, `.bak`
backup, unparseable config left untouched). 112 tests pass.

**Also: the licence email had nothing to paste into.** Both the Brevo email and the `/key`
lookup page sent only the `"ASC_LICENSE_KEY": "..."` line, which assumes a working config already
exists. Someone who buys before installing had no block. Both now carry a complete `mcpServers`
snippet plus the `npx @pofky/asc-mcp init --write` path.

All shipped and verified live: npm 1.8.6 (re-installed from the registry into a clean dir, the
generated block is the npx form), MCP registry workflow green on tag v1.8.6, site on Pages
master showing v1.8.6, licence worker deployed (`/key` now returns the full block). Customer #5
had been emailed the pre-fix wording, so they got a follow-up with the working config via
`/admin/announce`. ANNOUNCE_TOKEN was rotated to send it, since worker secrets cannot be read
back.

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

Reply to Michael sent by hand (confirmed 2026-08-01). Draft kept in launch/ for tone reference.

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
