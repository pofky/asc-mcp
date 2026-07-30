<!-- GENERATED from src/tools/guide.ts by scripts/gen-docs.mjs. Do not edit by hand. -->

# Limitations and manual interruptions

Everything here is impossible via the App Store Connect API and must be done by hand. The MCP either returns the exact steps (privacy, trader) or detects and aborts (first IAPs) so nothing is left half-done.

### Create an app record
Why: POST /v1/apps is forbidden for API keys.
Do instead: ASC website > Apps > + (one time).

### Delete or remove an app record
Why: DELETE /v1/apps is forbidden for API keys (probed live: apps allows GET and UPDATE only). Builds and appInfos cannot be deleted either.
Do instead: First take it off sale everywhere, which IS automatable: set_app_availability with territories: [] turns all ~175 territories off (Apple requires this even for an app that was never released). Also remove any in-app purchases from sale. Then, in the ASC website: Apps > your app > App Information > Additional Information > Remove App. Needs the Account Holder or Admin role, and it will not appear while the app is in Ready for Review, Waiting for Review, In Review, Metadata Rejected or Rejected. Note the SKU can never be reused in the organisation, and the bundle ID cannot be reused if a build was ever uploaded.

### Create an App Group
Why: Portal-only; no API.
Do instead: Apple Developer portal > Identifiers.

### App Privacy nutrition label
Why: appDataUsages is not in the public API.
Do instead: ASC website. Run `set_privacy_nutrition` for the exact checklist + deep link.

### EU DSA trader status
Why: No public API attribute/resource.
Do instead: ASC website. Run `set_eu_trader_status` for steps + deep link. Legal decision.

### Submit an app's FIRST in-app purchases / subscriptions
Why: First products return FIRST_NON_CONSUMABLE_MUST_BE_SUBMITTED_ON_VERSION; only the website bundles them with the version.
Do instead: ASC website: open the version, Add for Review, tick the products, submit together. `submit_for_review` aborts to avoid orphaning. Later products submit via API.

### Create a signing certificate / use cloud signing
Why: Least-privilege API keys lack certificate rights; cloud signing fails with a permission error.
Do instead: Have an Apple Distribution cert in the keychain, then `setup_app_store_signing` for manual-signing profiles + ExportOptions.plist.

### Compile the binary
Why: Building an .ipa needs the Xcode toolchain.
Do instead: `build_and_archive` + `upload_binary` run locally on a Mac with Xcode.

### Post a public response to a review
Why: API exposes reading reviews, not posting public replies.
Do instead: `draft_review_response` writes the reply; paste it in the ASC website.

### Capture simulator screenshots
Why: Not yet implemented (roadmap).
Do instead: Produce PNGs yourself, then `upload_screenshots`.
