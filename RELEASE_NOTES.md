v1.10.1: fixes that land where the report said, and keys that only go to their owner

Download **asc-mcp-1.10.1.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx -y @pofky/asc-mcp`.

If you subscribe, nothing changes in how your key works, and you do not need to do anything. Getting your key onto a new machine now always arrives by email: asc_start_trial with your subscription's address, or the form at /key, sends it there. Neither shows it on screen any more, because either one would show it to anyone who typed your address.

Fixes to release_preflight's loop, found by running each rule through its named fix against a stateful test double:

- Export compliance now answers the build attached to your version. It used to answer the newest upload, say it had worked, and leave preflight failing.
- If an app has versions in progress on two platforms, write tools refuse and ask for `platform`, which they now accept, rather than writing to the first they find. Preflight's fix lines name it. With one platform in progress nothing changes.
- submit_for_review opens its submission on the version's own platform. A Mac-only app no longer needs `platform` passed.
- release_preflight reads a Podfile when no lock file is committed, and notices a listed SDK it can only see through an import.

Safer writes:

- set_app_price refuses a negative price, and says which price is nearest rather than charging one you did not ask for. Changing a price the app already has takes confirm: true. Setting a first price does not.
- set_app_availability takes confirm: true to turn territories off on an app already set up, including taking it off sale.
- create_iap and create_subscription take confirm: true, and say what they would make first.

When the license server is down:

- Startup waits 8 seconds at most. A server that never answered could hold it for five minutes, past your client's own limit.
- A subscriber in the renewal grace keeps Pro through an outage.
- A key that got no answer is reported as an outage, not as a bad key, and the startup line no longer offers a trial to someone who would be refused one.

set_age_rating works. Its lookup dropped the field it needed, so on every app it said the app_id might be wrong.

A key that got no answer at startup now asks again on your next tool call, and adopts Pro when the server is back.

An address that once had a paid subscription gets the price, not a new trial.

daily_briefing only says "Action needed" when something is yours to do. assign_build_to_group and invite_beta_tester check the group exists before asking you to confirm. set_app_availability refuses a territory code Apple does not know. competitor_snapshot says its results are the App Store's closest, not exact matches, and asc_guide's topic is now free text.

Smaller things: a lapsed license is no longer told about a trial it cannot have, an unknown asc_guide topic lists the real ones, and arguments like limit: 0 get a plain answer. daily_briefing reads version states in words.
