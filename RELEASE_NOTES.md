# v1.11.2: easier to find

No code changed. The npm and MCP registry descriptions now say what people search for: an App Store Connect MCP server, and a fastlane alternative for AI agents. The README puts the install line first.

Existing users need nothing from this release.

# v1.11.1: every failure says what to do next, and who does it

No tool was added or removed. Every reply was audited for one question: when something is wrong, empty or needs a manual step, does the person or the agent know what to do next?

- A tool call that fails is now marked as an error to your client and ends with a `Next:` line: what to do, and whether the agent does it (call a tool) or you do (Apple's website, Xcode, your connection). This covers Apple's 401, 403, 404, 409, 429 and 5xx, a dropped connection, a missing or damaged `.p8`, and anything unexpected, which points to `asc_setup_check` and then to the issue tracker.
- About 30 replies now name the next step: review rejected (Apple's API has no reasons, so it says where you read them), build processing failed or timed out, no beta groups, no apps, no versions, no sales report for that day, archive, export and upload failures, signing, screenshots, in-app purchases and subscriptions, preflight findings that need Xcode.
- Replies no longer hide what already happened: a failed submission lists products already sent to review, a partial screenshot upload lists files already uploaded, a partial `set_app_metadata` lists what was applied.
- Fixed: `set_app_price` showed the requested price as the current one. `set_app_metadata` said "Nothing to set" when it was given export compliance but no build existed. `manage_phased_release` could act on a version that was not approved or live; it now refuses. `init` printed nothing to paste when the chosen config file was not valid JSON. A list that failed on a later page (reviews, builds) came back partial without saying so; it now reports the failure.
- Create subscription and in-app purchase now report Apple's state instead of saying "ready".

Existing users need nothing from this release. Successful replies change only where they now add the next step.

# v1.11.0: finish setup inside the chat

Installs doubled in early November while trial starts fell to zero. Every step after setup worked when driven end to end, so the wall was setup itself: a terminal command, a JSON config file and a restart before anything showed value.

- New `asc_connect`, present only until the server is connected. Give your agent the Issuer ID and it finds the downloaded `AuthKey_*.p8` (Apple's folder, Downloads or Desktop), tests it against App Store Connect, moves it into `~/.appstoreconnect/private_keys`, saves the Issuer ID in `~/.asc-mcp/credentials.json`, and unlocks every tool in the running session. No terminal, no config file, no restart.
- A wrong Issuer ID, a 401 or a 403 is refused before any file moves, and nothing is saved.
- On the next start the server reads `credentials.json` and starts connected. Your client's own settings always win over it.
- Setup mode's instructions, `asc_setup_check`, `doctor`, the `setup` playbook, the README and the site lead with this path. `init --write` stays as the terminal option.

Existing users need nothing from this release. With credentials in your client config, `credentials.json` is never read and no tool changes.

# v1.10.3: setup steps that work on a fresh Mac

No tool was added or removed. Found by walking setup as a first-time user.

- The key folder `~/.appstoreconnect/private_keys` does not exist on a fresh Mac, so the documented `mv` failed. `init`, `asc_setup_check`, `doctor` and the `setup` playbook now print `mkdir -p` first, and `init` says to run it again after.
- Roles read "Admin or App Manager" everywhere.
- A refused Pro call tells a paying user they can run `npx @pofky/asc-mcp init --write --license <key>`, and where to get a lost key emailed again.
- An Apple 403 now says the app id may not be in this account, not only that the key's role is too low. A wrong app id was blamed on the key.
- Free preview: a reply with nothing in it (no reviews, no beta groups, no builds, one version so nothing to diff) no longer uses one of the 5 free Pro calls, and says so. A first-time tester spent all five on empty answers before reaching preflight.
- The README setup is one numbered path, with the other ways to install below it.

Existing users need nothing from this release. Subscribers see no change in what any tool does.
