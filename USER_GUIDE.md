<!-- GENERATED from src/tools/guide.ts by scripts/gen-docs.mjs. Do not edit by hand. -->

# App Store Connect MCP - Guide

Call `asc_guide` with a `topic` for the exact playbook. Manual steps (things no API can do) are flagged inline so you never get blocked mid-flow.

Topics:
- setup - one-time machine setup (.p8, init, config)
- first-app - ship a brand-new app's 1.0 (the hardest flow)
- update - ship an update to a live app
- screenshots - upload App Store screenshots
- iap - create a one-time in-app purchase
- subscriptions - create an auto-renewable subscription
- reviews - triage and reply to customer reviews
- testflight - distribute a beta
- binary - build, sign, upload the binary (needs Xcode)
- limitations - everything the API can't do + the manual workaround

Golden rule: when a step says MANUAL, stop and do it in the App Store Connect website (or Xcode). The agent should hand the user the deep link and exact steps, not pretend the API can do it.

Outward-facing tools (submit_for_review, release_version, upload_binary) require confirm:true. Always confirm with the human first.

---

## One-time setup

When: Before anything else, once per machine.

Steps:
1. Create an API key: App Store Connect > Users and Access > Integrations > App Store Connect API > generate a key with the App Manager role. Download the .p8 (one time only).
2. Drop the .p8 into ~/.appstoreconnect/private_keys/ (Apple's standard path). The 10-char Key ID is read from the filename, so that one file is enough.
3. Run `npx @pofky/asc-mcp init` in a terminal. It auto-detects the key, asks for your Issuer ID (the UUID at the top of the Integrations page) and an optional Pro license key, and prints a paste-ready MCP config block.
4. Paste the block into your client config (~/.claude/settings.json, Claude Desktop config, Cursor, etc.) and restart the client.
5. Verify with `list_apps`. If it returns your apps, you are connected.

Manual interruptions you must do yourself:
- MANUAL: generating the API key and downloading the .p8 is a one-time App Store Connect website action. The .p8 cannot be re-downloaded; if lost, revoke and make a new one.
- Free tier is read/intelligence only. Set ASC_LICENSE_KEY to unlock all write/control tools ($9/mo).

---

## Ship an app's FIRST release (1.0)

When: Brand-new app, never been on the store. The hardest flow because of first-time-only Apple constraints.

Steps:
   MANUAL: the app RECORD must already exist. `POST /v1/apps` is forbidden for API keys, so create the app (name, bundle ID, SKU, primary language) once in App Store Connect > Apps > +. App Groups are portal-only too.
1. `list_apps` to get the numeric app_id.
2. Build + upload a binary so a build exists to attach (see topic:binary), or upload via Xcode/Transporter. Then `wait_for_build` until VALID.
3. `set_app_metadata` - primary/secondary category, copyright, content rights, export compliance (most apps: uses_non_exempt_encryption=false).
4. `set_app_price` - price_usd:0 for free, or a tier. Required before submit.
5. `update_version_metadata` - description, keywords, what's-new (note: what's-new is NOT editable on a first 1.0 with no prior release; the tool drops it and reports it skipped), promo text, marketing/support/privacy-policy URLs, name, subtitle. Char limits validated.
6. `set_app_availability` - defaults to all ~175 territories; pass a subset to restrict.
7. `set_age_rating` - pass only the declarations that apply; the tool fetches, merges the full V2 set, and submits (it is NOT a partial PATCH).
8. `set_review_contact` - name, phone, email, demo account if the app needs login. Required before submit.
9. `attach_build` - newest VALID build by default.
10. `upload_screenshots` per display type (at minimum APP_IPHONE_67; APP_IPHONE_65 + APP_IPAD recommended). See topic:screenshots.
   MANUAL: App Privacy nutrition label. Not in the API. Run `set_privacy_nutrition` for the exact checklist + deep link, then set it in the ASC website.
   MANUAL: EU DSA trader status. Not in the API. Run `set_eu_trader_status` for steps + deep link; it's a legal decision, set it in the website.
11. If the app has in-app purchases or subscriptions, create them now (topic:iap / topic:subscriptions). The FIRST ones must be submitted WITH the version (next step).
12. `release_preflight` - fix every FAIL it reports. It tailors a 'manual steps to finish' list to this app's state.
13. MANUAL (if first IAPs exist): the app's very first in-app purchases CANNOT be bundled with the version via the API. In the ASC website, open the version, Add for Review, tick the products, and submit them together. `submit_for_review` detects this and ABORTS rather than orphaning the version. After the first release is live, later IAPs submit via the API fine.
14. `submit_for_review` with confirm:true (only if there are no first-IAPs blocking; otherwise submit in the website per the step above).
15. After approval: `release_version` (confirm:true) to go live now, or `manage_phased_release` start for a 7-day rollout.

