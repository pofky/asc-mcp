# 0001 - Fix security: shell injection in release_notes (since_tag)

Type: bugfix, SECURITY-CRITICAL. Priority H.

## Symptom
`release_notes` builds a shell string containing the caller-supplied `since_tag` and runs it with `execSync`, so a since_tag like `v1; touch /tmp/x #` executes arbitrary commands as the developer. Reachable via prompt injection and on the free trial.

## Root cause
`src/tools/release-notes.ts:71-79` interpolates `sinceTag` (unvalidated `z.string()` at `src/index.ts:393`) into a `git log ...` command line executed through /bin/sh. Two other `execSync` calls (lines 45 and 58) also use shell strings, one with a `2>/dev/null` redirect.

## Fix approach
1. Switch all three calls to `execFileSync("git", [...args], { cwd, encoding: "utf-8" })`; drop the shell redirect and handle stderr via stdio.
2. Validate `since_tag`: `/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/`, reject otherwise with a clear message.
3. Clamp `max_commits` to an integer in 1..500 in the zod schema and the function.
4. Check `project_path` exists and is a directory before use.

## Affected files
- src/tools/release-notes.ts
- src/index.ts (schema near lines 392-394)
- tests/ (new test file)

## Test plan
- Red before fix: call `releaseNotes({ since_tag: "x; touch <tmpdir>/pwned #" }, "pro")` in a temp git repo and assert the marker file is NOT created; fails on current code.
- A valid tag still produces notes; tags containing spaces, `;`, `$(`, backticks or a leading `-` are rejected.
- max_commits 0, -1, 1e9 and NaN are clamped.
- `npm test` green; also run on the Node 18 engines floor.

## Risks
Stricter validation could reject unusual but legal tag names (for example with `+`); widen the allowlist only with a test. Switching to execFileSync changes stderr handling; keep the "not a git repository" message.

## Verification
Run the red test after the fix (green), `npm run build`, then invoke the tool through the built server with a malicious since_tag and confirm the rejection and no side effect. Add a CI grep that `execSync(` is not used with template strings under src/.
