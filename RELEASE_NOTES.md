v1.10.1: fixes that land where the report said, and keys that only go to their owner

Download **asc-mcp-1.10.1.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx -y @pofky/asc-mcp`.

If you subscribe, nothing changes in how your key works, and you do not need to do anything. Getting your key onto a new machine now always arrives by email: asc_start_trial with your subscription's address, or the form at /key, sends it there. Neither shows it on screen any more, because either one would show it to anyone who typed your address.

Fixes to release_preflight's loop, found by running each rule through its named fix against a stateful test double:

- Export compliance now answers the build attached to your version. It used to answer the newest upload, say it had worked, and leave preflight failing.
- If an app has versions in progress on two platforms, write tools refuse and ask for `platform`, which they now accept, rather than writing to the first they find. Preflight's fix lines name it. With one platform in progress nothing changes.
- submit_for_review opens its submission on the version's own platform. A Mac-only app no longer needs `platform` passed.
- release_preflight reads a Podfile when no lock file is committed.

Safer writes:

- set_app_price refuses a negative price, and says which price is nearest rather than charging one you did not ask for. Changing a price the app already has takes confirm: true. Setting a first price does not.
- set_app_availability takes confirm: true to turn territories off on an app already set up, including taking it off sale.

When the licence server is down:

- Startup waits 8 seconds at most. A server that never answered could hold it for five minutes, past your client's own limit.
- A subscriber in the renewal grace keeps Pro through an outage.
- A key that got no answer is reported as an outage, not as a bad key, and the startup line no longer offers a trial to someone who would be refused one.
