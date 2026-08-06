# Show HN draft, @pofky/asc-mcp v1.8.1

Refreshed 30 July 2026. Everything below matches what is on npm right now: 41 tools,
6 prompts, 5 free tools, Pro $9/mo, site at https://asc-mcp.pages.dev.

**Title:** `Show HN: I shipped an iOS app to the App Store from my coding agent`

Alternate, if the first reads as too much of a stunt:
`Show HN: An App Store Connect MCP server that ships the release, and admits what it cannot do`

Post Tuesday or Wednesday, 14:00 UTC. First comment within five minutes.

---

## Body

Last month I submitted an app's 1.0 to the App Store without opening App Store Connect,
except for the four things Apple's API genuinely cannot do. The agent set the metadata,
priced three in-app purchase products across 175 territories with free trials, attached
the build, uploaded screenshots, set the age rating, ran a preflight audit, and submitted.
Apple approved it.

The tool is `@pofky/asc-mcp`, an MCP server for the App Store Connect API. 41 tools, and
the part I care about is the honest boundary. These cannot be automated, and I found each
one by hitting it live:

- Creating an app record. `POST /v1/apps` is 403 for API keys, full stop.
- The App Privacy nutrition label. The data usage resource is not in the public API.
- EU DSA trader status. No attribute exists, and it is a legal declaration anyway.
- An app's very first in-app purchases. Apple requires them submitted with the version,
  which only the website can do. My `submit_for_review` detects this and aborts rather
  than orphaning your version, which is the behaviour I wish I had had the first time.
- Xcode cloud signing with a least-privilege key. Fails with a permissions error, so the
  tool creates real distribution profiles and an ExportOptions.plist for manual signing.

Everything else is a tool call: metadata with Apple's character limits validated before
the write, screenshots per display type, build and upload locally with Xcode's toolchain,
TestFlight groups and testers, subscriptions with territory pricing and trials, preflight,
submit, release, phased rollout.

Design decisions that might be interesting:

- `asc_guide(topic)` is free and returns the end-to-end playbook for a flow with every
  manual interruption flagged inline. An agent that reads it first does not walk into a
  wall on step 12. The user guide in the repo is generated from that same source, so the
  docs cannot drift from the tool.
- Outward-facing calls (`submit_for_review`, `release_version`, `upload_binary`) refuse to
  run without an explicit `confirm: true`. An agent has to be told twice.
- Two tools use MCP Sampling, so review triage and reply drafting run on your client's
  model and cost me nothing. The reply tool returns a draft and never posts it.
- Job-shaped tools instead of one-to-one endpoint wrappers. Setting an age rating is one
  call that fetches, merges the full V2 declaration set and submits, because a partial
  PATCH silently loses declarations.

Your `.p8` stays on your machine. JWTs are signed locally, calls go straight to
api.appstoreconnect.apple.com. The only other request validates a license key.

Free tier is five tools with no account: setup check, guide, list apps, app details,
review status. Pro is $9/mo for the other 35, through Polar as merchant of record.

    npx @pofky/asc-mcp init

https://asc-mcp.pages.dev
https://github.com/pofky/asc-mcp

I would like to hear from anyone who has automated the privacy nutrition label or trader
status. As far as I can tell it is not possible, and I would be happy to be wrong.

---

## First comment (post within five minutes)

On why it is not free: there are several free App Store Connect MCP servers that wrap the
API one to one. I did not want to compete on endpoint count. The paid half is the write
and control plane, which is the part that took months of live failures to get right, plus
the preflight audit that catches the rejection before you spend a review cycle on it. Five
tools stay free so you can check your setup and read the playbook before paying anything.

## Mod-rule reminders

- No superlatives in the title. No emoji.
- Title under 80 characters.
- Never ask for upvotes anywhere. HN detects rings and bans permanently.
- Reply to every comment in the first hour.
- If a mod rewrites the title, leave it.
