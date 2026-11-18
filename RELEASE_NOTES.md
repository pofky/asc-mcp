# v1.14.0: capabilities, and no gaps left from the first submission

The last gap we hit shipping a new app is closed, and a paying user who goes offline keeps Pro as long as Polar keeps trying their card. Still 45 tools.

New:
- `register_bundle_id` now turns on your app's capabilities too: push notifications, iCloud, Sign in with Apple and the rest. Pass `capabilities` on a new or an existing bundle id. Anything already on is left alone, and if Apple wants settings for one, the reply names it and tells you where to set it.
- `setup_app_store_signing` never installs a profile Apple has invalidated. Turning on a capability invalidates the App Store profile, so with `confirm: true` it now replaces the old one with a fresh one and installs that.

Fixed:
- If your Mac can't reach our license server, a paid key now keeps working for 21 days after a renewal is due, the same time Polar spends retrying a card. It used to stop after 4.
- Before you connect an Apple key, asc-mcp now tells you up front what Pro costs and how the free trial works, instead of only after setup.
- asc-mcp.pages.dev/privacy and /terms now go to the privacy policy and terms instead of a 404.

Existing users need nothing from this release.

# v1.13.0: from submit to Waiting for Review, through an Apple outage

We took a new app through its first App Store submission with asc-mcp itself, during a day-long App Store Connect outage, and fixed what got in the way. 45 tools, up from 44.

New:
- `cancel_submission` pulls back a submission that is waiting for or in review, so you can swap the build and submit again. It asks first (`confirm: true`) and warns when the app's first in-app purchases would have to be re-added on the website.
- `review_status` shows the build the version carries and each in-app purchase and subscription's review state. When the version is in review without a product it offers, the reply says so, since Apple can reject it under guideline 3.1.1.
- `set_app_availability` takes `except_territories` with `all_territories: true`, so "everywhere but mainland China" no longer means typing out 174 territory codes. The guide names China's extra filings.

Fixed, and each one is a bug we hit on a real app:
- `submit_for_review` no longer sends a version to review without its in-app purchases. If Apple refused a product, it used to be skipped without a word. Now the submission stops and tells you which products were refused.
- Reads retry Apple's transient 5xx and network errors with backoff, and every request has a timeout. One call used to hang for five minutes before it gave up. A write is never retried, and a timed-out write says it may have applied and names the read that checks.
- On a 5xx that survives the retries, errors and `asc_setup_check` read Apple's developer status page and name an ongoing outage. They no longer tell you to regenerate a key that is fine.
- The guide and `release_preflight` name Apple's App Compliance page: the regulated medical device declaration (EU/EEA, UK, US) and trader status.

Existing users need nothing from this release.

# v1.12.1: TestFlight review contact, caught before Apple refuses it

Found by running 1.12.0 against a real app with no TestFlight information yet.

Fixed:
- `set_beta_test_info` with review notes, or part of the Beta App Review contact, on an app whose contact was still empty: Apple refuses any change there until first name, last name, email and phone are all set. The preview said it would work and the write failed after the beta description had already been saved. Now the preview and the write both stop before anything is written, name the missing contact fields and ask for them. Once the contact is complete, changing only the notes sends the saved contact along, so Apple accepts it.
- When a later step of `set_beta_test_info` fails, the error now lists what was already saved, so you retry only what was not.
- When Apple says a required value is missing, the hint says the value was not sent. It used to say Apple rejected its format.

Existing users need nothing from this release.

# v1.12.0: a brand-new app, from bundle id to TestFlight, in the chat

Built by taking a new iOS app from a new bundle id to TestFlight through asc-mcp itself. Each time it fell back to the website or a terminal, or a reply was wrong, the cause is fixed here or the reply now names the manual step. Creating the app record stays on Apple's website, because Apple's API refuses it. 44 tools, up from 41.

New:
- `register_bundle_id` registers a new app's bundle id, the first step of a brand-new app. If another Apple account already owns the id, it says so, says nothing was registered, and suggests your account's own prefix.
- `setup_app_store_signing` creates the App Store provisioning profile when the app has none (from your distribution certificates, with `confirm: true`), installs it and writes `ExportOptions.plist`.
- `create_beta_group` creates an internal or external TestFlight group, idempotent by name. `set_beta_test_info` sets the feedback email, description, What to Test and the Beta App Review contact.
- `invite_beta_tester` now adds App Store Connect users on your account to an internal group. It used to send you to the website for that.

Fixed, each one hit on a real app:
- `wait_for_build` takes the build number you just uploaded. Before, right after an upload it could report the previous build as ready, and attaching that would ship the wrong binary. `upload_binary` now names the number to wait for.
- `set_age_rating` knows Apple's newest required question (social media), which made every full declaration fail. It lists every value it writes, defaults included, warns on a fresh app, and shows the rating Apple computed on the current 4+/9+/13+/16+/18+ scale.
- `set_app_metadata` reads a build's export compliance before writing it. Apple refuses a second answer, and the error used to blame the value's format.
- `build_and_archive` returns the `.ipa` this run produced, never an older one in the folder, and `pre_build_command` runs a generator such as `xcodegen generate` first.
- `upload_screenshots` refuses a pixel size Apple will reject before reserving anything, `replace: true` swaps a whole set, and the reply reports Apple's processing state instead of assuming success.
- A Pro key saved to `~/.asc-mcp/license.json` while the server is running is used on the next call, with no restart.
- `app_details` now shows each version's copyright and the newest version's App Review contact, so a missing one is caught before submission instead of by Apple.
- Error hints are matched to the kind of call that failed, so a signing or bundle id error no longer points at review status.

Existing users need nothing from this release. Every new write previews without `confirm: true`.

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
