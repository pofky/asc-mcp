# WORKLOG, @pofky/asc-mcp

## Currently Active
**Fourth full flow audit, and the leak it found: six trials, zero reminders (2026-09-03).**

Everything the product advertises was driven again, against production and the published 1.9.7, not
read from the code. Nothing was broken. Every surface matches the repo, both test suites are green,
and the money path works end to end: setup mode, `init` and `init --write` into a real client config,
Node 18 and Node 22 startup, the free tier's live reads, the Pro gate on write/control/intelligence
tools, a live trial mint that unlocked all 41 tools in the same session with no restart, the confirm
gates, the error paths, every CLI subcommand, the skill install lifecycle, the worker's pages and
headers, and the checkout link resolving to a payable Polar session. The full list is in HANDOFF.md.

What the audit found is not a defect in any flow, it is a missing one. Six trials have been minted
since 7 August and not one converted. After a trial expires, the price appears in exactly one place:
inside a tool call the person has to make first, in an agent transcript they may never scroll back
through. Nothing ever reached them again, and nothing told them the clock was running while it still
mattered. The paywall was never the problem.

Both halves are now built, tested and committed. The licence worker gets a daily cron
(`runTrialReminders`, 15:00 UTC): one mail the day before expiry while the key still works, one the
day after saying what stopped working and what it costs to turn back on, both through the counted
`/go` redirect with the address prefilled. Idempotent by column, so a double fire cannot mail anyone
twice and a failed send retries tomorrow rather than being marked done. The lapsed window is three
days, which is also what stops the first run writing to the four trials that expired in August. And
the package stops hiding the clock: the setup check and the startup line now read the expiry
`/validate` has always returned, as a fact at five days out and a warning that names the price at
two. A subscription is untouched.

Driven, not assumed: the cron was fired against a local worker with a seeded D1 and a deliberately
invalid Brevo key. It selected exactly the two due rows, skipped the 20-day-old one, and left both
unstamped when the sends failed. 234 package tests, 62 worker tests.

**Not live.** The D1 migration, the worker deploy and `npm publish` were all refused by the sandbox
classifier. Four operator commands, in order, in `launch/operator-deploy-trial-reminders.txt`. The
migration must go before the deploy: the job reads two columns that do not exist yet.

Also found, and left for the operator: one real trial started on 2 September (`info@7stock.app`,
triggered by `set_app_metadata`, expires 9 September) and one `site_pricing` checkout click the same
day that did not become a Polar session. The 9 September trial is the first person the new reminders
will reach. The `asc-mcp` Polar org still holds exactly one order and one subscription, renewing
5 September; the other five paying rows live in the old grandfathered org.

## Prior: the emails, read in a real inbox (2026-08-31)

The one flow that could not be checked from here. Two defects, both fixed and deployed. The trial
email opened with "Your agent has already written this into your MCP config", which is false for a
one-click bundle install, where there is no config file, and false whenever the agent could not find
one and said so. And its upgrade link was the raw Polar URL, so a trial user deciding to pay, the
most valuable click in the product, was the only one not counted, and had to retype an address we
already had. The link now goes through `/go`, which counts it and passes an optional email into the
checkout prefill; the redirect target is still the constant checkout link and a malformed address is
dropped. Both emails also carry a plain-text alternative now, and their bodies live in `logic.ts` as
pure functions with tests, so the next defect in them is catchable without an inbox.

Left open, because it costs money: every licence email is sent from `license@brewist.app`, another
product's domain. Deliverability is fine and all five test messages arrived, but a buyer paying for
a developer tool gets their key from a coffee app's domain. Registering a domain and setting
`BREVO_SENDER_EMAIL` is the whole fix; the code already reads the variable.

**1.9.7, and the release mechanics that kept half-landing (2026-08-31).**

One product fix: on day 8 of a trial `asc_setup_check` reported "a license key is set but did not
validate as Pro" and told the user to retrieve their key or wait out a server outage. The key was
fine and the server was fine, the trial was simply over, and that is the one moment where the price
and the link are the answer. It now reads the reason `/validate` already returns, with separate
wording for a cancelled subscription and an expired licence.

