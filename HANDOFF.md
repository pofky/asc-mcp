# Handoff: appstore-connect-mcp

Updated 2026-08-31. Branch `master`.

## Where things stand

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

0. **`npm run release -- 1.9.6`**, from a terminal. Everything it gates on is
   already green (219 root tests, 39 worker tests, a clean tree, notes written).
   Until it runs, npm `latest` is 1.9.5 and the broken `init` is what users get.
1. Publish the improved registry description so PulseMCP stops mirroring the April
   read-only copy (`launch/distribution-checklist.md` explains the resync path).
2. Post the Show HN that is already written and sitting in `launch/`.
3. Post the r/iOSProgramming and X drafts in `launch/`.
4. Operator, browser: claim Glama, publish to Smithery, submit to mcp.so, and turn
   on Cloudflare Web Analytics for the site.
5. Only after traffic exists: revisit the trial-to-paid step. Four trials is not a
   sample, and tuning a paywall nobody reaches is wasted work.

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
