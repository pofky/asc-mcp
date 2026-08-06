# Deploy runbook, PRD-0001 (trial + intent)

Three paying customers are live. Every step below has a check, and the order
matters: the migration must land before the worker build that reads the new
columns. The worker has a fallback for the wrong order (`/validate` retries with
the pre-migration column set), but that is a safety net, not the plan.

## 0. Before touching anything: record the truth

```bash
# All live licences, so "was it like that before?" is answerable afterwards.
cd license-worker
npx wrangler d1 execute asc-mcp-licenses --remote \
  --command="SELECT id,key,email,active,expires_at FROM licenses" --json > /tmp/licences-before.json

# And that each paying key validates right now.
for k in <key1> <key2> <key3>; do
  curl -s https://asc-mcp-license.remewdy.workers.dev/validate \
    -H 'Content-Type: application/json' -d "{\"key\":\"$k\"}"; echo
done
```

Expect three `{"valid":true,"tier":"pro",...}`. If any is already false, stop and
find out why before adding a variable.

## 1. Migration first

```bash
cd license-worker
npx wrangler d1 execute asc-mcp-licenses --remote \
  --file=migrations/0001-trial-and-intent.sql
npx wrangler d1 execute asc-mcp-licenses --remote \
  --command="SELECT id,email,source,trial_fingerprint FROM licenses" --json
```

Check: every existing row comes back `source='polar'`, `trial_fingerprint=null`,
and the row count matches `/tmp/licences-before.json`. The migration is additive
(three columns with defaults, one partial unique index, one plain index, one new table) and drops
nothing, so there is no data-loss path, but confirm rather than assume.

## 2. Worker

```bash
npx wrangler deploy
curl -s https://asc-mcp-license.remewdy.workers.dev/health
```

Then immediately re-validate the same three paying keys. **This is the gate: if
any of the three does not return `tier":"pro"`, roll back the worker
(`npx wrangler rollback`) before doing anything else.** The migration can stay;
it is additive and the previous build ignores the new columns.

## 2b. Confirm the sandbox webhook secret is gone

```bash
npx wrangler secret list
```

`POLAR_WEBHOOK_SECRET_SANDBOX` must NOT be present. If it is, a Polar sandbox
webhook can mint a real licence and send a real email. Delete it before going
further: `npx wrangler secret delete POLAR_WEBHOOK_SECRET_SANDBOX`.

While you are there: `ANNOUNCE_TOKEN` must be a strong random value, because
`/admin/announce` sends operator-supplied HTML to every customer address.

## 3. Set ADMIN_TOKEN and DELETE_SECRET if they are not already set

`DELETE_SECRET` signs the GDPR deletion confirmation links. It falls back to
`ADMIN_TOKEN`, and with neither set `/delete` refuses to delete anything rather
than deleting unverified, so the failure mode is safe but the flow is broken.

```bash
npx wrangler secret put DELETE_SECRET     # openssl rand -hex 32
```

`/admin/stats` returns 401 without `ADMIN_TOKEN`, which is the safe failure, but
reading the numbers is the whole point of the change.

```bash
npx wrangler secret list          # ADMIN_TOKEN present?
npx wrangler secret put ADMIN_TOKEN
```

## 4. Smoke the new endpoints against production, with a fingerprint that is not a real Apple account

```bash
# 64 hex chars that no real Issuer ID will ever hash to; delete the row afterwards.
FP=deadbeef$(printf '0%.0s' {1..56})
curl -s https://asc-mcp-license.remewdy.workers.dev/trial \
  -H 'Content-Type: application/json' \
  -d "{\"fingerprint\":\"$FP\",\"email\":\"povkonop+trialsmoke@gmail.com\",\"tool\":\"submit_for_review\"}"
```

Expect a key, `days_remaining: 7`, and an email arriving. Validate the key, then
remove the row so the smoke test is not counted as a customer:

```bash
npx wrangler d1 execute asc-mcp-licenses --remote \
  --command="DELETE FROM licenses WHERE trial_fingerprint='$FP'"
```

Also check the redirect: `curl -sI 'https://asc-mcp-license.remewdy.workers.dev/go?tool=submit_for_review'`
should be a 302 to `buy.polar.sh` with `utm_content=submit_for_review`.

## 5. npm

```bash
npm run docs && npm test && npm run build
npm publish --access public
```

Then install the published package into an empty directory and confirm it
reports 1.9.0 and registers 41 tools, rather than trusting the local build.

## 6. Tag, registry, site

```bash
git tag v1.9.0 && git push origin v1.9.0     # triggers the MCP registry workflow
```

Cloudflare Pages deploys `site/` from `master` automatically. Confirm the live
page shows v1.9.0 and the trial copy, and that `/privacy` and `/terms` on the
worker show the August 6 versions. The privacy page in particular must be live
before the npm package is, since the package is what starts sending digests.

## 7. After

Leave it a few days, then read `/admin/stats`. The two numbers that matter are
which tool names appear under `checkout_click` and `trial_started`, and whether
`trials.converted` moves. That is the demand data none of the pricing and
packaging decisions have had until now.

## Rollback

- Worker: `npx wrangler rollback`. The new columns are inert to the old build.
- npm: `npm deprecate @pofky/asc-mcp@1.9.0 "<reason>"` and publish a fixed
  patch. Do not unpublish; anyone on 1.9.0 would get a broken install.
- Migration: no rollback needed or wanted. Dropping the columns would delete
  real trial records and hand everyone who had one a second free week.
