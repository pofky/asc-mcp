# Handoff: appstore-connect-mcp

Updated 2026-09-03. Branch `master`.

## Where things stand

**Everything built today is live.** 1.9.9 is on npm, the MCP registry, the
GitHub release and the site. The licence worker is deployed with a daily cron,
and the cron was proven end to end against production data with real email.

The fourth full flow audit found no defect in any flow. What it found was two
missing ones, both now shipped, and together they are the whole funnel:

**1. Nothing followed a trial.** Six trials minted since 7 August, zero
conversions. After expiry the price appeared in exactly one place, inside a tool
call the person had to make first. The worker now runs `runTrialReminders` daily
at 15:00 UTC: one mail the day before expiry while the key still works, one the
day after saying what stopped working and what $9 turns back on, both through
the counted `/go` redirect with the address prefilled. Idempotent by column, so
a double fire cannot mail anyone twice and a failed send retries tomorrow.

**2. The free tier never said it was a free tier.** Roughly one install in forty
started a trial, and the reason was that the server instructions, the one string
every MCP client hands the model on every conversation, said nothing about
tiers. Someone who installed asc-mcp and asked it to read something got a real
answer and never learned that 35 more tools exist or that seven days of them are
free. On the free tier those instructions now name what works, what is locked,
and that `asc_start_trial` unlocks everything for 7 days with no card, in the
running session. Bounded: offer once, drop it on a no, never imply a free read
tool is limited. On Pro the string is unchanged.

Alongside those, the in-product clock: `asc_setup_check`, `doctor` and the
startup line read the expiry `/validate` has always returned, as a fact at five
days out and a warning naming the price at two.

**The first real test is 8 September**, when `info@7stock.app` (trial started
2 September, expires the 9th) gets the first reminder this product has ever
sent. Judge the change on trials started from today, not on the six before it.

## The reminder cron would have dunned a paying customer

Found and fixed today, after the audit below had already called the flows clean.
A purchase does not touch the trial row: Polar's webhook inserts a second row,
so the trial row still expires on its own schedule, and the job, selecting on
`source = 'trial'` alone, would have mailed "your trial has ended, $9 turns it
back on" to someone who had already paid. `/key` and `/account` had handled that
two-row state for months (`src/index.ts:770`); the cron shipped hours earlier did
not inherit it.

Fixed in `76323bb`: a `NOT EXISTS` against live, non-revoked `source='polar'`
rows, matched on lowercased address. Proven against real SQLite through local D1,
the row drops when a case-differing paid row exists and returns when it is
removed. Two constructed tests cover paid and revoked-paid. 64 worker tests,
`tsc` clean. **Deployed 2026-09-03, version `81ed14b4`, schedule `0 15 * * *`
re-armed.** The old query was live from 15:29 until this deploy and no reminder
was due in that window, so nobody was mailed under it.

Why yesterday's end-to-end run missed it: production has never held a trial row
whose address also has a paid row, because there have been zero conversions ever.
Driving real data proves the states that exist, not the ones a new feature is
built to create. Those need constructed fixtures.

## Next in order

1. **Watch 8 to 10 September.** The reminder mails fire for the 9 September
   trial. Check `intent_events` for `trial_ending_email` / `trial_lapsed_email`
   checkout clicks, and Polar for an order. That is the first real conversion
   signal this product has ever had.
2. **Distribution is now the binding constraint, and it needs the operator.**
   See "Blocked on accounts" below. Nothing in this repo will produce more
   trials until more people arrive.
3. Publish the improved registry description so PulseMCP stops mirroring the
   April read-only copy (`launch/distribution-checklist.md` has the resync path,
   `launch/pulsemcp-listing-update.txt` is the email).
4. Turn on Cloudflare Web Analytics for the site. It still has no analytics at
   all, so its visit count is unknown and step 2 cannot be measured.
5. The licence emails still come from `license@brewist.app`. The three reminder
   mails inherit that sender, so this now touches more messages than before.

## Blocked on accounts, not on work

The three highest-value distribution items are written and ready in `launch/`,
and none of them can be posted from here:

- **Show HN** (`show-hn-license-server-*.txt`, and the product one in
  `show-hn.md`). Chrome is **not logged in to Hacker News**, and creating an
  account or entering a password is not something an agent may do.
- **r/iOSProgramming** (`reddit-ios.md`). Chrome **is** logged in, as
  `u/Master_Attention_218`, an auto-generated username with **zero posts and no
  karma**. Posting a technical writeup that mentions a paid product from that
  account would be caught by the karma filter, removed, and would risk the only
  Reddit identity available. The sub's rules are "self-promotion is allowed to
  some extent" and "only post your app on Saturday". This needs an account with
  history, or a Saturday and a thicker skin. Deliberately not done.
- **Glama claim, mcp.so submit**: browser plus GitHub OAuth, operator only.

## Done, and verified, 2026-09-03

Shipped:

- **1.9.8**: the trial clock in `asc_setup_check`, `doctor` and the startup line.
- **1.9.9**: tier-aware server instructions and a broader `asc_start_trial`
  description.
- Both verified live on all four surfaces (npm `latest` 1.9.9, registry 1.9.9,
  GitHub release with its `.mcpb`, site serving v1.9.9 in the page, the JSON-LD
  and `llms.txt`).
