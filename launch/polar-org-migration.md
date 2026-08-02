# Moving asc-mcp billing into its own Polar organization

Decided 2026-08-02: the three existing subscribers are **grandfathered**. Polar cannot move
active subscriptions between organizations, so the old org keeps billing them at $9/mo until
they churn, and only new signups go to the new org.

Their licence keys are unaffected. The worker keys off `polar_subscription_id`, which never
changes, so nothing in D1 needs touching and no customer has to do anything.

## What a new org costs

- Orgs created after 27 May 2026 are on **5% + $0.50**, not the grandfathered
  4% + $0.40 + 0.5% for subscriptions. At $9/mo that is about $0.10 less per customer per month.
- Orgs created after 12 May 2026 have a **7-day settlement delay** instead of instant payouts.
- A new org goes through a fresh **KYC / account review**, typically about a week, before it can
  pay out. This is the real cost: plan the cutover around it, not around the rate.

## Prep already done (v1.8.7+)

- The checkout link was pasted into 19 places. It is now `UPGRADE_URL` in `src/gate.ts` for the
  package, `CHECKOUT_URL` in `license-worker/src/index.ts` for the worker, and
  `scripts/set-checkout-url.mjs` rewrites the remaining site and docs copies in one command.
  This matters because the **old link keeps working after the move**, so a missed copy sells
  into the old org with no error to notice.
- The worker accepts webhooks signed by **either** organization
  (`POLAR_WEBHOOK_SECRET` plus `POLAR_WEBHOOK_SECRET_2`, see `webhookSecrets`). Both orgs deliver
  to the same endpoint during grandfathering: the old one sends renewals and cancellations for
  the three existing subscriptions, the new one sends new signups. With only one secret set the
  behaviour is exactly as before, so this is inert until the second secret exists.

## Blocked on you

1. Create the organization in the Polar dashboard and pass KYC. I cannot do this.
2. Give me an API token scoped to the new org.

## Cutover, once the org exists

1. In the new org: create the "App Store Connect MCP Pro" product at $9/mo, a checkout link, and
   a webhook endpoint pointing at `https://asc-mcp-license.remewdy.workers.dev/webhook/polar`.
2. `echo -n "<new polar_whs_...>" | npx wrangler secret put POLAR_WEBHOOK_SECRET_2`, then
   `npx wrangler deploy`. Do this **before** the new link goes public, or the first signup's
   webhook 401s and that customer gets no key.
3. `node scripts/set-checkout-url.mjs https://buy.polar.sh/<new link>`
4. `npm run docs && npm test`, bump the version, `npm publish`, tag, `wrangler pages deploy site`.
5. Verify: buy through the new link with a real card, confirm a row lands in D1 with `active=1`
   and `key_emailed=1`, and that the key validates as Pro. The provisioning memory's lesson
   applies, only a real payment proves this path, seeded rows have hidden breakage twice.
6. Leave the old org's webhook endpoint enabled. It is the only thing keeping the three
   grandfathered subscriptions renewing correctly.

## When the last grandfathered subscription ends

Remove `POLAR_WEBHOOK_SECRET_2` (or promote it to `POLAR_WEBHOOK_SECRET` and drop the old one),
disable the old org's webhook endpoint, and archive the product in the old org.
