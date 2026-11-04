# FLOWS.md

App: asc-mcp
Last amended: 2026-11-04, setup path audit

The interface is the agent conversation. The "labels" below are the report's exact text.

## Flow index

| ID | Flow | Entry point | Value delivered | Revenue role | Last amended |
|----|------|-------------|-----------------|--------------|--------------|
| F1 | Preflight loop | "Run a preflight before I submit" | A report that can be trusted, then fixes in the same conversation | Conversion, retention | tasks/0002 |
| F2 | Preflight as first look | A free user asks for an audit | The product shown on the user's own app | Activation | tasks/0002 |
| F3 | A subscriber gets their key | Checkout, `/key`, or `asc_start_trial` | The key, and only in the owner's mailbox | Retention | v1.10.1 |
| F4 | Starting a trial | `asc_start_trial`, or the instructions when a call is refused | 7 days of every tool in the running session | Conversion | v1.10.1 |
| F5 | A license that is not answered or has ended | Startup, any tool | The truth about the key, and no offer the server would refuse | Retention | v1.10.1 |
| F6 | Creating or changing something on sale | `create_iap`, `create_subscription`, `set_app_price`, `set_app_availability` | A second call before anything customers can see changes | Trust | v1.10.1 |
| F7 | A visitor who does not know the jargon | Landing page `#plain` | What the product does, in plain words | Activation | tasks/0003 |
| F8 | First setup from the page or README | Hero `Start free, no card`, README `## Setup` | A connected agent and a running trial, with no failed command | Activation | 2026-11-04 |

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

Who: a free user with an Apple key and no license.
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
- An empty reply (no reviews, no beta groups, no builds, one version so nothing to diff) gives it back too and ends `Nothing to show, so this did not use one of your free Pro calls.` (`previewReplyKind` in `src/gate.ts`, 2026-11-04).
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

- Address with no license: the same `Check your email` page, and no mail, so the page says nothing about who subscribes.
- Mail failed: `/key` answers 503, `The email could not be sent`, with an address to write to. `asc_start_trial` says the same in its reply.
- More than 3 requests for one address in 15 minutes: the same page, and no further mail until the window ends.
- A machine that fetched its key before 31 October 2026: `asc_start_trial` still returns the key inline, because its fingerprint is on the row.
- A trial key on a machine whose owner subscribed within 14 days of starting it: nothing to do, `/validate` answers it as the subscription. Later than that, the key ends with the trial, and the gate says `asc_start_trial` emails the paid key.
- Asked for again within a few minutes: `It was already emailed to <address> in the last few minutes.`

## F4. Starting a trial

Who: a free user with an Apple key.
Goal: every tool for 7 days, with no card, without restarting.
Entry: `asc_start_trial` with their address, usually after a refused call.
Success: `Pro trial started`, and the refused call works when retried.

### States on this flow

- Again during the trial, on this machine or another one signed in to the same Apple account: the same trial key, `already_started`. Paid rows are checked first, so this never returns a paid key.
- This Apple account has already trialled, or the address once had a paid subscription: `No new trial is available for <address>`, the price, and a checkout link. A second Apple account on the same address may trial: the email is deliberately not an anchor, so nobody can use up a stranger's trial by typing their address.
- A live subscription on the address: F3.
- Daily cap reached: `Trials are temporarily unavailable`, and an address to write to.

## F5. A license that is not answered or has ended

Who: someone with a key set.
Success: every surface says the same thing, and a paying customer is never sold to.

### States on this flow

- No answer at startup, no earlier verdict here: startup `A license key is set and the license server gave no answer`, instructions say not to offer a price or trial, `asc_setup_check` warns, the gate says `could not be checked`. Startup waits 8 seconds at most.
- The server comes back: the next tool call asks again, at most every 30 seconds, and adopts Pro in the same session.
- No answer, Pro confirmed here within 14 days and not past its expiry plus the 4-day renewal grace: stays Pro. A trial gets no grace.
- Trial ended, or subscription revoked or cancelled and past its period: `Free tier, this license has ended`, instructions say no trial or preview, the gate leads with the price.
- Key not recognized: `This license key was not recognized`, and `/key` to have it emailed again.

