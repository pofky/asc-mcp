Verdict: PASS

# Legal re-check: trial key persistence (uncommitted working tree, 2026-10-09)

Scope: re-check only, of findings F1 to F11 from the first review of this change (first verdict:
FAIL), plus any new inaccurate claim the fixes introduced. Nothing else was re-reviewed.

How this was checked: by reading the current working-tree files. This session had no shell, so
nothing was executed, no test was run, and `git diff` was not consulted. Line numbers are
working-tree line numbers at the time of the re-check.

Result: all eleven findings are closed. Four non-blocking items remain (N1 to N4). N1 is the one
worth fixing before release: it is a narrower version of the F5 harm, and it exists because the
condition recommended in the first review ("and no config was updated") was too loose.

## Original findings and status

| ID | Was | Status | Where verified |
|----|-----|--------|----------------|
| F1 | Blocking. Privacy policy silent on local files, "stores nothing" false | CLOSED | license-worker/src/index.ts:1514, :1538-1545 |
| F2 | Blocking. README silent on the file and config edits, Step 4 incomplete | CLOSED | README.md:99, :301 |
| F3 | Blocking. plugin/README listed wrong config files and a dead fallback | CLOSED | plugin/README.md:55, :75 |
| F4 | Blocking. Paid licence email promised an outcome only one branch delivers | CLOSED | license-worker/src/logic.ts:834, :838, :850-855, :872-873 |
| F5 | Blocking. "Survives a restart, nothing to edit" false with a hand-set key | CLOSED, see N1 | src/index.ts:83, :345-360, :369 |
| F6 | Blocking. "Three need nothing" left in Terms and four other places | CLOSED | license-worker/src/index.ts:1593, :1606; README.md:289; site/index.html:632, :634; site/llms.txt:11 |
| F7 | "Written into your MCP config" incomplete in three places | CLOSED | site/index.html:635; site/llms.txt:48; src/gate.ts:66-67 |
| F8 | "Readable only by your user" overclaim | CLOSED, see N3 | plugin/README.md:75; src/license.ts:156-159 |
| F9 | Tool description silent on local writes | CLOSED | src/index.ts:284 |
| F10 | Key and .bak can land in a committed project folder, no warning | CLOSED, see N2 | src/index.ts:347, :352-354 |
| F11 | args matched by substring | CLOSED | src/setup.ts:141-150 |

Notes on what was confirmed for each:

- F1. :1514 now reads "stores nothing with us" and points to the new section. The section names
  `license.json` (plain text, when written, when read, how to remove), `last-verdict.json` (hash
  not key, 14 days, matches OFFLINE_GRACE_MS at src/license.ts:86), and the config edits with the
  `.bak` caveat. The /delete paragraph at :1545 says deletion cannot reach the machine. "It is
  given owner-only permissions" is accurate now that the file is chmod-ed after every write.
- F2. Step 4 names the file and the config condition. The Security bullet lists the same six
  targets as `clientConfigCandidatesForTest` (src/setup.ts:98-108) and the per-project entries
  (src/setup.ts:119-132).
- F3. The licensing paragraph lists all six targets, includes fetching a paid key, states the
  `.bak` holds whatever the file held, describes the fallback correctly (only when neither a config
  nor `license.json` can be written, matching src/index.ts:360), and says the License key option
  wins. The `asc_start_trial` bullet is present under what the plugin runs.
- F4. Both html and text condition the result on "the Apple developer account that first does
  this", tell the reader to replace a key already set in the client, and say what happens from a
  different Apple account. That matches license-worker/src/index.ts:919-952. The confirmation step
  is now `asc_setup_check`, and its License line does say "Pro: all tools unlocked."
  (src/doctor.ts:200).
- F5. `licenseKeyFromClient` is captured at :83, after the placeholder clean-up at :72-76 and
  before the saved key is loaded at :90-93, so it holds only what the client supplied.
  `staleClientKey` (:345-346) is true when that key exists, differs from the fetched key, and no
  config was updated; the message then says the other key is used after a restart and where to
  replace it (:358). When a config was updated and the file was saved, both are named (:349-351).
  The "It is now in your config, replacing whatever key was there" sentence is gone (:369).
- F6. No remaining "three need nothing" or "first three" wording in README.md, USER_GUIDE.md,
  RELEASE_NOTES.md, plugin/README.md, site/index.html, site/llms.txt, src or license-worker/src.
  Terms date is October 9, 2026.
- F8. Wording is "with owner-only permissions on macOS and Linux". `chmodSync(path, 0o600)` runs
  after the write, so an older file with looser permissions is tightened.
