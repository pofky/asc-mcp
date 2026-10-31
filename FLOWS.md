# FLOWS.md

App: asc-mcp
Last amended: 2026-10-31, v1.10.1 fixes

The interface is the agent conversation. The "labels" below are the report's exact text.

## Flow index

| ID | Flow | Entry point | Value delivered | Revenue role | Last amended |
|----|------|-------------|-----------------|--------------|--------------|
| F1 | Preflight loop | "Run a preflight before I submit" | A report that can be trusted, then fixes in the same conversation | Conversion, retention | tasks/0002 |
| F2 | Preflight as first look | A free user asks for an audit | The product shown on the user's own app | Activation | tasks/0002 |
| F3 | A subscriber gets their key | Checkout, `/key`, or `asc_start_trial` | The key, and only in the owner's mailbox | Retention | v1.10.1 |

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

- No `project_path`: `SKIPPED  project.*  Pass project_path to check privacy manifests and purpose strings.` Does not block, and the clean verdict says `project files not checked`.
- Bad path: `UNKNOWN  manifest.present  [project.*]`, `Saw:  Project rules did not run. Path not found: <path>`. The audit continues, and the verdict is NOT CONFIRMED.
- No built app, or not a Mac: `SKIPPED  built app  <reason>`. Source and plist rules ran. A built app that cannot be read: `UNKNOWN`.
- A read fails: `UNKNOWN  rule`, `Saw:  Apple returned 403. Your key's role may be too low (App Manager or higher).`
- A link blocks robots or times out: `UNKNOWN`, with `Open it in a browser and confirm.`
- Apple rejected the version: selected, with `UNKNOWN  version.rejected` and a link to App Store Connect, because Apple's API does not give the reasons. The verdict stays NOT CONFIRMED until it is resubmitted.
- Folder with no project: `UNKNOWN`, `No Xcode project or source found in <path>`. Folder building other bundle ids: `UNKNOWN`, and no data type checklist from it.
- Several platforms: `## App-wide`, then `## v2.0 (iOS)`, `## v3.0 (macOS)`. Fix lines name the version: `Fix:  update_version_metadata platform MAC_OS, description`. A fix tool called without it refuses, naming both versions, and writes nothing.
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

## F3. A subscriber gets their key

Who: someone who has paid, on a new machine or having lost the key.
Goal: a working key, with nobody else able to read it.
Entry: the mail sent at purchase, `/success` after checkout, `/key`, or `asc_start_trial` with their address.
Success: the key arrives in the mailbox on the subscription, they paste it in, restart, and `asc_setup_check` says Pro.

### Steps

| # | Screen | User does | UI element (exact label) | System shows |
|---|--------|-----------|--------------------------|--------------|
| 1 | Mail | Reads the mail sent at purchase | `Your asc-mcp Pro license` | The key, and where to put it |
| 2 | `/success` or `/key` | Asks for it again | `Email me my key` | `Check your email` |
| 3 | Chat | Asks the agent | `asc_start_trial` with their address | `This address has a subscription, so its key is sent by email and not returned here. It has been emailed to <address>.` |
| 4 | Client | Pastes it in and restarts | `ASC_LICENSE_KEY`, or the extension's License key field | `asc_setup_check`: License, Pro |

### States on this flow

- Address with no licence: the same `Check your email` page, and no mail, so the page says nothing about who subscribes.
- Mail failed: `/key` answers 503, `The email could not be sent`, with an address to write to. `asc_start_trial` says the same in its reply.
- More than 3 requests for one address in 15 minutes: the same page, and no further mail until the window ends.
- A machine that fetched its key before 31 October 2026: `asc_start_trial` still returns the key inline, because its fingerprint is on the row.
- A trial key on a machine whose owner then subscribed: nothing to do, `/validate` answers it as the subscription.