Two infrastructure fixes. `npm publish` from this machine reliably leaves npm's "staged" state: the
upload lands, the connection drops before acknowledgement, and the version appears on its own
several minutes later. The release script treated that as a failure and carried on, and because it
pushed the tag before publishing, the registry workflow then asked to register a version npm did not
have. Both 1.9.6 and 1.9.7 half-landed that way. npm now goes first and the script waits for the
registry to actually serve the version.

The licence pages also got the security headers the landing page has always had (CSP, nosniff,
DENY framing, referrer policy) and now answer HEAD, which they previously 404'd, so uptime checks
and link previews saw a broken page. Verified in a browser with no CSP violations.

Everything re-verified at 1.9.7: npm, the MCP registry, the GitHub release and bundle, the site, and
the published tarball authenticating live against Apple on Node 18.20.8 with Pro unlocked.

**1.9.6 shipped, and the release script's own bug (2026-08-31).**

Published to npm, the MCP registry, a GitHub release with the bundle, and the site, all verified at
1.9.6. The journey was then rehearsed end to end against the published package: `init --write` from
a clean `npx` writes a working config, the server authenticates live, a Pro tool refuses with the
trial copy, `asc_start_trial` returns the paid key and persists it to the config, and
`release_preflight` runs. Repeated on Node 18.20.8 with the published tarball and its own installed
dependencies, which is the version that could not start at all before this release.

Getting it out found one more bug, in `scripts/release.mjs`. It pushed the tag, which starts the
registry workflow, before running `npm publish`. The registry refuses to register a version npm does
not have yet, so the workflow lost the race against our own publish and the release half-landed:
a tag and a GitHub release, nothing on npm or the registry. npm goes first now, with a settle window
before the tag, so a failed publish stops the release before a tag exists. The deprecation step also
reported a red error on every release, because "already deprecated" is a 400 with exit 1; it now
only warns when something real went wrong.

**Third pass: the server did not run on Node 18 (2026-08-31).**

Drove every advertised flow, not just the money path. The headline: `jose` is ESM-only from v6, the
package is CommonJS, so `require("jose")` threw `ERR_REQUIRE_ESM` before any of our code ran on every
Node 18 and every Node 20 below 20.19, while `engines`, the README, the site and the .mcpb manifest
all promised Node 18. Dropped the dependency for Node's own `crypto` (ES256 with
`dsaEncoding: "ieee-p1363"`, the raw r||s pair Apple wants), verified live on 18.20.8 including the
bundle, and added a test that walks the dependency tree so an ESM-only package cannot come back
unnoticed. Nothing caught it because every local and CI run uses a newer Node.

Three smaller flow breaks, all fixed: `list_reviews` never printed the review id that
`draft_review_response` requires, so the documented reviews flow had no way across that step;
`draft_review_response` told clients without Sampling to "draft by hand" instead of handing the model
that called it the review and the rules; and a mistyped command started the MCP server, which then
sat on stdio looking like a hang.

Everything else was driven and found correct: setup mode, doctor, skill install/uninstall, the .mcpb
bundle under both Node versions, all 41 tool schemas, thirteen live read tools, the four confirm
gates, the error paths, a real write to Apple confirmed by an independent signed read and reverted,
every licence endpoint including rate limiting and the GDPR delete guards, the full webhook path
against a local worker (mint, forged signature, renewal, foreign product, cancel, revoke, replay),
offline grace with the licence server unreachable, and the site at 375px with zero console errors.
The worker's own pages were logging a favicon 404 on every transactional page; fixed and deployed.

Also corrected three distribution claims that had drifted: Smithery is a dead end and the yaml has
not been in the repo since 6 August, the mcpservers.org duplicate is gone, and PulseMCP is mirroring
the deprecated registry entry rather than waiting on a sync, so the email now asks for a repoint.

**Second pass: two real bugs, and a competitor (2026-08-31).**

The first pass checked the money path and found it healthy. The second checked the paths it had not
touched, and the install path was broken for exactly the audience this server is for.