- F11. An argument matches only if it equals `@pofky/asc-mcp` or starts with `@pofky/asc-mcp@`.

## Config file lists against src/setup.ts

`clientConfigCandidatesForTest` returns six: Claude Desktop, `~/.claude.json`, `.mcp.json` in the
working directory, Cursor, Windsurf, Cline. The privacy policy (:1543), README.md:301,
plugin/README.md:75 and the tool description (src/index.ts:284, generic wording) all agree with it.
No list disagrees.

## New or remaining items, none blocking

### N1. "So it survives a restart" is still false when a config was updated but not the one this client reads
File: src/index.ts:345-351

`staleClientKey` requires `!updated.length`. So if any known config was rewritten, the warning is
suppressed and the reply ends "so it survives a restart", even when the client that is running
keeps its key somewhere no config edit can reach.

Concrete case: a developer has the Claude Desktop extension (or the Claude Code plugin) with the
trial key pasted into its License key field, and also has asc-mcp in `~/.cursor/mcp.json` or
`~/.claude.json`. They subscribe and run `asc_start_trial` in Desktop. The paid key goes into the
Cursor config and `license.json`. The reply says "Saved to ~/.cursor/mcp.json (backup alongside)
and to ~/.asc-mcp/license.json, so it survives a restart." After a restart Desktop still sends the
expired trial key, which wins over `license.json`, and the subscriber is on the free tier. The same
holds for any client outside the six that has a key in its own config.

Why this is not blocking: the reply names the files it wrote, and the licence email (logic.ts:834),
the plugin README and the privacy policy all now say a key set in the client wins. Why it should
still be fixed before release: it is the F5 harm, to a paying customer, and the first review's own
recommended condition is what left it.

Fix: for `ASC_INSTALL` of `mcpb` or `plugin`, a config edit can never replace the client's key
(the code's own comment at :329-334 says so), so do not let `updated.length` suppress the warning
there:

    const configCannotReachClient =
      process.env.ASC_INSTALL === "mcpb" || process.env.ASC_INSTALL === "plugin";
    const staleClientKey =
      Boolean(licenseKeyFromClient) && licenseKeyFromClient !== result.key &&
      (!updated.length || configCannotReachClient);

and append the existing "A different key is set in your client's own settings..." sentence in the
`updated.length` branch too when `staleClientKey` is true, in place of ", so it survives a
restart". For other installs with a config updated, the server cannot tell whether the updated
file is the one that launched it; a softer line covers it: "If this client had a different key in
its own settings, check it now shows the key above."

### N2. The version-control warning can name files that are not in a project folder
File: src/index.ts:347, :353

`updated.filter((path) => path.startsWith(process.cwd()))` matches every updated path when the
working directory is the home directory or `/`, which is what a desktop client often starts a
server in. The reply then says, for example, "~/.claude.json, ~/.cursor/mcp.json is in this
project folder and is often committed". That statement is untrue for those files. The error is in
the cautious direction, so no harm follows, but it is a new inaccurate sentence. Only one candidate
is ever in the working directory. Fix: `updated.filter((p) => p === join(process.cwd(), ".mcp.json"))`.

### N3. RELEASE_NOTES.md still carries the F8 overclaim
File: RELEASE_NOTES.md:9

Current: "...in `~/.asc-mcp/license.json`, readable only by your user, and read at startup..."
The same notes offer the bundle for "macOS and Windows" at :3, and the mode has no effect on
Windows. This file was not named in F8, so the fix did not reach it.
Replacement: "...in `~/.asc-mcp/license.json`, with owner-only permissions on macOS and Linux, and
read at startup..."

### N4. The key lookup page still uses the confirmation step F4 removed from the email
File: license-worker/src/index.ts:1487 (the /key result page, not `licenseEmailContent`)

Current: "Then ask it to "list my App Store Connect apps" to confirm Pro is active."
`list_apps` is free and succeeds without Pro, so it confirms nothing. Not part of F4 as written,
and it predates this change.
Replacement: "Then ask it to run asc_setup_check; the License line says Pro."

Smaller wording note, no action needed: README.md:99 says "any MCP client config that already has
an asc-mcp entry". The precise claim is the six configs listed at README.md:301; a client outside
those is not edited. The Security bullet in the same file states it exactly.

## Action items
1. src/index.ts:345-351: close N1 before publishing.
2. src/index.ts:347: N2, exact match on the working-directory `.mcp.json`.
3. RELEASE_NOTES.md:9: N3 wording.
4. license-worker/src/index.ts:1487: N4 wording, with the next worker deploy.
5. Deploy the licence worker with the npm release, so the live policy and Terms match the package.
