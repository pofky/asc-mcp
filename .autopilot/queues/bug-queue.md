# Bug Queue

- [ ] **2026-10-09** `/go` counts a mail-security gateway as human buy clicks. A gateway follows the
  links in the reminder mails two minutes after the 15:00 UTC cron and rewrites the tool name with
  ROT13 (`gevby_faevat_fzbvy` is `trial_ending_email`), so each reminder shows as one or two
  `checkout_click` rows. `classifyGoVisit` (`license-worker/src/logic.ts:579`) does not catch it.
  Fix: treat a tool name that ROT13-decodes to a known one as `checkout_click_bot`. Found by the
  money-path audit of 9 October; 4 of the 6 "email link" clicks since 22 September were this.
- [ ] **2026-10-09** `handlePolarWebhook` (`license-worker/src/index.ts:522`) has no test. The 94
  worker tests cover the signature, product filter and status logic it calls, not the D1 upsert,
  the `key_emailed` idempotency or the Brevo send. The audit replayed the real 5 August and
  7 September payloads against `wrangler dev` with a local D1 and all states came out right; that
  replay is the shape the test should take.
- [ ] **2026-10-09** `ADMIN_TOKEN` for the worker's `/admin/stats` has no copy in Keychain, so the
  route cannot be read from this machine; counts come from read-only D1 queries instead. Rotate it
  and store it under service `autopilot`.
