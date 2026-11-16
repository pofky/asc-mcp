# PRD 0007: a brand-new app, from bundle id to TestFlight, in the chat (v1.12.0)

Status: implemented, 2026-11-14 to 2026-11-16, release 1.12.0. Type C (new tools, fixes, copy). Flows: F10 added, F3 amended (license key saved mid-session).

## 1. Problem

asc-mcp covered a release for an app that already existed. A new app's first steps sent the person to the Developer portal or the website: no tool registered a bundle id, `setup_app_store_signing` only downloaded profiles that already existed, no tool created a TestFlight group, and adding an account user to an internal group was refused as website-only. Taking an unlaunched iOS test app through asc-mcp end to end (14 to 16 Nov) also found replies that were wrong: `wait_for_build` called the previous build ready right after an upload, `set_age_rating` failed on a question Apple made required and showed the old scale, export compliance failed with a misleading hint, `build_and_archive` could return an older `.ipa`, `upload_screenshots` reserved sizes Apple rejects. Findings and evidence: the test app's friction log (private, rows 1 to 17).

## 2. Scope

- New tools: `register_bundle_id`, `create_beta_group`, `set_beta_test_info`. Changed: `setup_app_store_signing` creates a missing IOS_APP_STORE profile, `invite_beta_tester` adds account users to internal groups. Every new write previews without `confirm: true`.
- Fixes listed in RELEASE_NOTES.md v1.12.0, each with tests.
- `asc_guide` binary, first-app and testflight flows list the new steps; USER_GUIDE regenerated.
- Copy: README, npm, registry, site hero and meta, llms.txt (new Q&A on new apps), plugin, GitHub description and topics, Glama text (`launch/glama-description.txt`).
- Dev only: `scripts/dev-reload.mjs` so a dogfooding session reloads each build.

Out of scope: creating the app record (Apple forbids `POST /v1/apps` for API keys), capabilities beyond the default (friction row 6), reading the copyright and review contact back (row 17, next).

## 3. Acceptance

- F10 driven against real Apple on the test app for bundle id, signing profile, archive, upload, wait, TestFlight group and age rating. Internal tester add was proven by a direct probe; driving it through the tool is pending (row 12).
- Full suite passes (693), tool count test 44, no unlaunched-app name anywhere in the repo or `dist/`.
- Every claim in the new copy checked against `src/` by change-reviewer (legal, SEO, pricing, slop PASS on 31ad790).

## 4. Risks

- "From a new bundle id to App Store review" skips the website-only app record. Mitigation: README new-in-1.12 line, What stays manual, llms.txt Q&A and `asc_guide` name it at that step.
- Internal tester add needs an Admin key to read `/v1/users`; a lesser key gets a reply that says so and names the website path.
