# ASC MCP, Control Plane Roadmap

Goal: anyone who installs `@pofky/asc-mcp` gets **full, premium control of their own App Store Connect projects out of the box**, with a dead-simple setup. Read intelligence stays free; write/control is Pro-gated ($9/mo).

## Why this is possible
fastlane's `deliver`/`pilot` are just [spaceship](https://github.com/fastlane/fastlane) calling the same ASC REST API this MCP already authenticates against with the `.p8`. So almost everything "controlling App Store Connect" means is reachable from the existing auth, no fastlane dependency. The only intrinsic gap is building/signing/uploading the **binary**, which needs the local Xcode toolchain.

## Setup flow (shipped)
- `.p8` auto-discovery from Apple's standard path `~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8`. Key ID is parsed from the filename. Drop the key, give the Issuer ID, done.
- `asc-mcp init` wizard: detects the key, prompts for Issuer ID plus optional license, prints a paste-ready MCP config. Writes nothing destructive.
- `getConfig()` falls back to discovery when env vars are unset.

## Tool surface

### A. API-addressable (pure MCP, no local toolchain, works headless)
| Tool | Status |
|------|--------|
| `update_version_metadata` (description/keywords/whats-new/promo/marketing+support+privacy-policy URLs/name/subtitle, char-limit validated, resilient atomic PATCH) | shipped |
| `create_version` | shipped |
| `submit_for_review` (reviewSubmissions flow, confirm-gated) | shipped |
| `list_builds`, `attach_build` (newest VALID by default) | shipped |
| `upload_screenshots` (reserve, upload chunks, commit; multipart) | shipped |
| `release_version` (manual release of approved version, confirm-gated) | shipped |
| `manage_phased_release` (start/pause/resume/complete) | shipped |
| TestFlight: `list_beta_groups`, `assign_build_to_group`, `invite_beta_tester` | shipped |
| `create_subscription` (group + sub + localization + availability + USA price + per-territory free trial, idempotent) | shipped |
| `create_iap` (non-consumable / consumable + localization + availability + USA price schedule auto-equalized, idempotent) | shipped |
| `set_iap_review_screenshot` (review screenshot for a sub or IAP; resolves product by id) | shipped |
| `set_age_rating` (V2 ageRatingDeclaration, full-set merge) | shipped |
| `set_privacy_nutrition` (guidance + deep link; not API-addressable, see Notes) | shipped |
| `set_eu_trader_status` (guidance + deep link; not API-addressable, see Notes) | shipped |
| `set_app_availability` (all territories or a subset, availableInNewTerritories; creates or PATCHes the per-app singleton) | shipped |

### B. Local toolchain (needs Xcode on user's Mac, shell-out tools)
| Tool | Status |
|------|--------|
| `setup_app_store_signing` (downloads IOS_APP_STORE profiles for the app + extensions, installs them, writes a manual-signing ExportOptions.plist; sidesteps the cloud-signing permission most API keys lack) | shipped |
| `build_and_archive` (xcodebuild archive plus export with ExportOptions.plist) | shipped |
| `upload_binary` (xcrun altool, confirm-gated) | shipped |
| `capture_screenshots` (simulator via xcodebuildmcp/idb) | todo |

Binary upload path that works with a least-privilege API key: `setup_app_store_signing` -> `build_and_archive` (export_options_plist = the generated file) -> `upload_binary` (confirm:true) -> poll `list_builds` to VALID -> `attach_build`. Requires an Apple Distribution certificate already in the login keychain (cert creation is not exposed to API keys). Cloud signing (`-allowProvisioningUpdates` with automatic style) fails as `Cloud signing permission error` unless the key has Admin/App Manager with certificate rights.

### What the API CANNOT do (must be done in the ASC website / Xcode)
`release_preflight` lists these in a "Manual steps to finish" section, tailored to the app's current state:
- **Submit an app's FIRST in-app purchases.** They must be bundled with the version in the website (Add for Review -> tick the products -> Submit). `submit_for_review` detects this and aborts rather than orphaning. Later IAPs submit via the API.
- **App Privacy nutrition labels.** `set_privacy_nutrition` returns the checklist + deep link.
- **EU DSA trader status.** `set_eu_trader_status` returns guidance + deep link.
- **Certificate creation / cloud signing** with a least-privilege key (use `setup_app_store_signing` instead).
- **App record + App Group creation** (`POST /v1/apps` forbidden for API keys).
- The binary itself still needs the local Xcode toolchain to build.

### Orchestration
- `/asc-ship-release` slash command chains the whole flow with confirmation gates. | shipped

## Foundation (shipped)
- `client.ts`: `post`/`patch`/`del`/`write` with 204 handling plus error mapping.
- `gate.ts`: shared `requirePro(tier, capability)`. All write tools early-return the upgrade message before any API call (tested).
- All write tools Pro-gated; outward-facing `submit_for_review` also requires `confirm: true`.

## Notes for implementers
- Screenshot upload is the gnarliest piece: 3-step reservation (`appMediaUploadOperations`), PUT each chunk to the returned URLs, then PATCH `uploaded: true` with the source-file checksum.
- `submit_for_review` uses the modern `reviewSubmissions` plus `reviewSubmissionItems` API, not the deprecated `appStoreVersionSubmissions`.
- Editable states gate: `PREPARE_FOR_SUBMISSION`, `DEVELOPER_REJECTED`, `REJECTED`, `METADATA_REJECTED`.