**`init --write` did nothing when an agent ran it.** The documented way in is to ask a coding agent
to run `npx @pofky/asc-mcp init --write`. An agent has no terminal, so it took the non-interactive
branch, which printed one line of advice and exited: no config written, no config block printed,
even with the `.p8` already found and `ASC_ISSUER_ID` already set. Reproduced against the published
1.9.5 before anything was changed. `init` now takes `--issuer`, `--key-path`, `--key-id`,
`--license` and `--config`, falls back to the matching `ASC_*` variables, always prints the block,
and writes it with `--write`. It refuses to invent a missing Issuer ID, and refuses to choose
between several client configs. Seven new tests drive the built CLI with stdin piped.

**The four-day renewal grace could never fire, and now can.** `shouldBeActive` writes `active = 0`
as soon as the paid period end is in the past, and `isLicenseUsable` returned "inactive" before it
reached the grace branch, so the window only ever applied when no webhook arrived at all. The
customer it was written for is the one in card retry. Grace now applies to a lapsed paid row inside
the window; revocation is identified by `revoked_at` and stays terminal; cancellations and trials
still get nothing; `/key` and `/trial` read the same rule. Deployed, and proven on the live worker
with a synthetic row: in-window `grace: true`, six days out inactive, revoked-in-window refused.
`POST /key` with a JSON body returns 400 instead of 500. Test row deleted afterwards.

**Verified live, published package, real Apple account.** 41 tools, free reads working, the Pro gate
refusing with the trial copy, `asc_start_trial` handing a subscriber their paid key, `list_reviews`
working in the same session with no restart, `release_preflight` and `daily_briefing` answering
against real apps. Trial mail accepted by Brevo (`key_emailed = 1`). Bundle builds.

**Not shipped: npm 1.9.6.** The sandbox blocked `npm run release`, so npm `latest` is still 1.9.5 and
the broken `init` is still what users get. One command, from a terminal.

**The competitor.** Heimdall, `erayendes/app-store-connect-mcp`: MIT, free, 890 tools, 47 stars,
created 19 July, and it publishes to the MCP registry under the name `asc-mcp`. Its npm `latest`
took 356 downloads last week against our 66. Any directory search for "asc-mcp" now finds it first.

### Earlier today

**The zero-subscription month, audited (2026-08-31).**

No new subscription since 5 August, so the whole money path was checked against production instead
of against the code. It works. npm `latest` is 1.9.5 and matches the repo, a clean `npx` install
with no environment starts in setup mode and prints the real fix, `POST /trial` minted a live key
for a throwaway address and `/validate` returned Pro (row deleted afterwards, confirmed by count),
the worker is healthy, `/go` redirects with attribution, the Polar org is `active` and the product
is live at $9 USD, and Polar has recorded **zero failed payments** since the org was created.
Nobody has entered a card and been refused.

**What is actually wrong is the traffic.** Once registry mirrors are subtracted, npm `latest` is
66 downloads a week, not the ~500 the headline number suggests: the rest is spread evenly across
every historical version. GitHub shows 10 unique repo visitors in 14 days and 0 stars. The licence
database holds 4 trials ever, the last on 16 August, and 5 paying rows. Polar's 35 checkout
sessions are not a demand signal either: every GET of the buy link creates one, and two of today's
are this audit's own curls.

**Fixed.** The site's Pro button linked straight to Polar, so buy intent from the only marketing
page was never counted, which is why `intent_events` held two `checkout_click` rows in a month. It
now goes through `/go?tool=site_pricing`, deployed and confirmed on the live page. The site still
has no analytics of any kind; the stored Cloudflare token has no RUM scope, so that is an operator
step, written down rather than left implicit.

**Added.** `DISTRIBUTION.md`, with the measured numbers in section 8 and the ordered work at the
bottom, and a real `HANDOFF.md` in place of the scaffold. Three items are terminal-doable now: the
registry description PulseMCP mirrors, the Show HN already written in `launch/`, and the Reddit and
X drafts next to it.

## Previously
**Full-journey verification, no money spent (2026-08-11).**

Drove the whole thing end to end: fresh `npx` install, live Apple API, the licence worker running
locally against a local D1, and one real write to a real app. 23 of 24 licence-server assertions
pass, every free and Pro tool answers live, and the write was confirmed by reading Apple's API
directly rather than by trusting the tool that made it.

