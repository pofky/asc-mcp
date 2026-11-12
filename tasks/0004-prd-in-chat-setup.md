# PRD 0004: Finish setup inside the conversation

Status: implementing, 2026-11-12. Type C. Flows amended: F8 (first setup), F4 (trial reached from setup).

## 1. Problem

Measured on 12 November 2026 from production D1 and npm:

- `latest` (1.10.3) was installed 130 times in the week to 12 Nov, about twice the
  66/week baseline recorded on 31 Aug.
- Trial starts by month: Aug 13, Sep 6, Oct 3, Nov 0. The last trial was 30 Oct.
- The last new subscriber was row 84 on 18 Oct.

Every flow after setup was driven on the published 1.10.3 on 12 Nov from a clean HOME and
works: 41 tools, preview counting 4 to 0, gate refusal with price and trial, `asc_start_trial`
unlocking the session, live `/trial`, `/validate`, `/go` (302 to Polar), Polar checkout (200).

What a new install meets first is setup mode: two tools, and instructions to create an Apple
API key, `mkdir -p` and `mv` the `.p8`, find the Issuer ID, edit a JSON config file the user
has never seen (or run `init` in a terminal) and restart the client. The trial, the preview and
every tool that shows value sit behind that. Installs went up while trials went to zero, which
is what a wall at setup produces. The plugin and `.mcpb` installs have a form for this; the npx
installs (registry, Glama, README, Cursor, Claude Code) do not.

We have no count of how many installs stay in setup mode. Adding one is client telemetry, a
privacy-policy change, and is out of scope (legal fork, left to the operator).

## 2. Goal

After creating the key on Apple's site (which no API can do), the user pastes one value, the
Issuer ID, into the chat. Nothing else: no terminal, no JSON, no restart.

## 3. Scope

New tool `asc_connect`, present only in setup mode:

- Input: `issuer_id` (required, UUID), `key_path` (optional).
- Finds the `.p8`: `key_path`, then Apple's standard folder, then `AuthKey_*.p8` in
  `~/Downloads` and `~/Desktop`. Several candidates and no `key_path`: lists them and asks.
- A key outside the standard folder is moved into `~/.appstoreconnect/private_keys` (folder
  created 0700, file 0600), the step the README asks the user to do by hand. Copy then
  unlink when a rename crosses volumes. An existing file of the same name is not overwritten.
- Tests the pair live against App Store Connect (one `GET /v1/apps`). A 401 says the Issuer ID
  and key do not belong together; a 403 says the role is too low. Nothing is saved on failure.
- On success saves `~/.asc-mcp/credentials.json` (`issuerId`, and `privateKeyPath` only when
  it is not in the standard folder), mode 0600. No secret is in it: the Issuer ID is an
  identifier, the key stays in its own file.
- Unlocks the full tool set in the running session: removes the two setup tools, registers
  the full set on the same server, and the SDK sends `notifications/tools/list_changed`.
  The reply says how many apps it found, the tier, the next step (`list_apps`, preview,
  `asc_start_trial`) and: if the client still lists two tools, restart it once.

Startup: when `ASC_ISSUER_ID` / `ASC_PRIVATE_KEY_PATH` are unset (or empty, as a plugin with a
blank field passes them), they are read from `credentials.json`. Environment always wins.
`doctor` reads the same file.

Setup-mode instructions and `asc_setup_check` lead with this path. README, site `#setup`,
`asc_guide` setup topic name it as the first option; `init` stays as the terminal option.

Out of scope: telemetry; the trial or price; any Pro behaviour; full-mode tool count (stays 41,
`asc_connect` does not exist once connected).

## 4. Flow F8, amended

| # | Screen | User does | Exact label | System shows |
|---|--------|-----------|-------------|--------------|
| 1 | Client | Adds the server (`npx -y @pofky/asc-mcp`) | | Two tools: `asc_setup_check`, `asc_guide`, plus `asc_connect` |
| 2 | Chat | Asks anything | | Agent: create a key at Integrations > App Store Connect API, download it, paste the Issuer ID |
| 3 | Apple site | Creates key, downloads `AuthKey_X.p8`, copies Issuer ID | | |
| 4 | Chat | Pastes the Issuer ID | `asc_connect` | `Connected to App Store Connect: 11 apps. Your key was moved from ~/Downloads to ~/.appstoreconnect/private_keys/AuthKey_X.p8.` then the tier line |
| 5 | Chat | Keeps going | `list_apps`, a preview tool, `asc_start_trial` | Same as before |

States: bad UUID (refused before any file is touched), no key found (where it looked, the
Apple link), several keys (names them, asks for `key_path`), 401, 403, Apple unreachable,
home not writable (connects for this session, says it will not survive a restart), client
without list_changed (restart line).

## 5. Milestones

- M1 `src/connect.ts`: find, move, test, save, load. Unit tests with a temp HOME and an
  injected live check.
- M2 `src/index.ts`: full registration extracted to `registerFullTools`; setup mode registers
  `asc_connect` and hot-swaps. Integration test over stdio with a fake Apple endpoint is not
  possible (the base URL is fixed), so the swap is tested with the live check injected via
  the module and driven once against real Apple.
- M3 copy: setup instructions, doctor fix line, guide, README, site, FLOWS F8.
- M4 release 1.11.0 on every surface, driven on the published package from a clean HOME.

## 6. Risks

- Moving a user's file. Mitigation: only `AuthKey_<10 chars>.p8`, only when the user called
  the tool, never overwrite, reply states both paths.
- Existing users: env set, so `credentials.json` is never read; full-mode server unchanged
  except registration moved into a function. Verified by the existing suites plus a Pro drive.
- Client ignores list_changed: restart picks up `credentials.json`, so it still works.