## Gotchas proven live against a real account (2026-06-26, shipping Glasyn)
- **Metadata PATCH is atomic.** One non-editable attribute fails the whole write. `whatsNew` is not editable on a first 1.0 (no prior release). `update_version_metadata` now drops a rejected attribute and retries, reporting it as skipped.
- **Age rating is V2 and NOT a partial PATCH.** You must send the full declaration set. Keys are typed: `gambling`, `healthOrWellnessTopics`, `lootBox`, `unrestrictedWebAccess`, `messagingAndChat`, `userGeneratedContent` are BOOLEAN; `gunsOrOtherWeapons`, `medicalOrTreatmentInformation`, violence/sexual/etc. are frequency strings (NONE/INFREQUENT_OR_MILD/FREQUENT_OR_INTENSE, plus INFREQUENT/FREQUENT). `ageRatingOverride` (V1) conflicts with `ageRatingOverrideV2`; never send V1. The tool fetches current, merges, defaults nulls, sends the whole object.
- **Subscription price needs availability FIRST.** Setting a `subscriptionPrices` before `subscriptionAvailabilities` exists fails with a misleading `RELATIONSHIP.INVALID` on the price point. `create_subscription` sets availability (all territories) before price.
- **Base price = `startDate: null`** (effective now). Future-dated prices are rejected until a base price exists.
- **Free trials are per-territory.** `subscriptionIntroductoryOffers` requires a `territory` relationship; fan out across all ~175 territories.
- **IAP price uses an inline-created price object.** `inAppPurchasePriceSchedules` references a `manualPrices` entry whose `id` must be the literal local-id format `${...}`, supplied in the top-level `included` array. IAP localization `description` max is 45 chars.
- **Price points** come from `/v1/subscriptions/{id}/pricePoints` and `/v2/inAppPurchases/{id}/pricePoints`, filtered `filter[territory]=USA`; match on `customerPrice`.
- **Submittability (leaving MISSING_METADATA) needs ALL of:** localization (name+desc), availability set, price in EVERY available territory, and a review screenshot.
  - **Subscriptions do NOT auto-equalize price.** A USA-only price leaves 174 territories unpriced -> MISSING_METADATA. Fix: set the USA base, then POST a price per territory from `/v1/subscriptionPricePoints/{usaPointId}/equalizations` (174 points, each carries its territory). `create_subscription` now does this.
  - **IAP price schedules DO auto-equalize** from `baseTerritory` (1 manualPrice + 174 automaticPrices). No per-territory work needed.
  - **Availability is separate and required.** Subs use `/v1/subscriptionAvailabilities`; IAPs use `/v1/inAppPurchaseAvailabilities` (GET 404 = unset). Both take `availableInNewTerritories` + an `availableTerritories` list. Without it the product stays MISSING_METADATA even with full pricing.
  - **Review screenshot** via `/v1/subscriptionAppStoreReviewScreenshots` or `/v1/inAppPurchaseAppStoreReviewScreenshots` (reserve/PUT/commit, like app screenshots). `reviewNote` is optional, not required for READY_TO_SUBMIT.
- **Subscription state is recomputed on a subscription-level edit, not eagerly.** After you add prices/availability/screenshot, the subscription stays MISSING_METADATA until a PATCH to the `subscriptions` resource itself triggers recompute. `create_subscription` does a final no-op name PATCH and reports the resulting state. (IAP state recomputes immediately on availability; only subscriptions need the nudge.)

## Intrinsic API gaps (not bugs; surface as guidance + deep link)
- **App Privacy nutrition label** (`appDataUsages`) is not in the public API. Set in ASC UI. `set_privacy_nutrition` returns the exact steps.
- **EU DSA trader status** is not in the public API. Set in ASC UI. `set_eu_trader_status` returns the exact steps.
- **App record + App Group creation**: `POST /v1/apps` is forbidden for API keys; App Groups are portal-only. Must use ASC UI / Developer portal.
- **First in-app purchases cannot be bundled with the version via API.** `inAppPurchaseSubmissions` / `subscriptionSubmissions` are the right resources, but the FIRST non-consumable (and first subs) return `STATE_ERROR.FIRST_NON_CONSUMABLE_MUST_BE_SUBMITTED_ON_VERSION`. They must be submitted together with the app version, which only the ASC website supports. `submit_for_review` detects this and ABORTS without submitting the version alone (so products are never orphaned), returning the exact website steps. After the first release is live, later IAPs submit fine via the API.
- **reviewSubmissions cannot be DELETEd, and unsubmitted ones cannot be canceled** (`canceled:true` only withdraws SUBMITTED ones). To free a version from an unsubmitted submission, DELETE its `reviewSubmissionItems`. Empty unsubmitted submissions linger harmlessly; the website consolidates them.

## Submission-prep tools (v1.5.x)
`set_app_metadata` (category/copyright/content-rights/export-compliance), `set_app_price` (free or USD tier; creates the price schedule), `set_review_contact` (appStoreReviewDetail). `release_preflight` also checks age rating, privacy URL, and per-product readiness. `submit_for_review` submits products first, then the version, bundling them when allowed.
