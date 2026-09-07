# Competitors, with dates

One file, one place. Every number here was read from the source on the date next
to it, and every public comparison claim on the site must be copied from this
file, never from memory. The pricing standard wants competitor data verified
within 60 days; anything older than that in the table below is not publishable
until it has been re-read.

Re-verify with:

```
gh api repos/erayendes/app-store-connect-mcp --jq '{desc:.description,license:.license.spdx_id,stars:.stargazers_count,pushed:.pushed_at}'
gh api repos/zelentsov-dev/asc-mcp --jq '{desc:.description,license:.license.spdx_id,stars:.stargazers_count,pushed:.pushed_at}'
```

## Verified 2026-09-07

| Who | What it is | Price | Tools | Stars | Last push |
|---|---|---|---|---|---|
| Heimdall, `erayendes/app-store-connect-mcp` | MCP server generated from Apple's OpenAPI spec, 13 profiles, plus macros for worldwide pricing, submission readiness and metadata diffs | Free, MIT | 890 | 48 | 2026-09-07 |
| `zelentsov-dev/asc-mcp` | MCP server across worker groups, covers Xcode Cloud as well | Free, MIT | 502 | 66 | 2026-08-22 |
| fastlane | Ruby CLI and lanes, the incumbent for App Store automation | Free, MIT | n/a, not an MCP server and not agent-addressable | n/a | active |
| App Store Connect website | Apple's own console | Free | n/a | n/a | n/a |
| asc-mcp (this project) | 41 job-shaped tools, preflight audit, confirm-gated writes, in-agent playbook | $9/month, 6 tools free with no expiry, 7-day trial | 41 | see repo | continuous |

## What changed since the last reading

- `zelentsov-dev` advertised "208 tools across 25 workers" on 2026-08-06
  (`operator-steps.md:88`). It now advertises 502. Do not quote the old number.
- Heimdall now advertises "confirm-before-write safety" and one-call macros in
  its own description. **Our confirm gate is no longer a differentiator on
  paper**, and neither is having macros. Any comparison copy that leans on
  either is claiming something a reader can disprove in one click.

## What this leaves as actually ours

Tool count is a losing axis, and curation alone is not a moat: a competitor can
curate in an afternoon, and Heimdall is already moving that way. What is not
copyable in an afternoon is the accumulated record of what Apple's API silently
refuses, because it is earned by hitting the live API and being refused:
`LIMITATIONS.md`, the four steps that only exist on the website, the
first-IAP-must-ship-with-the-version rule, the appInfo selection trap. That
list, and `asc_guide` which serves it to the agent mid-task, is the honest
claim. State that, not the tool count.
