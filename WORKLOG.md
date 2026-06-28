# WORKLOG, @pofky/asc-mcp

## Currently Active
**Control plane v1.5.0 + shipping Glasyn live (2026-06-27).** Drove the full write/control
surface against the real ASC account to ship Glasyn (app `6784799368`), fixing every bug the
live runs surfaced. All changes uncommitted on `master`.

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
