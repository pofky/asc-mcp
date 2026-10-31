# FLOWS.md

App: asc-mcp
Last amended: 2026-10-31 by tasks/0002-prd-app-store-preflight.md

The interface is the agent conversation. The "labels" below are the report's exact text.

## Flow index

| ID | Flow | Entry point | Value delivered | Revenue role | Last amended |
|----|------|-------------|-----------------|--------------|--------------|
| F1 | Preflight loop | "Run a preflight before I submit" | A report that can be trusted, then fixes in the same conversation | Conversion, retention | tasks/0002 |
| F2 | Preflight as first look | A free user asks for an audit | The product shown on the user's own app | Activation | tasks/0002 |

---

## F1. Preflight loop

Who: a solo or two-person iOS or macOS developer with a coding agent, just before Submit or just after a rejection.
Goal: "Tell me what will stop this submission, and fix it."
Entry: the agent calls `release_preflight` with `app_id`, and `project_path` if it knows the folder.
Success: `NO BLOCKING ISSUES FOUND: ... This is not a prediction of App Review's decision.`, then the manual steps.

### Steps

| # | Screen | User does | UI element (exact label) | System shows |
|---|--------|-----------|--------------------------|--------------|
| 1 | Chat | Asks for a preflight | `release_preflight` | `## Release Preflight: <app>` |
| 2 | Report | Reads the verdict | `BLOCKED: n failures`, `NOT CONFIRMED: no failures, n could not be checked`, or `NO BLOCKING ISSUES FOUND` | Which version: `Auditing v2.3 (iOS), state PREPARE_FOR_SUBMISSION` |
| 3 | Report | Reads a finding | `FAIL  rule  [scope]`, `Saw:`, `Rule:`, `Fix:` | The tool that fixes it |
| 4 | Chat | Approves the fix | The named write tool, confirm-gated as before | The change |
| 5 | Chat | Re-runs | `release_preflight` | Same shape, fewer findings |
| 6 | Report | Finishes on the website | `### Manual steps Apple keeps on its website` | Deep links |
| 7 | Report | Keeps the record | `Checked <UTC>, v2.3 build 40, rules <date>.` | A line to paste into a Resolution Center reply |

### States on this flow

- No `project_path`: `SKIPPED  project.*  Pass project_path to check privacy manifests and purpose strings.` Does not block.
- Bad path: `SKIPPED  project.*  Path not found: <path>`. The audit continues.
- No built app, or not a Mac: `SKIPPED  built app  <reason>`. Source and plist rules ran.
- A read fails: `UNKNOWN  rule`, `Saw:  Apple returned 403. Your key's role may be too low (App Manager or higher).`
- A link blocks robots or times out: `UNKNOWN`, with `Open it in a browser and confirm.`
- Rejected version: selected, with `review_status with app_id <id> shows Apple's message.`
- Several platforms: `## App-wide`, then `## v2.0 (iOS)`, `## v3.0 (macOS)`.
- Nothing in progress: `No version is being prepared. This audits the live v2.2 (iOS); create_version starts the next one.`
- App Store Connect down, bad app id, no versions: a reply starting `Error:`, with no verdict.
- Rules over 90 days old: `Rule set verified <date>, over 90 days ago. Update asc-mcp.`

## F2. Preflight as first look

Who: a free user with an Apple key and no licence.
Goal: see what the paid tool would say about their own app.
Entry: `release_preflight` on the free tier.
Success: the full F1 report, ending with the existing preview footer.

### Steps

| # | Screen | User does | UI element (exact label) | System shows |
|---|--------|-----------|--------------------------|--------------|
| 1 | Chat | Asks for a preflight | `release_preflight` | The full report |
| 2 | Report | Reads the last line | The preview footer from `src/gate.ts` | Calls left, and the price on the first and last |
| 3 | Chat | Re-runs after a fix | `release_preflight` | Spends another of the 5 preview calls |
| 4 | Chat | Runs out, or tries a fix tool | The gate's refusal | Price first, then `asc_start_trial` |

### States on this flow

- A reply starting `Error` gives the preview call back (`safe` in `src/index.ts`).
- One call costs one preview however long the report is.