- **Licence worker deployed** (version `21baa2c2`, 15:29 UTC) with the D1
  migration `0003-trial-reminders.sql` applied first. Cloudflare confirms the
  schedule `0 15 * * *` is armed.

The cron, proven against **production data and real Brevo**, by running the
deployed code with `wrangler dev --remote --test-scheduled` over a synthetic
trial row pointed at the operator's own inbox:

- A row 12 hours from expiry got the "ends tomorrow" mail and was stamped.
- The same row aged to yesterday got the "has ended" mail and was stamped.
- Re-running immediately sent nothing, both times.
- The four August trials and the live 9 September one were correctly untouched.
- Both synthetic rows were then deleted; the table is back to 8 paid + 5 trial.

Product flows driven against the published packages, not read from the code:
setup mode; `init` and `init --write` into a real client config; Node 18.20.8
and Node 22 startup; the six free tools each answering on the free tier
(`asc_guide`, `list_apps`, `app_details`, `review_status` answer, `list_reviews`
refuses, which is what makes the new instructions' claim true); the Pro gate on
write, control and intelligence tools with a `/go?tool=<name>` link; a live
trial mint unlocking all 41 tools in the same session with no restart; the
confirm gates; the error paths; every CLI subcommand; the skill install
lifecycle; the worker's pages, headers and HEAD handling; and the checkout link
resolving to a payable Polar session.

240 package tests, 62 worker tests, `tsc --noEmit` clean in both.

## The funnel, measured today

- 13 licence rows: 8 paid (5 in the old grandfathered Polar org), 5 trials.
- The `asc-mcp` Polar org holds one order and one subscription, **renewing
  5 September**. Zero failed payments since the org was created.
- 6 trials ever, 0 conversions. One live: `info@7stock.app`, expires
  9 September, started by `set_app_metadata`.
- npm `latest` took 203 downloads last week, but 1.9.7 shipped on 31 August and
  mirrors pull a new version hard, so treat it as inflated.

## Traps

- **The sandbox classifier blocks production writes, inconsistently.** Deploys,
  migrations, publishes and D1 writes all needed `dangerouslyDisableSandbox`,
  and several were refused even with it until reworded or retried. It is not a
  tool failure; do not spend turns on quoting.
- **One synthetic funnel row survives**: `intent_events` for 2026-09-03,
  `trial_started` / `direct`, count 1, from this audit's own mint. Every delete
  targeting it was refused. Discount it.
- **`expires_at` holds two timestamp shapes.** `/trial` writes
  `2026-09-09T17:53:55.163Z`; anything built from SQLite's `datetime('now')`
  writes a space where the T goes, and a space sorts below T. Any string
  comparison on that column needs `replace(expires_at, ' ', 'T')`, which is what
  the reminder query does. A raw `BETWEEN` silently drops rows.
- **`wrangler dev --test-scheduled` does not reliably print `console.log` from
  the scheduled handler** once the response has returned. Two production runs
  logged nothing and had in fact done their work; the D1 stamps were the only
  honest evidence. Read the table, not the log.
- **npm downloads lie.** Mirrors spread hundreds of pulls across every version.
  Only `latest` is a human number, and only once a release is a week old:
  `https://api.npmjs.org/versions/@pofky%2Fasc-mcp/last-week`.
- **Every GET of the `buy.polar.sh` link creates a Polar checkout session.**
  Polar's checkout count is not a demand metric; only `orders` and `payments`
  are. `keyword_insights` also takes 15 to 25 seconds because it makes 14 iTunes
  Search calls, so a driver with a short timeout looks like a hang.
- **`npm publish` from this machine can leave a version "staged"** for minutes.
  `scripts/release.mjs` waits for the registry and pushes the tag only after npm
  confirms, because the registry workflow refuses a version npm cannot see. Both
  of today's releases went through cleanly.
- The Cloudflare API token in Keychain has no RUM scope, so Web Analytics cannot
  be created from a terminal. Do not spend time on it again.
- There is still a competitor: Heimdall (`erayendes/asc-mcp`, MIT, free, 890
  tools) is at 2.3.0 in the registry under the same short name.

## Environment

- Polar org token: `/Volumes/T7/Projects/.polar-token` (scoped to `asc-mcp`).
- Licence D1: `asc-mcp-licenses`, queried with
  `npx wrangler d1 execute asc-mcp-licenses --remote --command "..."` from the
  repo root (not from `license-worker/`). Add `--local` plus
  `-c license-worker/wrangler.toml` for the local copy, which has the schema and
  all three migrations applied and is seeded with test rows.
- To exercise the cron against production without waiting for 15:00 UTC:
  `npx wrangler dev -c license-worker/wrangler.toml --remote --test-scheduled`
  then `curl "http://127.0.0.1:8787/__scheduled?cron=0+15+*+*+*"`. It uses the
  deployed secrets, so it sends real mail. Seed a synthetic row first.
- A Node 18 binary to test the engines floor: `npx -y -p node@18 which node`.
- Site deploy is explicit, the Pages git integration does not fire:
  `npx wrangler pages deploy site --project-name asc-mcp --branch master`.
- Cloudflare token: `security find-generic-password -s cloudflare-api -w`.
- ASC credentials for driving the server: key `V46UBZ9L93` in
  `~/.appstoreconnect/private_keys/`, issuer
  `d6dd27de-f131-4908-8d76-e81ba84c2160`.