Manual interruptions you must do yourself:
- App record + App Group creation - ASC website / Developer portal only.
- App Privacy nutrition label - ASC website only (`set_privacy_nutrition` gives the checklist).
- EU trader status - ASC website only, legal decision (`set_eu_trader_status` gives steps).
- First in-app purchases - must be submitted with the version in the ASC website; API cannot bundle them.
- Building the binary needs Xcode on a Mac (the API can't compile).

---

## Ship an UPDATE to an existing app

When: App is already live; you're releasing a new version. Much simpler than 1.0.

Steps:
1. `app_details` to read current version + state.
2. `create_version` with the next version number (e.g. 2.5.0) if there's no editable version yet.
3. `update_version_metadata` - what's-new is editable now; update description/keywords/promo as needed.
4. Upload the new build (`upload_binary` confirm:true, or Xcode/Transporter; see topic:binary), `wait_for_build` to VALID, then `attach_build`.
5. `upload_screenshots` only if they changed.
6. Later IAPs/subscriptions (not the first ever) can be created and will submit via the API.
7. `release_preflight` - fix FAILs.
8. `submit_for_review` confirm:true.
9. After approval: `release_version` confirm:true, or `manage_phased_release` start.
10. Use `metadata_diff` any time to see exactly what changed between live and pending across locales.

Manual interruptions you must do yourself:
- Still no API for nutrition label or trader status, but these persist from the first release; only revisit if your data practices changed.
- Building the binary still needs Xcode.

---

## Upload screenshots

When: Adding or replacing App Store screenshots.

Steps:
1. Prepare PNG/JPEG files at the exact pixel size for the display type.
2. `upload_screenshots` with display_type, an ordered files array, and locale. It runs Apple's 3-step reserve/PUT-chunks/commit flow for you.
3. Common display types: APP_IPHONE_67 (6.7in, required), APP_IPHONE_65 (6.5in), APP_IPAD_PRO_129 (12.9in iPad).

Manual interruptions you must do yourself:
- Capturing the screenshots from a simulator is not yet automated (capture_screenshots is on the roadmap). Produce the PNGs yourself, then upload via the tool.
- Apple requires correct exact dimensions per display type or the commit fails.

---

## Create a one-time in-app purchase (non-consumable / consumable)

When: Selling a lifetime unlock, consumable credits, etc.

Steps:
1. `create_iap` - product_id, reference name, display name (max 30), description (max 45), type, price_usd. It's idempotent: USA base price, auto-equalized across all territories, availability set. IAP state recomputes immediately on availability (unlike subscriptions, which need a nudge), so once price + availability + a review screenshot are set the product is READY_TO_SUBMIT.
2. `set_iap_review_screenshot` - IAPs need an App Review screenshot to leave MISSING_METADATA. Upload one showing the paywall.
3. For the FIRST IAP ever on the app: it must be submitted WITH the app version in the ASC website (see topic:first-app). After the first release is live, later IAPs submit via `submit_for_review`.

Manual interruptions you must do yourself:
- First non-consumable / first IAP on a brand-new app: submit it together with the version in the ASC website. API can't bundle the first one.
- IAP localization description is capped at 45 chars.

---

## Create an auto-renewable subscription

When: Recurring billing (monthly/yearly plans, free trials).

Steps:
1. `create_subscription` - group ref + display name, product_id, names, description (max 45), period, price_usd, optional free_trial, review_note. It is idempotent and handles the gnarly order Apple requires: availability FIRST, then USA base price, then equalize across ~175 territories, then per-territory free-trial intro offers, then a final no-op PATCH to force the state to recompute to READY_TO_SUBMIT.
2. `set_iap_review_screenshot` - subscriptions also need a review screenshot of the paywall.
3. First subscriptions on a brand-new app submit WITH the version in the website; later ones via the API.

Manual interruptions you must do yourself:
- First subscriptions on a new app: submit with the version in the ASC website.
- Subscription state only recomputes on a subscription-level edit; create_subscription nudges it for you, but if you edit sub-resources by hand, expect a lag until a subscription PATCH.

---

## Triage and respond to customer reviews

When: Managing your App Store reputation.

Steps:
1. `list_reviews` - filter by rating, sort, limit.
2. `triage_reviews` - clusters recent reviews into 3-5 themes with counts and action buckets, using your own client's model via MCP Sampling (no extra cost from this server).
3. `draft_review_response` - drafts a public reply in the review's locale. It NEVER auto-posts.
   MANUAL: post the approved reply text in App Store Connect yourself (the API does not expose posting public responses).

Manual interruptions you must do yourself:
- Posting the public response is manual in the ASC website; the tool only drafts it.

---

## Distribute a TestFlight beta

When: Getting a build to testers before App Review.

Steps:
1. Upload a build (topic:binary), `wait_for_build` to VALID.
2. `list_beta_groups` to find or confirm a group.
3. `assign_build_to_group` - newest VALID build by default.
4. `invite_beta_tester` - email + name; Apple sends the TestFlight invite.

Manual interruptions you must do yourself:
- Beta App Review (for external groups' first build) and the test-information form may need a one-time touch in the ASC website.

---

## Build, sign, and upload the binary

When: You need a build on App Store Connect and want to do it from the agent.

Steps:
   MANUAL: an Apple Distribution certificate must already exist in your login keychain. Certificate creation and cloud signing are not available to least-privilege API keys.
1. `setup_app_store_signing` - downloads the app's IOS_APP_STORE provisioning profiles (app + extensions), installs them, and writes a manual-signing ExportOptions.plist. This sidesteps the cloud-signing permission most API keys lack.
2. `build_and_archive` - xcodebuild archive + export using that ExportOptions.plist. Requires Xcode on this Mac. Give it the .xcodeproj/.xcworkspace, scheme, and the generated plist.
3. `upload_binary` confirm:true - uploads the .ipa via altool with your API key.
4. `wait_for_build` until the build is VALID, then `attach_build`.

Manual interruptions you must do yourself:
- Building requires the local Xcode toolchain; the API cannot compile.
- Distribution certificate must pre-exist in the keychain; API keys can't create certs or use cloud signing.
