# Handoff: appstore-connect-mcp

Updated 2026-09-03. Branch `master`.

## Where things stand

**A fourth full flow audit found nothing broken.** Every surface matches the
repo, 1.9.7 is live everywhere, both suites are green, and the money path works
end to end against production. The list of what was actually driven is below,
and it is long: this is not a code problem.

**What it did find is a missing flow, and it is the one that explains the
revenue.** Six trials have been minted since 7 August 2026 and not one
converted. After a trial expires the price appears in exactly one place, inside
a tool call the person has to make first, in an agent transcript they may never
scroll back through. Nothing ever reached them again, and nothing told them the
clock was running while it still mattered.

Both halves are built, tested and committed in `40c366e`:

- The licence worker gets a daily cron, `runTrialReminders` at 15:00 UTC. One
  mail the day before expiry, while the key still works and trying
  `release_preflight` costs nothing. One the day after, saying what stopped
  working and what $9 turns back on. Both through the counted `/go` redirect
  with the address prefilled, so the click lands in `intent_events`. Idempotent
  by column (`trial_ending_emailed_at`, `trial_lapsed_emailed_at`), so a double
  fire cannot mail anyone twice and a failed send retries tomorrow instead of
  being marked done. The lapsed window is three days, which is also what stops
  the first run writing to the four trials that expired in August.
- The package stops hiding the clock. `asc_setup_check`, `doctor` and the
  startup line read the expiry `/validate` has always returned: a fact at five
  days out, a warning naming the price at two. A subscription is untouched, no
  countdown and no upsell.

**None of it is live.** The D1 migration, `wrangler deploy` and `npm publish`
were all refused by the sandbox classifier. That is the first thing the next
session or the operator does, and the order matters.

## Next in order

1. **Run `launch/operator-deploy-trial-reminders.txt`**, top to bottom. The
   migration must precede the deploy: the cron reads two columns that do not
   exist in production yet. It also carries the two cleanup deletes this audit
   could not run, and `npm run release -- 1.9.8` for the package half.
   `RELEASE_NOTES.md` is already written for 1.9.8 and `npm run release --
   1.9.8 --dry` passes.
2. After the deploy, confirm the trigger took:
   `npx wrangler deployments list -c license-worker/wrangler.toml` and check the
   Cloudflare dashboard shows a cron on the worker. The first run sends nothing;
   the first real send is **8 September**, for the trial expiring on the 9th.
3. Publish the improved registry description so PulseMCP stops mirroring the
   April read-only copy (`launch/distribution-checklist.md` has the resync path).
4. Post the Show HN sitting in `launch/`, then the r/iOSProgramming and X drafts.
5. Operator, browser: claim Glama, submit to mcp.so, turn on Cloudflare Web
   Analytics for the site. The site still has no analytics at all, so its visit
   count is unknown.

## Done, and verified, 2026-09-03

Against production and the published package, not read from the code:

- npm `latest` is 1.9.7 and matches the repo. The registry has 1.9.7. The site
  serves 1.9.7.
- Clean-environment start with no credentials: setup mode, 2 tools, the real fix
  on stderr, and `asc_setup_check` naming all three missing values.
- `init` with a discoverable `.p8` and no issuer explains what it cannot ask for
  in a non-interactive shell. `init --write --issuer <uuid>` prints the block
  when no client config exists and writes it correctly into a real
  `~/.claude.json` when one does.
- Free tier with real Apple credentials: 41 tools, live `list_apps` over 8 real
  apps, and `update_version_metadata` / `daily_briefing` / `keyword_insights`
  all refusing with the trial-first copy and a `/go?tool=<name>` link.
- A live trial mint: key returned, written into the client config, all 41 tools
  unlocked **in the same session** (proved by `metadata_diff` answering
  immediately after), and a repeat call returning the same key.
- Pro reads live: `release_preflight`, `daily_briefing`, `keyword_insights`,
  `metadata_diff`, `app_details`, `list_reviews`, `asc_guide`, `sales_report`
  (which correctly asks for the vendor number it cannot know).
- Confirm gates refuse without `confirm: true` (`submit_for_review`,
  `release_version`), `set_app_availability` refuses to guess, a bogus app id
  returns Apple's message plus what it usually means, and a missing argument is
  named.
- **Node 18.20.8**: the published package installed and driven over stdio, 41
  tools, live `list_apps`. The ESM regression is still fixed.
- CLI: `help`, `version`, `doctor` in both tiers, `install-skill` (install,
  re-install, uninstall, uninstall-when-absent), and an unknown command exiting
  instead of hanging on stdio.
- Worker: `/health` 200, `/go` 302 to a checkout that resolves to a live payable
  Polar session, `/key` `/privacy` `/terms` `/success` 200 to both GET and HEAD
  with the CSP and `nosniff` headers, `/admin/*` 401, an unknown route 404, and
  `/validate` returning `{"valid":false,"tier":"free"}` for a bogus key. The
  inline favicon is in every page's head, so no transactional page logs a 404.
- The deployed worker matches the repo: the last deploy is 31 August 11:46 UTC,
  seconds before the commit that produced it.
