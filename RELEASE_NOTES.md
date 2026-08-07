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
