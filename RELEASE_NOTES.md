# v1.10.3: setup steps that work on a fresh Mac

No tool was added or removed. Help text only, found by walking setup as a first-time user.

- The key folder `~/.appstoreconnect/private_keys` does not exist on a fresh Mac, so the documented `mv` failed. `init`, `asc_setup_check`, `doctor` and the `setup` playbook now print `mkdir -p` first, and `init` says to run it again after.
- Roles read "Admin or App Manager" everywhere.
- A refused Pro call tells a paying user they can run `npx @pofky/asc-mcp init --write --license <key>`, and where to get a lost key emailed again.
- An Apple 403 now says the app id may not be in this account, not only that the key's role is too low. A wrong app id was blamed on the key.
- The README setup is one numbered path, with the other ways to install below it.

Existing users need nothing from this release. Subscribers see no change in what any tool does.