**Verified working.** `npx -y @pofky/asc-mcp@latest` on a clean directory with only `ASC_ISSUER_ID`
set auto-discovers the `.p8` and reports 1.9.5 with 41 tools and 6 prompts. Live auth against
App Store Connect, 8 apps listed. Free/Pro gating: `list_reviews` and `update_version_metadata`
refuse on free with the trial + checkout copy, and unlock the moment `asc_start_trial` returns, with
no restart. Pro intelligence tools all answer live (`release_preflight`, `daily_briefing`,
`keyword_insights`, `metadata_diff`, `triage_reviews`). `sales_report` correctly asks for the vendor
number instead of failing. Outward-facing guards hold: `submit_for_review` and `release_version`
both refuse without `confirm: true`. `init` in a real terminal prints the full paste-ready config.
`npm run mcpb` builds a 3.3MB bundle. Every public URL is up, and `/go` still redirects to the live
checkout with the tool name attributed.

**The real write.** `update_version_metadata` set `promotionalText` on Adaptale's unreleased 1.0
draft, and an independent JWT-signed read straight from `api.appstoreconnect.apple.com` confirmed the
value. Restored to `null` afterwards, confirmed the same way. Nothing was submitted or released.

**Licence server, 23/24.** Trial mints, validates, is idempotent, and is anchored to the Apple
account rather than the email, so a second address does not buy a second week. Last week's
regression stays fixed: a paid customer who never trialled gets their subscription key back from
`/trial`. Cancellation is not revocation, revocation is terminal and no later activate resurrects
it, renewal restores a lapsed row. On the security side, forged signatures, replayed timestamps and
another product's subscription all mint nothing, and an unknown key returns free rather than an
error. Prod secrets confirmed correct: `BREVO_API_KEY` set, and `POLAR_WEBHOOK_SECRET_SANDBOX`
deleted after the last sandbox run, so a sandbox signature cannot mint a real licence.

**Finding: the 4-day grace window is unreachable through the webhook path.** `shouldBeActive`
returns 0 whenever an active-type event carries a `current_period_end` already in the past, and
`isLicenseUsable` checks `active` and returns `inactive` before it ever reaches the grace branch. So
the grace only ever applies when NO event arrives. `DEAD_STATUSES` deliberately excludes `past_due`
so a customer in card-retry keeps access, and this silently overrides that. Reproduced: a
`subscription.created` two days past its period end lands `active=0`, and both `/validate` and
`/key` treat that customer as having nothing. Not fixed here: it is payment semantics on a worker
with paying customers, so it wants a decision and a deploy, not a drive-by edit.

**Two smaller ones.** `POST /key` with a JSON body throws out of `formData()` into the catch-all and
returns 500 `Internal error` where it should return 400; the browser form is unaffected, but
anything watching error rates reads it as the licence server falling over. And `init` in a
non-interactive shell prints only a hint, never the config block, even when the `.p8` was found and
`ASC_ISSUER_ID` is already in the environment, which is exactly the case where it could print it.

**The checkout gap, closed the same day, with a real Polar sandbox purchase.** No card was typed and
none was needed: a 100%-off sandbox discount takes the checkout to `total_amount: 0` and
`is_payment_form_required: false`, so `POST /v1/checkouts/client/{secret}/confirm`, the same call the
hosted page makes, completes a genuine subscription. A quick Cloudflare tunnel put the local worker
on a public URL, a sandbox webhook endpoint was pointed at it with a known secret, and
`POLAR_WEBHOOK_SECRET_SANDBOX` + `POLAR_EXTRA_PRODUCT_IDS` were set locally only, never in prod.

Polar delivered `subscription.created`, `.active` and `.updated`; all three verified and provisioned
a `pro` row against the real subscription id. `/key` returned that key to the browser form,
`asc_setup_check` reported "Pro: all tools unlocked" against live Apple auth, and `asc_start_trial`
on the purchaser's address returned the paid key rather than a refusal, which is the first-customer
bug reproduced fixed against a real Polar row instead of a synthetic one. Cancel-at-period-end via
the Polar API produced a real `subscription.canceled` and the key stayed `pro` through
2026-09-11, and revoking produced `subscription.revoked` and dropped it to free immediately, with the
MCP re-gating Pro tools on the next start. Sandbox webhook endpoint and discount both deleted
afterwards; the tunnel and the local worker are down and `.dev.vars` is gone.

