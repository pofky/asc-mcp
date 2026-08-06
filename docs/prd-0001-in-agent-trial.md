# PRD-0001, In-agent trial and buy-intent instrumentation

Status: in implementation
Author: pofky (with Claude)
Date: 2026-08-06
Type: C (feature)
Surfaces touched: npm package (`@pofky/asc-mcp`), licence worker, D1 schema, landing page, privacy policy, terms

## Problem

Revenue is $27 MRR from 3 subscribers. The measured funnel says the product converts and the
traffic does not exist:

- 9 Polar checkouts in 4 days, 1 paid. Checkout-to-paid is ~11%; warm intent normally lands 30-50%.
  Eight people reached the card form and left.
- 28 unique GitHub visitors in 14 days, near-zero referrers, against 1,727 npm downloads in 30 days.
  The documented launch command is `npx -y @pofky/asc-mcp`, which re-resolves the package on every
  MCP client restart, so downloads count agent sessions, not people. Download-based conversion
  numbers are meaningless here and must not be used to make decisions.
- We have no data on which of the 35 locked tools people actually want. Every pricing, packaging and
  marketing decision to date has been a guess.

Three specific defects follow from this:

1. **The gate is a dead end at the moment of maximum intent.** `requirePro()` in `src/gate.ts`
   fires when a user has just told their agent to submit their app. It returns a bare URL. Acting on
   it means leaving the agent, opening a browser, and entering a card before having seen the product
   work once. That is where the eight checkouts died.
2. **Nothing is attributable.** The Polar link is identical on the site, in the README, in the
   stderr banner and in every gate message, so a purchase cannot be traced to what triggered it.
3. **The trial the pricing page implies does not exist.** Buying is the only way to see any of the
   35 Pro tools run against your own app.

## Non-goals

- No price change. $9/mo stays the headline. Annual and Studio tiers are out of scope here.
- No silent telemetry from the MCP process. See "Privacy position" below; this is a hard constraint,
  not a preference.
- No change to the Polar webhook classification logic, which has been the source of three
  paying-customer incidents and is now correct. Additive reads only.

## Scope

### M0, D1 schema migration

Add to `licenses`:

| Column | Type | Meaning |
|---|---|---|
| `source` | TEXT NOT NULL DEFAULT 'polar' | `'polar'` or `'trial'` |
| `trial_fingerprint` | TEXT | Salted SHA-256 of the user's ASC Issuer ID. NULL for paid rows |
| `trigger_tool` | TEXT | The locked tool whose gate produced this trial. NULL otherwise |

Plus a partial unique index on `trial_fingerprint` (SQLite permits many NULLs), and a new
`intent_events(day, kind, tool, count)` table with a composite primary key, upserted per hit.

Existing rows must come out with `source='polar'` and every current behaviour unchanged. The
migration is additive only: no column is dropped, renamed or retyped, and no `NOT NULL` is added to
an existing column.

### M1, `POST /trial` on the licence worker

Body: `{ fingerprint, email, tool? }`. Mints a 7-day Pro licence.

- `fingerprint` must be 64 lowercase hex chars. `email` must look like an address.
- **Idempotent.** A repeat call for a fingerprint whose trial is still live returns the *same* key
  and the days remaining, never a second row. Re-running the tool must be safe.
- A fingerprint whose trial has ended gets a 409 and the checkout URL, not a new key.
- One trial per email as well as per fingerprint, so rotating the Apple account does not re-trial.
- An email that already has a paid, active licence gets that key back instead of a trial.
- IP rate-limited on the same limiter as `/key`.
- Emails the key through Brevo when configured. Capturing the address is a first-class goal of this
  feature: it is the only owned channel to a free user we have.

### M2, trials must not inherit the paid grace window

`isLicenseUsable` grants `GRACE_DAYS = 4` past expiry so a late renewal webhook never demotes a
paying customer. Applied to a trial that would silently make it an 11-day trial. Grace becomes
conditional on `source = 'polar'`. This is the highest-risk detail in the change: getting it wrong
either extends every trial by 57% or, if over-corrected, cuts off a paying customer whose renewal
webhook is late, which is the exact class of bug that has already hit this product three times.

### M3, `GET /go?tool=<name>` intent redirect

Counts the click in `intent_events`, then 302s to the Polar checkout with
`utm_source=agent`, `utm_medium=mcp`, `utm_content=<tool>` appended, so attribution exists on both
sides. Unknown or absent `tool` is recorded as `unknown`; the redirect never fails on a bad
parameter, because a broken buy link costs a sale.

Tool names are validated against `/^[a-z0-9_]{1,64}$/` before they touch the database or the
redirect URL, so this cannot become an open redirect or an injection vector.

### M4, `asc_start_trial` MCP tool (free tier)

- Computes `fingerprint = sha256("asc-mcp-trial-v1:" + issuerId)` **locally**, sends only the digest.
- Requires an `email` argument. The agent asks the user; no email, no trial.
- On success: prints the key, writes it into the client config via the existing
  `writeServerBlock` merge path (backup preserved), **and flips the running session to Pro with no
  restart** by making `tier` a mutable binding that the tool closures already read at call time.
  Unblocking the user inside the agent, in one turn, is the entire point of the feature.
- Refuses when the caller already has Pro. Reports days remaining on a repeat call.

### M5, gate message rewrite

`requirePro(tier, capability)` gains the tool name and returns, in order: what is locked, the
one-line trial offer naming `asc_start_trial`, the `/go?tool=` buy link, and the direct Polar link
as a fallback for when the worker is unreachable. Keeping the raw Polar URL in the package means a
worker outage degrades attribution, not revenue.

### M6, `GET /admin/stats`

