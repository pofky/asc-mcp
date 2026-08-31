# Handoff: appstore-connect-mcp

Updated 2026-08-31. Branch `master`.

## Where things stand

**1.9.7 is live on every surface** (npm, the MCP registry, the GitHub release and
its bundle, the site), and the whole new-user journey was rehearsed against the
published package on both Node 18 and Node 22. Nothing is waiting on anyone.

1.9.7 adds one fix: on day 8 of a trial the setup check said "a license key is
set but did not validate as Pro" and sent the user to look up a key that was
working exactly as designed, hiding the price and the link at the one moment
they matter. It now reads the reason `/validate` already returns.

A third pass drove every flow the product advertises, and found the one that
matters most: **the server never started on Node 18**, which package.json, the
README, the site and the .mcpb manifest all claim to support. `jose` is ESM-only
from v6, this package is CommonJS, and `require("jose")` threw before any of our
code ran on every Node 18 and every Node 20 below 20.19. It is fixed by dropping
the dependency for Node's own crypto, verified live on 18.20.8, and guarded by a
test that walks the dependency tree for ESM-only packages.

1.9.6 carries that fix. Getting it out exposed one more bug, in the release
script itself: it pushed the tag before publishing to npm, so the tag-triggered
registry workflow raced our own publish, asked the registry to register a version
npm did not have yet, and the release half-landed. npm now goes first. Recovered
by publishing and re-running the workflow; all three surfaces verified at 1.9.6.

Two real bugs were found on the second pass, both fixed, and one of them was in
the install path itself: `npx @pofky/asc-mcp init --write` did nothing when an
agent ran it, which is the documented way in. The licence-server fix is deployed
and proven against production. **The npm release of 1.9.6 has not happened**: the
sandbox blocked `npm run release`, so it is one command away and the fix reaches
nobody until it runs. That is the first thing the next session does.

There is also a competitor, and it is material to the revenue question. Heimdall
(`erayendes/app-store-connect-mcp`, MIT, free, 890 tools, 47 stars, created
19 July 2026) publishes to the MCP registry under the name `asc-mcp` and its npm
`latest` took 356 downloads last week against our 66. Directory searches for
"asc-mcp" now surface it above us.

The money path itself is not broken. It was audited end to end against production on
2026-08-31 and every step works. What is missing is people: 66 real installs a
week, 10 unique repo visitors a fortnight, 4 trials ever, 5 paying rows.

The diagnosis for "no new subscriptions since 5 August" is demand, not code. Two
measurement gaps made that hard to see, and one of them is now closed: the site's
Pro button linked straight to Polar, so buy intent from the only marketing page
was never counted. It now goes through the worker's counted `/go` redirect. The
other gap is still open: the site has no analytics at all, so its visit count is
unknown (operator step, see `DISTRIBUTION.md` item 7).

`DISTRIBUTION.md` is new, and it is the plan the next session should work from.
The three terminal-doable items at the bottom of it are the highest-value work
left in this repo.

## Done, and verified

Verified live against production on 2026-08-31, not from the code:

- npm `latest` is 1.9.5 and matches the repo. No publish lag.
- A clean `npx -y @pofky/asc-mcp@latest` with no environment starts in setup mode,
  reports 1.9.5, and prints the real fix on stderr.
- `POST /trial` minted a real key for a throwaway address, `POST /validate`
  returned `{"valid":true,"tier":"pro","trial":true}`, and the test row was
  deleted afterwards (confirmed by count).
- Worker `/health` 200, `/go` 302 to the live checkout with attribution attached.
- The Polar org `asc-mcp` is `status: active`, the product is live, unarchived,
  $9 USD monthly, and the checkout link resolves to a payable session.
- Polar records **zero failed payments** since the org was created. Nobody has
  entered a card and been refused, so the checkout is not losing anyone.
- Site deployed and live at 1.9.5, Pro CTA now on `/go?tool=site_pricing`
  (confirmed by curling the live page after deploying).

The numbers behind the diagnosis, all measured, are in `DISTRIBUTION.md` section 8.

## Next in order

1. Publish the improved registry description so PulseMCP stops mirroring the April
   read-only copy (`launch/distribution-checklist.md` explains the resync path).
