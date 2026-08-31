v1.9.6: `init` works when an agent runs it

Download **asc-mcp-1.9.6.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**The install path was broken for exactly the people this server is for.**

The documented way in is a coding agent running `npx @pofky/asc-mcp init --write`. An agent has no terminal, so that ran with stdin piped, and the non-interactive branch printed one line of advice and exited. It wrote no config and printed no config block, even when it had just found your `.p8` and `ASC_ISSUER_ID` was already set, which is the case where everything it needed was known. The user was left with no server block and a failure that looked like the package.

`init` now finishes the job without a terminal. It takes `--issuer`, `--key-path`, `--key-id`, `--license` and `--config`, reads the matching `ASC_*` variables when a flag is absent, prints the paste-ready block, and with `--write` writes it into your client config, backing the original up first.

Two things it deliberately will not do: it never invents a value (a missing Issuer ID is reported, not guessed, because a config with a wrong one fails later at Apple's auth with a confusing error), and with several client configs on the machine it prints the block and asks which, rather than picking one for you.

**Licence server: the renewal grace window actually works now**

The four-day grace exists so a late or dropped renewal webhook cannot demote someone who has paid. It could never be reached. The webhook path writes `active = 0` the moment the paid period end is in the past, and the validation check refused an inactive row before it ever looked at the grace window, so the customer it was written for, the one in card retry, was locked out anyway. Revocation stays terminal and is now identified by the revoke timestamp rather than by the active flag, cancellation still ends access when the paid period does, and a trial still gets no grace at all.

The key-recovery and trial endpoints now look at the same rule, so a customer mid-renewal is not told they have no licence. And `POST /key` with a JSON body returns 400 instead of 500.

v1.9.5: the tools that touch your live app now ask first

Download **asc-mcp-1.9.5.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write`.

**Why this release exists**

An agent calls these tools on your real Apple account, on its own, from whatever it inferred from the conversation. So the question worth asking is not "does this work" but "what happens when the model calls it with the minimum arguments the schema accepts, on a shipping app". Calling all 41 tools against a live account, then auditing the write paths, answered that. The answers were not good, and this release is the fix.

**Tools that now require confirm: true**

`manage_phased_release` changed how a live version reaches the public with no confirmation at all. Its `complete` action ends a staged rollout immediately and pushes the version to 100% of users, which is the exact thing a phased release exists to prevent, and it cannot be undone. An agent tidying up a checklist could finish your careful 7-day rollout on day two.

`assign_build_to_group` pushed a build to every tester in a group, and Apple notifies them instantly with no recall. Without a `build_id` it silently picked the newest processed build, which may be a throwaway you uploaded to test something.

`invite_beta_tester` sent a real email from your developer account to whatever address it was handed. An address read out of conversation context is exactly the kind of thing an agent gets subtly wrong.

`create_version` created a version on your live app record. Apple then refuses to delete it ("Only the first version of any platform can be deleted"), so a mistake there is permanent, and the stray version occupies the single editable slot until someone notices.

**Tools that no longer act on an app_id alone**

`set_app_availability` treated an omitted territories list as "on sale in all 175 territories". Calling it to see what it does would have widened the distribution of an app you deliberately limited. It now needs an explicit choice: a territories list, `all_territories: true`, or `[]` for off sale worldwide.

`set_review_contact` sent `demoAccountRequired` on every call, computed from whether you passed a demo account that time. Updating only a phone number therefore cleared a demo account your app already had, and the next reviewer opens an app that needs a login and finds no credentials. The flag is now only touched when you say something about it.

**Writing to the right place**

`upload_screenshots` and `update_version_metadata` fell back to whichever localization Apple happened to return first when no locale was given. Apple does not promise an order. On an app with more than one language that is a coin flip, and these write your public App Store listing: the description, keywords, name and subtitle. They now use the app's own primary locale, and refuse with the list of available locales rather than guess.

`set_app_metadata` set export compliance on the newest build by upload date, with no state filter, so during an upload it landed on the build still processing while the submittable one behind it got none. It now targets the newest VALID build.

`submit_for_review` left an open, empty review submission on your account if any step after the first failed, with nobody told. It now cleans up, and if cleanup fails it hands you the submission id to cancel.

**Upgrading**

Recommended for anyone whose agent has write access to a live app. No configuration changes. Four tools now need `confirm: true`, so a script or prompt that called them without it will get an explanation instead of an action.