ADMIN_TOKEN-guarded. Returns intent clicks by tool, trials issued, trials still live, trials expired,
and paid conversions, so the demand question the whole feature exists to answer is actually
readable.

### M7, surfaces and documentation

Landing page pricing block, README, `asc_guide`, USER_GUIDE (generated), the worker `/privacy` and
`/terms` pages, `llms.txt`, and the FAQ JSON-LD all have to state the trial and the fingerprint
honestly. `scripts/set-checkout-url.mjs` needs to keep working now that `src/gate.ts` holds both a
`/go` URL and the raw Polar link.

## Privacy position

The current `/privacy` page says, without qualification: *"Your Apple API credentials (.p8 key,
Key ID, Issuer ID) never leave your machine"* and *"No analytics, telemetry, or tracking"*. Both
statements are load-bearing for a tool people hand an Apple signing key to.

Therefore:

- The Issuer ID is **hashed on the user's machine** with a fixed salt and only the digest is
  transmitted, only on an explicit `asc_start_trial` call, never at startup and never on any other
  path. The privacy page will say exactly this rather than keeping an absolute claim that a reader
  could catch us breaking.
- **No gate-hit beacon is implemented**, though it was in the original plan. Counting locked-tool
  hits from inside the process is telemetry by any honest reading, and an opt-in flag nobody sets
  produces no data anyway. Demand is measured instead from two things the user deliberately
  initiates: opening the buy link (`/go`) and starting a trial (`trigger_tool`). This is weaker
  data, and it is the version that does not require us to walk back a privacy promise.

## Risks

| Risk | Mitigation |
|---|---|
| `/trial` is a free-Pro faucet | Anchored on a hashed Apple Issuer ID, which costs $99/year to obtain; unique per email too; rate-limited; 7 days; idempotent |
| Grace window silently extends trials to 11 days | M2, with direct unit tests on both branches |
| Trial key shadows a paid key in `/key` lookup | Lookup ordering prefers `source='polar'`; test covers a user holding both |
| Schema migration breaks live validation for 3 paying customers | Additive columns with defaults; `/validate` path untouched; verified against the deployed DB before and after |
| Live tier mutation leaks Pro after trial expiry | The 24h licence cache already re-validates; expiry is enforced server-side on every `/validate` |
| An open redirect via `/go?tool=` | Tool name regex-validated; redirect target is a constant, never taken from input |

## Gates

Architect review (deep), implementation, independent flow-tester (mechanical, against the deployed
worker), independent senior tester (business logic: can a free user get two trials, does a paying
customer ever lose access), security scan (open redirect, secrets, injection, PII), SEO/CRO audit on
the changed landing page, commit hygiene. Release only when every gate is green.

## Amendment 1, after the security review (2026-08-06)

An independent security pass found four issues at HIGH or CRITICAL, three of them
in code this PRD introduced. The scope below is added; nothing already built is
removed.

**The email anchor is dropped as a uniqueness constraint.** `/trial` currently
refuses when the email has had a trial, even under a new fingerprint. That is
what makes the following attack work: `isValidFingerprint` only checks the shape
of the digest, not that the caller derived it from an Issuer ID they hold, so
anyone can post a fabricated fingerprint with a victim's email address and
permanently consume that person's one free trial before they ever hear of the
product. Made worse by `Access-Control-Allow-Origin: *`, which lets any web page
do it from a visitor's browser, charging the rate limit to the victim's IP.

Anchoring on the Apple account alone removes the attack outright, because a
victim's real fingerprint stays unused and an attacker cannot guess it. What it
costs is the person who owns two Apple developer accounts and takes two trials:
$198 a year of Apple membership to avoid $9 a month. That is a trade worth
making. The email is still recorded, still emailed the key, and still the thing
we follow up on.

**`/trial` stops distinguishing its refusals.** Branching between "already a
subscriber" and "already trialled" told an unauthenticated caller, from any
origin, whether a given address is a paying customer. One refusal message,
covering both, still tells a real user what to do.

**CORS.** `/trial` is called by a Node process on the user's machine, which has
no origin and needs no CORS. The wildcard is removed.

**A daily cap on trial creation.** Each trial sends mail through Brevo, whose
free tier is 300 a day, and the in-memory rate limiter is per-isolate so it does
not bind across PoPs. A count of today's trial rows, checked before minting,
puts a hard ceiling on both the spend and the damage to sender reputation.

**`/delete` is fixed, though it predates this PRD.** It takes an email in an
unauthenticated form post and deletes that person's licence row: anyone who
knows a customer's address can revoke their access, and the customer stays
broken until their next renewal webhook. It now emails a signed, expiring
confirmation link and answers identically whether or not the address is known.
Out of the original scope, in scope for shipping: this change adds a second
reason to care about that row existing.

**Timing-safe admin token comparison**, and the privacy page's 90-day deletion
promise reworded to match what the code actually does, which is deletion on
request.

Two findings are accepted rather than fixed, and belong in the operator runbook
instead: `POLAR_WEBHOOK_SECRET_SANDBOX` must be confirmed absent before deploy,
and `ANNOUNCE_TOKEN` must be a strong random value because `/admin/announce`
sends operator-supplied HTML to customers.

## Definition of done

1. `npm test` green, including new cases for every bullet in M1, M2, M3 and M4.
2. The full trial path exercised end to end against the deployed worker with a real Apple Issuer ID:
   mint, config write, live session upgrade, a Pro tool actually running, repeat call idempotent,
   expiry refusing to re-mint.
3. All 3 existing paying licences still validate as Pro, checked live before and after deploy.
4. Documentation regenerated and consistent across README, USER_GUIDE, LIMITATIONS, `asc_guide`,
   site, privacy and terms.
5. Independent testers report pass, with the evidence in their own words, not the implementer's.