2. Post the Show HN that is already written and sitting in `launch/`.
3. Post the r/iOSProgramming and X drafts in `launch/`.
4. Operator, browser: claim Glama, publish to Smithery, submit to mcp.so, and turn
   on Cloudflare Web Analytics for the site.
5. Only after traffic exists: revisit the trial-to-paid step. Four trials is not a
   sample, and tuning a paywall nobody reaches is wasted work.

## Third pass, every flow driven (2026-08-31)

Fixed and verified: Node 18 startup (above); `list_reviews` now prints the review
id `draft_review_response` requires, which is the only way across that step;
`draft_review_response` on a client without Sampling now hands the calling model
the review and the drafting rules instead of saying "draft by hand"; a mistyped
command no longer starts the server and hangs on stdio.

Driven and found correct, against production, not the code:
- Setup mode, `doctor` in both states, `install-skill`/`uninstall-skill`
  (install, re-install, uninstall, uninstall-when-absent), `version`, `help`.
- The .mcpb bundle unpacked and run the way Claude Desktop runs it, with no
  `ASC_KEY_ID` (derived from the filename) and `ASC_INSTALL=mcpb`, on Node 22
  and Node 18. Its manifest declares the three config fields correctly.
- All 41 tool schemas: every tool and every property carries a description.
- Live reads on a real account: `list_apps`, `app_details`, `list_builds`,
  `list_beta_groups`, `keyword_insights`, `metadata_diff`, `release_notes`,
  `review_status`, `daily_briefing`, `release_preflight`, `sales_report`,
  `triage_reviews`, `list_reviews`.
- Confirm gates: `submit_for_review`, `release_version`, `manage_phased_release`
  and `create_version` all refuse without `confirm: true`.
- Error paths: a bogus app id returns Apple's message plus what it usually means,
  `set_app_availability` refuses to guess, missing arguments are named.
- A real write, `promotionalText` on Adaptale's unreleased 1.0, confirmed by an
  independently signed read straight from Apple, then reverted and confirmed the
  same way.
- Licence endpoints: bad email, bad fingerprint, non-JSON body, first mint,
  repeat mint, a second email on the same fingerprint (refused a new key),
  rate limiting (`TRIAL_MAX` is 10, so eight in a row is correct), `/key` form,
  `/key` with JSON (400), `/success`, `/privacy`, `/terms`, `/delete` and
  `/delete/confirm` guards, `/admin/*` 401 without the token, and a 404 route.
- The whole webhook path against a local worker with a known secret: a signed
  `subscription.created` mints an active Pro row, a forged signature 401s, a
  renewal extends, another org's product is ignored, a cancellation keeps access
  to period end, a revoke is terminal, and a replayed active event after the
  revoke does not resurrect it.
- Offline behaviour: with the licence server unreachable, a previously confirmed
  Pro key keeps working from `~/.asc-mcp/last-verdict.json`, and the gate message
  says the key is fine rather than sending a paying customer to check their
  config.
- The licence emails, read in a real inbox. Two defects came out of that and are
  fixed and deployed: the trial email claimed "your agent has already written
  this into your MCP config", which is false for a bundle install and false
  whenever the agent said it could not find one; and its upgrade link was the
  raw Polar URL, so the most valuable click in the product was the only one not
  counted, and it asked the customer to retype an address we already had. Both
  emails now also carry a plain-text alternative.