- The site: 200 on the page, `robots.txt`, `llms.txt`, `sitemap.xml`; every
  outbound link accounted for; the Pro CTA is the counted
  `/go?tool=site_pricing`; renders correctly at 375px with **zero console
  messages of any level**.
- Polar: the `asc-mcp` org holds exactly one order (5 August, paid) and one
  subscription (active, renewing **5 September**). 36 checkout sessions, all
  expired, and most of them are audit curls, see the trap below.
- The reminder cron itself, fired against a local worker with a seeded D1 and a
  deliberately invalid Brevo key: it selected exactly the two due rows, skipped
  the 20-day-old one, and left both **unstamped** when the sends failed, which
  is what makes tomorrow's retry correct.
- 234 package tests, 62 worker tests, `tsc --noEmit` clean in both.

Not re-driven, and why: a real metadata write with `confirm: true`, the
`intent_events` cleanup and every production write were refused by the sandbox
classifier. The write path was proven live on 31 August (Adaptale's
`promotionalText`, read back through an independently signed request, then
reverted) and nothing has touched it since.

## The funnel, measured today

- npm `latest` (1.9.7) 203 downloads last week. Treat that as inflated: 1.9.7
  shipped on 31 August and mirrors pull a new version hard. 1.9.6 took 152 in
  the same week without being current.
- 13 licence rows total: 7 paid (5 of them in the old Polar org), 6 trials.
- **6 trials, 0 conversions.** That is the number this session's work is aimed
  at, and it is why the diagnosis has moved from "no demand" to "no follow-up".
- One trial is running right now: `info@7stock.app`, started 2 September by
  `set_app_metadata`, expires 9 September. The first person the reminders reach.
- One `site_pricing` checkout click on 2 September produced no Polar session, so
  it was almost certainly a fetch that never followed the redirect.

## Traps

- **Production writes are blocked in an agent session.** `npm publish`,
  `npm run release`, `wrangler deploy`, `wrangler d1 execute` with anything but
  a SELECT, and an MCP tool call carrying `confirm: true` are all refused by the
  sandbox classifier. Do not burn turns retrying: put the command in a
  paste-ready file and hand it over.
- **This audit left two rows in production it could not delete.** A trial for
  `povkonop+ascverify0903@gmail.com` (key works, expires 10 September) and
  `intent_events` rows for the tools `verify_pass` and `audit_followed`. Both
  deletes are in `launch/operator-deploy-trial-reminders.txt`.
- **`expires_at` holds two timestamp shapes.** `/trial` writes
  `2026-09-09T17:53:55.163Z`; anything built from SQLite's `datetime('now')`
  writes a space where the T goes, and a space sorts below T. Any string
  comparison on that column needs `replace(expires_at, ' ', 'T')`, which is what
  the reminder query does. A raw `BETWEEN` silently drops rows.
- **npm downloads lie.** Mirrors spread hundreds of pulls across every version.
  Only `latest` is a human number, and only once the release is a week old:
  `https://api.npmjs.org/versions/@pofky%2Fasc-mcp/last-week`.
- **Every GET of the `buy.polar.sh` link creates a Polar checkout session.**
  Polar's checkout count is not a demand metric; only `orders` and `payments`
  are. `keyword_insights` also takes 15 to 25 seconds because it makes 14 iTunes
  Search calls, so a driver with a short timeout looks like a hang.
- **`npm publish` from this machine leaves the version "staged"** for four to
  ten minutes. It is a slow release, not a failed one. `scripts/release.mjs`
  waits for the registry, and pushes the tag only after npm confirms the version,
  because the registry workflow refuses a version npm cannot see.
- The Cloudflare API token in Keychain has no RUM scope, so Web Analytics cannot
  be created from a terminal. Do not spend time on it again.
- The licence emails still come from `license@brewist.app`, another product's
  domain. Nothing is broken and deliverability is fine; the fix costs about $12
  a year and is the operator's call. The code already reads
  `BREVO_SENDER_EMAIL`, so it needs no deploy, only
  `npx wrangler secret put BREVO_SENDER_EMAIL -c license-worker/wrangler.toml`.
  The three new reminder mails inherit the same sender.
- There is still a competitor: Heimdall (`erayendes/asc-mcp`, MIT, free, 890
  tools) is at 2.3.0 in the registry under the same short name and outranks us
  in directory search.

## Environment

- Polar org token: `/Volumes/T7/Projects/.polar-token` (scoped to `asc-mcp`).
- Licence D1: `asc-mcp-licenses`, queried with
  `npx wrangler d1 execute asc-mcp-licenses --remote --command "..."` from the
  repo root (not from `license-worker/`). Add `--local` plus
  `-c license-worker/wrangler.toml` for the local copy, which now has the
  schema and all three migrations applied.
- A Node 18 binary to test the engines floor:
  `npx -y -p node@18 which node`.
- Site deploy is explicit, the Pages git integration does not fire:
  `npx wrangler pages deploy site --project-name asc-mcp --branch master`.
- Cloudflare token: `security find-generic-password -s cloudflare-api -w`.
- ASC credentials for driving the server: key `V46UBZ9L93` in
  `~/.appstoreconnect/private_keys/`, issuer
  `d6dd27de-f131-4908-8d76-e81ba84c2160`.