**Still not covered.** Polar's card form itself, since nothing was ever charged. No submission,
release, binary upload or TestFlight distribution against a live app.

**Glama's "Build failed for asc-mcp" was Glama's infrastructure, not ours (2026-08-10).**

The 8 August failure email points at a build spec test. Read with the maintainer login, the log says
`DockerBuildError: aborted`, `ECONNRESET`, after 15 minutes, with three log lines total, dying at
`[internal] load metadata for docker.io/library/debian:trixie-slim`. It never reached `pnpm install`.
Nothing in this repo was involved.

**Glama does not use a Dockerfile from the repo.** It generates one from the per-server config at
`/admin/dockerfile`: base image, Node version, build steps `["pnpm install","pnpm run build"]`, CMD
`["mcp-proxy","--","pnpm","run","start"]`, plus placeholder env values. A `Dockerfile` committed here
is therefore invisible to Glama. Ours was still added and verified, because Smithery, self-hosters
and any other sandbox do read it.

**The server itself is healthy on every path that build would have exercised.** Verified in a
container: credential-less start reaches setup mode and answers `initialize` + `tools/list` with
`asc_setup_check` and `asc_guide`; started with Glama's exact placeholder values, including a
`/app/private_key.p8` that does not exist, it still starts and lists all 41 tools. 210 tests pass.

**Resolved, and the spec now matches what we actually test.** Their build steps ran `pnpm install`
against a repo that ships `package-lock.json` and no pnpm lockfile, so the listing config is now
`["npm ci","npm run build"]` with CMD `["mcp-proxy","--","node","dist/index.js"]`. Verified before
saving by rebuilding their generated Dockerfile locally with those two changes: image builds clean,
and the container comes up through `mcp-proxy` with a successful `initialize` reporting asc-mcp
1.9.5. Glama's own build then passed, `019fea65-3609-7899-965e-f8bbb5995bc8`, success in 18.2s
against the 15-minute timeout that preceded it.

**The lesson for next time.** A Glama build failure is not evidence of a bug here. Read the test log
before touching the repo: the build spec lives on their admin page, not in this tree.

**v1.9.3, and the paying-customer bug that only a real install could find (2026-08-06).**

All four surfaces on 1.9.3: npm, the MCP registry, the GitHub release with the bundle, and the
licence worker. 5/5 active subscriptions re-validated as pro afterwards. `npx -y @pofky/asc-mcp`
from a clean directory returns 41 tools and reports 1.9.3.

**The bug.** Installing the `.mcpb` and running the documented flow as a paying customer produced
"No new trial is available for that address", which is the refusal meant for someone whose free
trial is spent, shown to someone who is actively paying. `/trial` only returned a paid key when the
same machine also held a trial row, which covers the convert-mid-trial case and nothing else.
Everyone who subscribed without trialling, or who set up a second machine, was refused, and every
one of the five live subscriptions has a null `trial_fingerprint`, so it was failing for all of
them. `requirePro` tells them to do exactly this: "call asc_start_trial with the same email and it
will fetch your paid key."

The fingerprint check was also worthless as security: `/key` renders a licence key on screen for an
email address alone, no second factor, so the guard demanded strictly more than the front door.
Removing it disclosed nothing new. **Mailing the key from `/key` instead of displaying it is the
real fix and is still open.**

Verified on a local worker with a seeded D1 before deploying, across five paths: paid-with-no-trial
now returns the subscription key, repeat calls idempotent, a new user still gets a real 7-day trial,
a spent trial still refused, and personal-trial-then-work-email still returns the paid key.

**The second bug the same install found.** A one-click install has no server block in any client
config, so key persistence failed and the tool told the user to hand-edit JSON that does not exist,
immediately after they chose the path whose point is that there is no JSON. The manifest now sets
`ASC_INSTALL=mcpb` and the message points at the extension's own License key field.