- The site: every link 200s (npm's 403 is its bot wall, not a broken link),
  robots/sitemap/llms.txt serve, the JSON-LD parses to four types, one h1, and
  the page renders at 375px with zero console errors. The worker's own pages had
  a favicon 404 in the console on every transactional page; fixed and deployed.

## Also done and verified, 2026-08-31 (second pass)

- The published 1.9.5 was driven over stdio with real Apple credentials: 41
  tools listed, `list_apps` and `asc_setup_check` live, the Pro gate refusing
  with the trial copy, `asc_start_trial` returning a subscriber's paid key, and
  `list_reviews` working in the same session immediately afterwards with no
  restart. `release_preflight` and `daily_briefing` answered live against real
  apps with `ASC_LICENSE_KEY` set.
- Trial email delivery: a mint set `key_emailed = 1`, so Brevo accepted it.
- `/key` form returns the page; a JSON body now returns 400, not 500.
- The grace window was proven on the deployed worker with a synthetic lapsed
  row: in-window validates with `grace: true`, six days out returns inactive,
  and a revoked row inside the window stays refused. Row deleted, table clean.
- `npm run mcpb` builds the 3.7MB bundle. The 1.9.5 bundle on the GitHub release
  has 0 downloads, so the one-click path is unused rather than broken.

## Open decision: the licence emails come from another product's domain

Every licence and trial email is sent as `asc-mcp <license@brewist.app>`. The
display name is right; the domain belongs to the coffee-log app. A buyer paying
$9 for a developer tool gets their key from a domain with no connection to it,
and Gmail can show the mismatch. Nothing is broken, deliverability is fine
(Brevo accepted every send today and all five arrived), but it is a trust cost
at exactly the wrong moment.

The fix costs money, so it is the operator's call: register a domain for the
product (asc-mcp.dev or similar, around $12 a year), verify it in Brevo with
DKIM, and set `BREVO_SENDER_EMAIL` on the worker. The code already reads that
variable, so no deploy of new code is needed, only
`npx wrangler secret put BREVO_SENDER_EMAIL -c license-worker/wrangler.toml`.
Nothing else in the product depends on the domain.

## Release mechanics, learned the hard way today

- **`npm publish` from this machine leaves the version "staged".** The upload
  lands, the connection drops before npm acknowledges it, the CLI reports a
  failure, a retry gets `E409 Cannot publish over previously staged version`,
  and the version appears on its own four to ten minutes later. Both 1.9.6 and
  1.9.7 did this. It is a slow release, not a failed one. `scripts/release.mjs`
  now waits for `registry.npmjs.org` to actually list the version.
- **The tag must go after npm.** Pushing it starts the registry workflow, and
  the registry refuses a version npm cannot confirm ("version X was not found").
  That ordering is what half-landed both releases before it was fixed.
- If a release half-lands anyway: publish, wait for npm, then
  `gh workflow run publish-mcp-registry.yml --ref vX.Y.Z`, then deploy the site.

## Traps

- **npm downloads lie.** ~500 a week total, but ~430 of those are registry mirrors
  spread evenly across every old version. Only `latest` (66) is a human number.
  Use `https://api.npmjs.org/versions/@pofky%2Fasc-mcp/last-week`.
- **Every GET of the `buy.polar.sh` link creates a Polar checkout session.** Two of
  today's "open" checkouts are this audit's own curls. Polar's checkout count is
  therefore not a demand metric; only `orders` and `payments` are.
- **`intent_events` for 2026-08-31 contains three synthetic rows** from this audit
  (two `checkout_click`, one `trial_started`). Deleting them was blocked by the
  sandbox classifier. Discount that day when reading the table.
- The Cloudflare API token in Keychain has no RUM scope, so Web Analytics cannot be
  created from a terminal. Do not spend time on it again.
- The grace-window finding from 2026-08-11 is **fixed and deployed**. Grace now
  turns on `revoked_at` rather than the active flag, so anything that reads
  "inactive means revoked" is out of date.
- `npm publish` and `npm run release` are blocked by the sandbox classifier in an
  agent session. Do not burn a turn retrying: hand the command to the operator.
- **CI runs a newer Node than the floor in `engines`.** That is how the Node 18
  breakage survived. `tests/auth-jwt.test.ts` now guards the dependency shape,
  but an actual Node 18 run is still worth doing before a release:
  `npx -y -p node@18 which node` gives you a binary to drive `dist/index.js` with.
- The Polar checkout link is embedded in six files; `scripts/set-checkout-url.mjs`
  rewrites them all. The site's Pro button is now a `/go` link, so the site still
  carries exactly one direct copy, inside the JSON-LD offer.

## Environment

- Polar org token: `/Volumes/T7/Projects/.polar-token` (scoped to `asc-mcp` only).
- Licence D1: `asc-mcp-licenses`, queried with
  `npx wrangler d1 execute asc-mcp-licenses --remote --command "..."` from the
  repo root (not from `license-worker/`).
- Site deploy is explicit, the Pages git integration does not fire:
  `npx wrangler pages deploy site --project-name asc-mcp --branch master`.
- Cloudflare token: `security find-generic-password -s cloudflare-api -w`.