## F6. Creating or changing something on sale

Who: anyone whose agent is about to change what customers can buy.
Success: the first call says exactly what would happen and changes nothing, and `confirm: true` does it.

### States on this flow

- `create_iap`, `create_subscription`: `This creates ... at $<price> ... Nothing was changed. Re-run with confirm: true`. Bad arguments are reported first.
- `set_app_price`: a first price needs no confirm, so preflight's fix is one call. Changing an existing price needs it. Negative: `Refusing`. Not a price point: `The nearest is $<price>. Nothing was changed.`
- `set_app_availability`: first setup and widening need no confirm. A territory that is on going off needs it. An unknown code: `Nothing was changed: <code> is not a territory`.

## F7. A visitor who does not know the jargon reads the landing page

Added by `tasks/0003-prd-plain-words-explainer.md`.

1. Landing page, hero: `Ship an App Store release without leaving your agent.` with `Start free, no card` and the install command.
2. Next section, eyebrow `In plain words`, heading `What this does, explained like you're six`: the toy store story, then three things you say (`> how is my toy doing?`, `> is my toy ready?`, `> fix it for me`) with what each does.
3. What it costs: yes-or-no status free with no time limit, everything else 7 days with no card, then $9 a month with the tax wording. Then: the store still decides, and what the toy, office and robot really are.
4. Next section, eyebrow `In your agent`, heading `What it looks like when you ask`: the setup check and trial terminals, then the copyable trial sentence.
5. Works at 320px with no sideways scroll. With scripts off, the text still reads; only the copy buttons do nothing.


## F8. First setup from the page or README

Who: a developer who has never used an MCP server and has never made an App Store Connect API key.
Goal: a working server in their agent and the trial running, without a command failing on the way.
Entry: the hero button `Start free, no card` (goes to `#setup`), or the README `## Setup (about 5 minutes)`.
Success: `asc_setup_check` says every check is OK, then `Pro trial started`.

### Steps

| # | Screen | User does | UI element (exact label) | System shows |
|---|--------|-----------|--------------------------|--------------|
| 1 | Hero | Reads what is needed | The line under the install command: Apple Developer account, API key, Node 18, an app that supports MCP | Link to `setup` |
| 2 | `#setup` step 1 | Makes the key, copies the Issuer ID | `Create an App Store Connect API key.` | `mkdir -p ~/.appstoreconnect/private_keys` then `mv ~/Downloads/AuthKey_*.p8 ...` |
| 3 | Terminal | Runs init | `npx @pofky/asc-mcp init --write` | Found API key, asks for the Issuer ID, writes the config |
| 4 | Agent | Restarts, asks for the check | "run asc_setup_check" (terminal: `npx @pofky/asc-mcp doctor`) | Every check OK, license Free tier |
| 5 | Agent | Asks for the trial with their email | "start my asc-mcp trial" | `Pro trial started` |

### States on this flow

- No `.p8` when init runs: `No .p8 found in the standard location.` with the `mkdir -p` and `mv` lines to copy, then run init again.
- No `.p8` when the server starts: setup mode, only `asc_setup_check` and `asc_guide`; the check's fix line carries the same two commands.
- A paid user with a key: the refusal says `init --write --license <key>` or `ASC_LICENSE_KEY`, and `/key` if it is lost.
- `/key` after a request: the mail comes from asc-mcp, sender address license@brewist.app, the mail service asc-mcp uses.

Change log: 2026-11-04, first-time-user audit. The key folder did not exist on a fresh Mac so the documented `mv` failed; the hero sent "Start free" to pricing and never said an Apple key is needed; the Issuer ID was not located on the site; the role said App Manager in some places and Admin or App Manager in others.