**Three bugs in the release script itself, all found by using it.** It launched `mcp-publisher
login` inline and hung forever on a device approval that never came, holding a dirty tree with the
version already bumped. It selected the workflow run with `--limit 1` and picked up the previous
release's run, waited on that run's old failure, re-ran the wrong workflow and got the real one
cancelled as collateral. And it shipped 1.9.2 with `--generate-notes`, whose body was a bare compare
link on what is now the primary download page. All three fixed: it fails with instructions rather
than blocking, matches the run by tag, and reads hand-written RELEASE_NOTES.md.

**GitHub Actions failed or stalled four times today** on this account, twice with "Failed to resolve
action download info, Service Unavailable" before reaching any of our code, and once leaving a run
queued for over twenty minutes. The registry is published locally with `mcp-publisher`; the workflow
is a fallback the script will wait on, never the plan. The token lasts about five minutes, so run
`mcp-publisher login github` immediately before `npm run release`.

**v1.9.1 shipped: one-click install, and releases no longer depend on GitHub Actions (2026-08-06).**

Verified live on all three surfaces: npm 1.9.1, the GitHub release with the `.mcpb` attached (the
downloaded asset's sha256 matches the local build byte for byte), and the MCP registry at 1.9.1
carrying the new description. `npx -y @pofky/asc-mcp@1.9.1` from a clean directory hands back 41
tools, 6 prompts and a handshake reporting 1.9.1.

**The release half-landed on the first attempt, which is the lesson.** npm published fine, then the
tag-triggered registry workflow failed with "Failed to resolve action download info, Service
Unavailable" before it reached any of our code, leaving npm at 1.9.1 and the registry at 1.9.0. A
re-run fixed it, but the shape of the failure is the problem: the registry publish existed only as
a GitHub Actions workflow, and this account has no paid plan, so that is a dependency we do not
control on the one step that feeds every downstream directory.

`npm run release -- <version>` now does the whole thing from this machine: version bump in both
files, lint, tests, docs regen, bundle build, a handshake assertion that the server announces the
version it was built as (the 1.8.6 drift bug), then tag, push, npm publish, GitHub release with the
bundle, and `mcp-publisher publish` locally rather than via the workflow. It finishes by reading
npm, the release assets and the registry back and failing loudly if any one of them is not on the
new version. The workflow stays as a backstop; publishing twice is harmless because the registry
rejects a version it already has. `--dry` runs every gate and publishes nothing.

**The `.mcpb` bundle is the real feature.** Claude for macOS and Windows installs it in one click and
collects config natively: a file picker for the `.p8`, one text field for the Issuer ID. Building it
exposed two bugs that only appear on that path, both found by extracting the bundle and running the
server the way the client would rather than by reading the manifest spec. The Key ID was only ever
derived from keys sitting in `~/.appstoreconnect/private_keys`, so a file picker (which almost never
returns a path there) would have failed every install with "missing credentials" while holding a
file whose name contains the missing value. And an optional config field left blank arrives as the
literal `${user_config.asc_license_key}`, which was being posted to the licence server on every
start. Both fixed, both tested, 186 tests.

Smithery, which prompted all of this, turned out to be the wrong question: it no longer lists a local
server from a repo plus a yaml, only a hosted HTTPS server (impossible when the `.p8` must not leave
the machine) or a prebuilt `.mcpb`. The yaml written that morning was deleted.

**Glama analytics, the traffic we never knew we had (2026-08-06, measured).**

Claiming the Glama listing unlocked an analytics tab, and it says the distribution model in this
worklog has been wrong. Last 30 days on that one directory: **1,377 search impressions, 0 search
clicks (0.0% CTR), 845 profile views, 0 tool calls.** Compare 28 unique GitHub visitors in 14 days,
which is the number every prior decision was based on.

Three things follow.

**Glama is the largest known traffic source, by an order of magnitude.** 845 profile views a month
means the README, which is what renders on that profile, is the highest-traffic sales page the
project has. Higher than the landing site as far as anyone can prove. Until today it said
`$9/monthnth` in the header link and the Pro heading.

**0 clicks on 1,377 impressions is not bad luck, it is the snippet.** Glama search was showing an
April-era description, "An opinionated MCP server for App Store Connect that provides 13 curated
tools", for a server that has had 41 since v1.9.0. Replaced today with a 383-character version
(the field caps at 400, undocumented). This gives a clean before/after: the baseline is 0.0% CTR on
the old text. **Re-read this tab on 13 August and 6 September.** If CTR is still 0 with an accurate
snippet, the problem is ranking or category placement, not copy, and that is a different fix.

**0 tool calls is not a signal.** That counts Glama's in-browser runner, which cannot execute a
stdio server that reads a local `.p8`. It will always be 0 and should never be optimised for.

The listing was also 17 commits stale, last synced from `d9b23c2` on 5 August, so it was serving a
pre-v1.9.0 build with 40 tools and no trial. Synced manually; it auto-syncs daily from here.

**What this changes.** Directory presence was ranked as a slow SEO play. It is in fact the only
measured demand in the project, and the surfaces are cheap. Steps 2 to 4 in
`launch/operator-steps.md` (mcpservers.org, mcp.so, Smithery) went from speculative to the highest
expected-value work available, since each is plausibly another few hundred impressions a month and
each takes minutes. Do them before writing anything else.

**Distribution pass and the first field-notes page (2026-08-06).**

The funnel is not the problem. 1 paid out of 28 unique visitors in 14 days is a working funnel with
almost nothing in it, so this session went at the numerator. Glama alone indexes twenty App Store
Connect MCP servers, which reframes "0 stars against competitors at 46, 24 and 11": the gap is
presence on the surfaces that rank, not social proof.

The three awesome-lists turned out to be three unrelated mechanisms, only one of which is a pull
request. `punkpeye` PR [#11198](https://github.com/punkpeye/awesome-mcp-servers/pull/11198) is open
and its entry was corrected twice today, first from the v1.8-era "40 job-shaped tools" to 41, then
for two overclaims an independent check caught. `wong2` states in its README that it does not accept
PRs at all and generates the list from mcpservers.org submissions. `appcypher` is archived, so it can
never be changed by anyone, and it is now recorded as a dead end rather than a to-do.

Two overclaims were shipping in that entry and would have shipped in three more places.
"Territory pricing" implies per-region prices we do not set: `create_subscription` takes a USA price
and lets Apple equalize across ~175 territories, which is territory *availability*. And "six tools
are free with no account" is only true of three, since `list_apps`, `app_details` and `review_status`
read from Apple and need the user's own API key. Corrected in the PR, the wong2 branch, the
mcpservers.org submission text, and `site/llms.txt`, which had carried the loose version since launch.

**What actually moved.** `glama.json` claims the Glama listing, which was sitting there unclaimed and
therefore, by Glama's own notice, with limited discoverability. `smithery.yaml` makes a Smithery
listing possible. The registry description was rewritten from "Drive App Store Connect end to end" to
"41 tools to ship an App Store release" (94 chars, limit 100), because that string is what PulseMCP
and Glama mirror verbatim and the nearest registry competitor advertises "982 tools from Apple's
OpenAPI spec". PulseMCP turned out to need no submission at all: it pipes `server.json` from the
official registry, so its April 2026 read-only description fixes itself at the next release publish.

**`site/writing/license-server/`, the incident catalogue as a public page.** Seven failures from the
licence worker, written up from the comments already in `logic.ts`. It exists for two reasons: it is a
credibility asset for a paid dev tool, and it is a zero-build demand test for the idea that the
non-App-Store half of the worker should be a package for other MCP sellers. The CTA asks anyone who
wants that to open an issue, which is cheaper than building it and guessing.

Three independent agents audited it before anything was pushed. The fact-check confirmed all seven
incidents against source, and caught that "428 lines of comments wrapped around about 150 lines of
code" was wrong in both halves (it is 224 code, 164 comment). The SEO/AEO audit found five blockers:
title one character over, meta description 239 against a 160 limit, all four FAQ JSON-LD answers
paraphrasing rather than matching the visible copy, no `<main>` landmark, and `--dim` at 4.26:1
failing WCAG AA. All fixed, and the contrast one is inherited from the homepage palette, so the
homepage has the same defect on its footer and eyebrow text and now needs the same change.

Still on the operator, browser only, about five minutes total: claim the Glama listing, resubmit to
mcpservers.org (we are there under `pofky/appstore-connect-mcp`, a slug from the retired package
name), check mcp.so, create a Smithery account. Paste-ready text for each is in `launch/`.

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
