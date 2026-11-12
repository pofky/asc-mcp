# PRD 0005: every reply names the next step and who takes it

Status: implemented, 2026-11-12. Type B (copy across all tools, three bug fixes). Flows amended: all (failure contract), F4, F6, F8.

## 1. Problem

The owner asked that every journey, whether a person or an agent does the work, says what happened, the next step and why, and on an error what the person or the agent must do. An audit of 1.11.0 found:

- A tool call that threw replied `Error: <raw message>`, not marked as an error, so a dropped connection read `fetch failed` and a damaged key read as an OpenSSL code, with no next step.
- About 30 replies that were empty, refused or failed gave no next step or did not say who acts (review rejected, build failed, no beta groups, no apps, archive or upload failed, and more).
- Four replies hid or misstated state: `set_app_metadata` hid categories already applied; `submit_for_review` hid products already sent; screenshot uploads hid files already uploaded; `set_app_price` showed the requested price as the current one.
- Bugs: `init` printed nothing to paste after a config JSON parse failure; `set_app_metadata` said `Nothing to set` when only encryption was passed and no build existed; `manage_phased_release` fell back to a version in any state; `getAll` returned a partial list silently when a later page failed.

## 2. Scope

- `src/errors.ts` `explainError`: Apple status, network, `.p8`, unknown, each ending `Next:`. Used by every tool handler in `src/index.ts`, with `isError: true`.
- Server instructions: follow `Next:`, tell the person any step only they can do, `asc_setup_check` when unsure.
- The replies in the audit, rewritten in `src/tools/*`, `src/preflight/*`, `src/setup.ts`, `src/trial.ts`. Every tool and argument named exists (checked against `TOOL_NAMES` and the zod schemas). Leading words that `previewReplyKind` matches are kept; `sales_report` no-report replies now read `No sales report available` and count as empty.
- The four bugs above, each with a test.

Out of scope: telemetry (owner declined), new tools, pricing.

## 3. Acceptance

- Every thrown failure: `isError: true`, a `Next:` line. Driven on the build: missing `.p8`, damaged `.p8`, Apple 404; success reply of `list_apps` unchanged.
- `tests/errors.test.ts`, `tests/journey-messages.test.ts`, `tests/init-noninteractive.test.ts` cover the contract and the bugs. Full suite and tsc pass.
- change-tester flow_verify PASS; change-reviewer security and legal PASS.

## 4. Risks

- Free preview counting: prefixes kept, verified by the reviewer.
- `getAll` now fails the whole call on a transient 429 or 5xx on a later page; the reply says to retry. Accepted: a silent partial list is worse.
