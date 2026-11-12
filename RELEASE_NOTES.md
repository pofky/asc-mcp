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
