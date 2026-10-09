# Feature: list asc-mcp in Anthropic's directory as a plugin

Source: `.autopilot/queues/autonomous-backlog.md` [M], evidence M3 in
`autopilot/docs/learnings/podcasts-2026-10/by-theme/marketing-users-revenue.md`.
Type C. Docs read first-hand on 2026-10-09: `claude.com/docs/plugins/submit.md`,
`plugins/pre-submission-checklist.md`, `plugins/build.md`,
`connectors/building/submission.md`, `connectors/building/review-criteria.md`,
`code.claude.com/docs/en/plugins/manifest-reference`, and the Software Directory Policy.

## Problem
Nobody arrives. npm `latest` took 53 installs last week, the repo had 4 visitors in 14 days, and
no trial has started since 19 September. The directory is the one free channel where someone
already running Claude is browsing a list of installable tools. asc-mcp cannot be submitted today:

- 40 of 43 tool registrations in `src/index.ts` carry no `title` and no `readOnlyHint` or
  `destructiveHint`. The directory flags every such tool.
- There is no `.claude-plugin/plugin.json`. The directory no longer takes `.mcpb` for local servers.
- `README.md` has a Legal link list but no "Privacy Policy" section. Local connectors without one
  are rejected outright.

## Scope

### M1. Annotations, one table
- New `src/tool-meta.ts`: `TOOL_META`, a record of tool name to `{ title, effect }` where effect is
  `"read"` or `"write"`. One list, read by both server modes.
- `"read"` becomes `readOnlyHint: true`. `"write"` becomes `readOnlyHint: false,
  destructiveHint: true`. The directory defines destructive as "modify or delete data" and
  always prompts for it, which is right for every write here: each one acts on a live App Store
  account, a tester's inbox, the keychain or a client config file.
- Read tools: `asc_setup_check`, `asc_guide`, `list_apps`, `app_details`, `review_status`,
  `list_reviews`, `sales_report`, `release_preflight`, `daily_briefing`, `release_notes`,
  `keyword_insights`, `competitor_snapshot`, `metadata_diff`, `list_builds`, `wait_for_build`,
  `list_beta_groups`, `set_privacy_nutrition`, `set_eu_trader_status` (the last two return steps
  and a link and write nothing; verify in the code before marking).
- Everything else is a write, including `asc_start_trial` (mails an address, edits a client
  config) and `build_and_archive` / `setup_app_store_signing` (write to disk).
- `src/index.ts`: a local `tool(name, description, schema, handler)` helper per server mode that
  calls `server.registerTool` with the title and annotations from the table and throws on a name
  the table does not know. Call sites change by one token. `asc_start_trial` moves to the table too.
- No description changes. Title is set both top-level and in `annotations.title`.

### M2. The plugin folder
The plugin is a subfolder, `plugin/`, not the repo root. Installers receive the plugin folder, and
the root would hand them the licence worker, the site and `Marketing/`, and make Claude Code run
`npm ci` on our lockfile for nothing.

- `plugin/.claude-plugin/plugin.json`: `name` `asc-mcp`, `displayName`, `version`, `description`,
  `author`, `license`, `homepage`, `repository`, `keywords`, `documentationUrl`, `supportUrl`,
  `privacyPolicyUrl`, `termsOfServiceUrl`, `userConfig`, and `mcpServers` inline:
  `npx -y @pofky/asc-mcp@<exact version>` with env from `${user_config.*}` and
  `ASC_INSTALL=plugin`. An exact pin is mandatory (a range blocks) and is still held for a human
  reviewer, which is expected and not avoidable for an npm-distributed server.
- `userConfig`: `asc_issuer_id` (required), `asc_private_key` (file, optional, auto-discovered
  from Apple's standard path), `asc_license_key` (sensitive, optional).
- `plugin/skills/asc-review-triage/`, `plugin/LICENSE`: copies. Symlinks block validation.
- `plugin/README.md`: hand-written, the listing description. What it does, setup, what it runs
  and sends, and the Privacy Policy section.
- `scripts/sync-plugin.mjs`: writes the version and the pin from `package.json`, copies the skill
  and the licence. `--check` exits non-zero on drift. `scripts/release.mjs` runs it after the
  version bump so the release commit carries the new pin. A test runs `--check`.
- `src/index.ts`: an optional `userConfig` field left blank can arrive empty or as the literal
  `${user_config.x}`. Any `ASC_*` variable that is blank or contains `${` is dropped once, before
  dispatch, so the server, `doctor` and the Pro gate all see it as unset (see the review below).
- The two "where to paste your key" messages (`src/index.ts:285`, `src/gate.ts:98`) gain a
  `plugin` branch.

### M3. README
- The "Privacy Policy" section the directory requires lives in `plugin/README.md`, the README the
  directory reads. It covers collection, use and storage, third-party sharing, retention and
  contact, each stated from the published policy. Root `README.md` links to it and does not
  repeat it: two copies of a privacy summary drift, and this policy has drifted three times.
- Root `README.md` gains the plugin install line. `.claude-plugin/marketplace.json` at the repo
  root makes `pofky/asc-mcp` a marketplace, so the plugin installs in Claude Code today, before
  and independent of the directory review.

## Not in scope
- The portal submission. It needs a claude.ai login and GitHub OAuth: operator.
- Rewording tool descriptions or the free-tier instructions. See Risks.
- Submitting as a remote MCP connector. The `.p8` never leaves the machine by design.

## Gates
- A test drives the built server over stdio in both modes and fails if any listed tool lacks a
  `title`, or lacks both hints, or if a tool marked read-only is in the write set.
- `TOOL_META` has no entry that is not registered in full mode (no dead rows).
- `node scripts/sync-plugin.mjs --check` passes; `claude plugin validate ./plugin` passes.
- Root suite and `tsc --noEmit` clean. Legal gate on the README privacy text.

## Risks
1. **The review may object to the upsell.** Review criteria reject descriptions that "promote
   products and services"; the policy bars software that is "primarily" a promotional vehicle and
   is otherwise silent on paid tiers. Ours say "Pro feature." (a fact the user needs: the tool
   will refuse) and `asc_start_trial` says when to call it. Left as is: these strings are the
   whole conversion path and a reviewer's actual finding is cheaper than a guess. If it comes
   back, the fix is wording, pushed to the tracked branch.
2. **Chat ignores local servers.** A local stdio server loads in Claude Code and in Cowork on the
   user's machine only. The listing still shows everywhere.
3. **The pin can go stale.** Mitigated by the sync step in the release script and the drift test.
4. **`asc_start_trial` collects an email.** Policy 1(D) limits collection to what the function
   needs. The address is needed to deliver the key, and the tool already discloses what is stored.
5. **Policy 5(G) wants current dependencies.** `@modelcontextprotocol/sdk` is 1.29.0 against
   1.32.1, `zod` 4.3.6 against 4.6.5. Bump both within their ranges in the same release.

## Architect review, 2026-10-09 (before code)
Findings taken, all in the implementation:
1. A blank optional setting reached three readers outside `getConfig` (`src/gate.ts:85`,
   `src/doctor.ts:64`, `src/doctor.ts:176`), so a free plugin user would have been told their key
   failed. Fixed at the source instead: `src/index.ts` drops any blank or unexpanded `ASC_*`
   value once, before dispatch.
2. `scripts/release.mjs` pushed master before npm served the version, which would have pinned
   the directory's tracked branch at a version that did not exist yet. The master push now
   follows the publish, the sync step runs before the tests, and the build runs before the tests.
3. `triage_reviews` and `draft_review_response` are reads. They sample and never post.
4. The annotations test fails on a missing build instead of skipping.
5. `asc_setup_check` writes `~/.asc-mcp/last-verdict.json` when a key validates. Still a read
   for the account; the file is disclosed in the plugin README.
6. `scripts/set-checkout-url.mjs` gained the copied skill. The dependency floors in
   `package.json` were raised, since a lockfile bump alone changes nothing for an `npx` user.
7. The helper types the tool name against the table, so a missing row fails `tsc`, not startup.

## Gates run after the build, 2026-10-09
- Independent tester: every item passed; three defects found and fixed (the release could
  strand a tag, `--check` ignored stray files, the README omitted the signing-profile writes).
- Legal gate: FAIL, report `.autopilot/reports/legal-2026-10-09-plugin-directory.md`. Fixed:
  the Key ID claim (also false in the policy and on the site), the telemetry absolute, the
  undisclosed flows (npm, altool, xcodebuild, sampling, the buy-link counter, the Polar record),
  the email purposes, Polar's role, the pricing terms, the display name, and the price and
  checkout link in the bundled skill.
- **Deliberately not taken (B8):** rewriting `asc_start_trial`'s description and the free-tier
  instructions so Claude never mentions the trial first. Those strings are what moved trials
  from one a week to three in nine days in September. The auditor rates a rejection on them as
  less certain than the skill and calls the instructions part inference. If the reviewer
  objects, the auditor's replacement wording is in that report, section B8.
- Completeness: FAIL on stale release notes, which would have shipped 1.9.12 under the 1.9.11
  title. Notes written; `scripts/release.mjs` now refuses notes that do not name the version.
