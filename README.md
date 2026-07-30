# App Store Connect MCP Server

> **Full control of App Store Connect from your coding agent.** 40 tools: read intelligence that thinks, plus write/control that ships your app end to end (edit metadata, upload screenshots, attach builds, TestFlight, submit, release, even build and upload the binary locally). 6 slash-command workflows and a bundled Claude Skill. Not another API wrapper.

[asc-mcp.pages.dev](https://asc-mcp.pages.dev) &middot; [npm](https://www.npmjs.com/package/@pofky/asc-mcp) &middot; [Pricing: free tier, Pro $9/mo](https://asc-mcp.pages.dev/#pricing)

Maintained successor to [JoshuaRileyDev/app-store-connect-mcp-server](https://github.com/JoshuaRileyDev/app-store-connect-mcp-server) (archived Feb 2026). Different angle, same API surface plus more.

```bash
npm install -g @pofky/asc-mcp
asc-mcp install-skill   # one-line, optional, for auto-routed review questions
```

## What Makes This Different

Other ASC MCP servers wrap the API and give you 80 to 293 raw endpoints. This one gives you 40 opinionated tools, 6 slash-command Prompts, and a Claude Skill that all think. The read tools summarize and audit; the Pro control tools actually drive App Store Connect, from editing metadata to submitting and releasing, with the same API key. Two tools use MCP Sampling: your own client's model does the LLM work, so there is no extra cost from this server.

**Why full control is possible without fastlane:** fastlane's `deliver` and `pilot` are just calls to the same App Store Connect REST API this server authenticates against with your `.p8`. So nearly everything you would script with fastlane is a tool here, no Ruby toolchain required. The only step that needs your Mac is building and signing the binary, which `build_and_archive` and `upload_binary` drive via Xcode.

| You say | What happens |
|---------|-------------|
| "Run a preflight check on my app" | Audits metadata, character limits, screenshots, build status. Catches the issues that cause 40% of rejections. |
| "Give me a morning briefing" | Summarizes all your apps: who's in review, who got rejected, new low-rating reviews, action items. |
| "Generate release notes from my git history" | Reads commits since last tag, categorizes them, and gives you structured data to write "What's New" text. |
| "List my apps" | Shows all your iOS/macOS apps with bundle IDs |
| "Is my app in review?" | Exact review state with context ("typical time: 24-48 hours") |
| "Show me 1-star reviews" | Customer reviews filtered by rating, territory, sorted by date |
| "What were my downloads this week?" | Sales and revenue summary by territory |

No context switching. No portal. Just ask.

## Setup (3 minutes)

**Step 1.** Create an API key in [App Store Connect > Integrations > App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api) (Admin or App Manager role), then grab three things from that same page:

- **Issuer ID** (`ASC_ISSUER_ID`): the UUID shown at the top of the page, with a copy button next to it.
- **Key ID** (`ASC_KEY_ID`): the 10-character ID next to your key, also in the filename `AuthKey_XXXXXXXXXX.p8`.
- **`.p8` file** (`ASC_PRIVATE_KEY_PATH`): click **Download** and point this at the saved file. Apple lets you download it only once, so keep it safe.

**Step 2.** Install:

```bash
npm install -g @pofky/asc-mcp
```

No global install needed if you prefer `npx` (see the manual config below).

**Fastest setup (recommended).** Drop your `.p8` into Apple's standard path `~/.appstoreconnect/private_keys/` (the file is named `AuthKey_XXXXXXXXXX.p8`, and the Key ID is in the filename). Then run:

```bash
asc-mcp init --write     # auto-detects the key, asks for your Issuer ID, and writes the config for you
# or: asc-mcp init       # same, but prints the block to paste yourself
```

`init --write` finds your Claude Desktop / Claude Code config, backs it up, and merges in the server block, so there's no JSON editing. The server also auto-discovers the `.p8` path at runtime, so you only ever need `ASC_ISSUER_ID` (and `ASC_LICENSE_KEY` for Pro).

**Stuck?** Run `asc-mcp doctor` (or ask your agent to call `asc_setup_check`). It checks your key, Issuer ID, a live connection to App Store Connect, and your license, and prints the exact fix for anything wrong. In your agent, the `/asc-start` command walks a first-time user through all of this.

**Manual setup.** Add to your agent's MCP config (Claude Desktop config, or `~/.claude.json` for Claude Code). Use `npx` for zero-install, or `asc-mcp` if you installed globally:

```json
{
  "mcpServers": {
    "appstore-connect": {
      "command": "npx",
      "args": ["-y", "@pofky/asc-mcp"],
      "env": {
        "ASC_ISSUER_ID": "YOUR_ISSUER_ID"
      }
    }
  }
}
```

With the `.p8` in `~/.appstoreconnect/private_keys/`, `ASC_ISSUER_ID` is the only required env var (Key ID and key path are auto-detected). Add `ASC_LICENSE_KEY` to unlock Pro.

**Step 3.** Ask your agent: "List my App Store Connect apps"

Works with **Claude Code**, **Cursor**, **Windsurf**, **Cline**, and any MCP-compatible client.

## Tools

### Free (no account needed)

| Tool | What it does |
|------|-------------|
| `asc_setup_check` | **Run first if anything's off.** Checks your key, Issuer ID, a live App Store Connect connection, and license tier, and prints the exact fix for each failure. |
| `asc_guide` | **Start here.** The in-agent playbook for every flow (first release, update, IAP, subscriptions, reviews, TestFlight, binary), with each manual App Store Connect website step flagged inline. See also [USER_GUIDE.md](USER_GUIDE.md) and [LIMITATIONS.md](LIMITATIONS.md). |
| `list_apps` | List all your apps with name, bundle ID, SKU, platform |
| `app_details` | Version history, build status, release state, dates |
| `review_status` | Current review state with human-readable context |

### Pro ($9/mo)

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `list_reviews` | Customer reviews filtered by rating, territory, sort order | See what users say without opening the portal |
| `sales_report` | Daily/weekly/monthly downloads and revenue by territory | Know your numbers instantly |
| `release_preflight` | Pre-submission audit: metadata, char limits, screenshots, builds | Catches 40%+ of common rejection causes before you submit |
| `daily_briefing` | Morning summary across all apps: status, reviews, rejections | One call replaces 10 minutes of portal clicking |
| `release_notes` | Git commits since last tag, categorized for writing "What's New" | Your AI agent writes release notes from your actual changes |
| `keyword_insights` | Analyze keywords against iTunes search competition, difficulty ratings | See which keywords are worth targeting at a glance |
| `competitor_snapshot` | Look up any app: ratings, reviews, version, price, release notes | Competitive intelligence without leaving your editor |
| `metadata_diff` | Compare live vs pending version metadata across all locales | Verify exactly what changed before submitting |
| `triage_reviews` | Pulls recent reviews and clusters them into 3 to 5 themes with counts, action buckets, and quotes, using MCP Sampling | Zero extra cost: your client's model does the clustering |
| `draft_review_response` | Drafts a public reply to a single review in the review's locale, via Sampling. Elicits tone if your client supports it. Never auto-posts. | Apple guideline 1.2 respected; you paste into ASC yourself |

### Control & Ship (Pro)

These tools write to App Store Connect. Every outward-facing action (submit, release, upload binary) requires an explicit `confirm: true`, so nothing leaves your machine by accident.

| Tool | What it does |
|------|-------------|
| `create_version` | Create a new editable App Store version for your next release |
| `update_version_metadata` | Edit description, keywords, what's-new, promo text, URLs, app name, subtitle. Validates Apple's character limits and refuses over-limit writes |
| `upload_screenshots` | Upload screenshots for a device display type (reserve, upload, commit, with checksum) |
| `list_builds` | List recent builds and their processing state (VALID = ready) |
| `attach_build` | Attach a build to the editable version (defaults to newest processed build) |
| `submit_for_review` | Submit the version to App Review (modern reviewSubmissions flow). `confirm: true` required |
| `release_version` | Release an approved version to the public App Store. `confirm: true` required |
| `manage_phased_release` | Start, pause, resume, or complete the 7-day phased rollout |
| `list_beta_groups` | List your TestFlight beta groups |
| `assign_build_to_group` | Push a build to a beta group so testers can install it |
| `invite_beta_tester` | Invite an external tester by email and add them to a group |
| `set_app_metadata` | Set primary/secondary category, copyright, content-rights, and export-compliance (encryption) in one call |
| `set_app_price` | Set the base price by creating the price schedule (`price_usd: 0` for free), auto-equalized to all territories |
| `set_app_availability` | Make the app available in all App Store territories (or a subset), with auto-include for future ones |
| `set_review_contact` | Set the App Review contact and optional demo account on the version |
| `set_age_rating` | Set the v2 age-rating declaration (full content-descriptor set) |
| `set_privacy_nutrition` | Guidance + deep link for the App Privacy nutrition labels (not API-addressable) |
| `set_eu_trader_status` | Guidance + deep link for the EU DSA trader status (not API-addressable) |
| `create_iap` | Create a non-consumable/consumable IAP with localization, availability, and an auto-equalized price |
| `create_subscription` | Create a subscription group, sub, localization, availability, price, and free trial |
| `set_iap_review_screenshot` | Attach the App Review screenshot to a subscription or IAP |
| `setup_app_store_signing` | Download the app's App Store provisioning profiles and write a manual-signing `ExportOptions.plist` (works with a least-privilege API key) |
| `build_and_archive` | Build, archive, and export a signed `.ipa` via xcodebuild (needs Xcode on your Mac) |
| `upload_binary` | Upload the `.ipa` to App Store Connect via altool, using your API key. `confirm: true` required |

The whole flow chains: `setup_app_store_signing` to `build_and_archive` to `upload_binary` to `list_builds` (wait for VALID) to `attach_build` to `update_version_metadata` to `upload_screenshots` to `set_app_metadata`/`set_app_price`/`set_app_availability`/`set_age_rating`/`set_review_contact` to `release_preflight` to `submit_for_review` to `release_version`. The `/asc-ship-release` slash command drives it for you.

`release_preflight` is the single source of truth for "is this submittable": it checks every API-addressable field and ends with a tailored "Manual steps to finish" list for the few things Apple only allows in the website (first-IAP bundling, App Privacy nutrition labels, EU trader status).

[Get Pro](https://buy.polar.sh/polar_cl_Ta3OxEA1EbRyYNPFtSsRXgYWBCCtjwMxlbAeW35RLuu) | [Retrieve your license key](https://asc-mcp-license.remewdy.workers.dev/key)

## What stays manual (and why)

A handful of things Apple does not expose to API keys. The MCP never pretends otherwise: it either returns the exact website steps plus a deep link, or detects the case and aborts so nothing is half-done. Full detail in [LIMITATIONS.md](LIMITATIONS.md) (and `asc_guide topic:limitations`):

- **Create an app record / App Group.** `POST /v1/apps` is forbidden for API keys; do it once in the website.
- **App Privacy nutrition label.** Not in the API. `set_privacy_nutrition` returns the checklist plus a deep link.
- **EU DSA trader status.** Not in the API. `set_eu_trader_status` returns the steps. Legal decision.
- **An app's first IAPs/subscriptions.** Must be submitted with the version in the website; `submit_for_review` aborts rather than orphan the version. Later products submit via the API.
- **Certificate creation / cloud signing.** Least-privilege keys can't; `setup_app_store_signing` uses manual-signing profiles instead.
- **Compiling the binary.** Needs Xcode on your Mac (`build_and_archive` runs it locally).
- **Posting a public review reply.** `draft_review_response` writes it; you paste it in the website.

## How Sampling works (zero extra cost)

`triage_reviews` and `draft_review_response` use the MCP Sampling primitive. When you call one of these tools, this server sends a `sampling/createMessage` request back to your own MCP client. Your client runs the LLM locally (Claude Desktop uses your account; Claude Code uses its session). We never call Anthropic from our side.

Outcome: review clustering and reply drafting cost you exactly what you would pay for any other Claude request, not a penny more from this server.

If your MCP client does not support Sampling yet, both tools return a structured `degraded: true` result with a clear explanation. Upgrade Claude Desktop or Claude Code to a recent version for full functionality.

## Slash Commands (Prompts)

Type these in Claude Desktop or Claude Code and the agent runs a pre-built multi-tool workflow:

| Slash command | What it does |
|---------------|--------------|
| `/asc-start` | New here? Verifies the connection, lists your apps, explains free vs Pro in plain language, and recommends your next step. No App Store Connect knowledge assumed. |
| `/asc-weekly-review` | Calls `daily_briefing` then `list_reviews` (low-rating, last 7 days) for every app, clusters themes, returns a single digest with 3-bullet action list. |
| `/asc-rejection-audit` | Given an `app_id`, calls `release_preflight` + `metadata_diff` + `review_status`, reads the result against the top 2026 rejection drivers (guideline 2.3 metadata, 4.0 design, privacy-AI 5.1.2). Produces Blocking / Likely-flagged / Safe sections. |
| `/asc-release-go-no-go` | Given an `app_id`, combines preflight + review queue + metadata diff + top competitors in the same category. Returns a direct GO or NO-GO with three supporting reasons. |
| `/asc-ship-release` | Given an `app_id`, drives the full release: locate or create the editable version, push metadata, attach the newest build, upload screenshots, run preflight, then submit. Stops to confirm before every outward-facing step. |
| `/asc-first-app` | Given an `app_id`, drives a brand-new app's first 1.0 from existing app record to submitted, handling every first-time-only constraint and stopping at each manual website step (privacy label, trader status, first-IAP bundling). |

These are MCP Prompts per the [spec](https://modelcontextprotocol.io/docs/concepts/prompts/). Zero other App Store Connect MCP ships with them.

## Claude Skill (one-line install)

After installing the MCP, run:

```bash
asc-mcp install-skill
```

This copies a small `asc-review-triage` Skill to `~/.claude/skills/` so Claude automatically picks up review-related questions ("any bad reviews lately?", "what do my users say?", "ratings this week?") and calls the right ASC tools without you having to explain the workflow each time.

Works on macOS, Linux, and Windows. To remove: `asc-mcp uninstall-skill`.

## Real Output Examples

**"Run a preflight check before I submit"**
```
Release Preflight: v2.3

State: PREPARE_FOR_SUBMISSION
Platform: IOS

PASS (with 1 warning)

Warnings (recommended):
- Missing screenshot set for APP_IPHONE_67. May be required.

Passing checks: 4
- [en-US] Description OK (3874/4000 chars).
- [en-US] Keywords OK (96/100 chars).
- 2 screenshot set(s) found across 1 locale(s).
- Build 40 attached and valid.

Total: 4 pass, 1 warn, 0 fail
```

**"Morning briefing"**
```
Daily Briefing - 2026-04-13

2 apps in your account

Tempo: Habit Builder
- Latest: v2.3 (IOS) - Waiting for Review
- Action needed: v2.3 is Waiting for Review
- Reviews (last 3d): 5 new, avg 4.2 stars

NightOwl Weather
- Latest: v1.1 (IOS) - Live
- No new reviews in the last 3 days
```

**"Generate release notes from git"**
```
Git History for Release Notes

Since: v2.2.0
Commits: 8
Character limit: 4000 chars for "What's New"

New Features (3)
- feat: add habit streak calendar view
- feat: dark mode support
- add widget for home screen

Bug Fixes (2)
- fix: notification timing off by 1 hour
- fix: crash on iPad when rotating

Instructions: Write user-facing "What's New" text.
Lead with the most impactful change. Keep under 4000 chars.
```

## Why This One Over the Free Alternatives?

| | Raw API wrappers (free) | This server |
|---|---|---|
| **Tool count** | 80 to 293 | 36 opinionated tools (read + control) |
| **MCP Prompts (slash commands)** | No | Yes, 3 pre-built workflows |
| **MCP Sampling (zero server-side LLM cost)** | No | Yes, review triage + response drafts |
| **Claude Skill bundled** | No | Yes, one-line install |
| **Pre-submission audit** | No | Yes, catches rejections before you submit |
| **Cross-app briefings** | No | Yes, one call, all apps |
| **Git-aware release notes** | No | Yes, reads your project's commit history |
| **Smart review summaries** | No | Yes, theme clustering, action items |
| **Setup** | Build from source (Swift or Node) | `npm install -g` (any OS) |
| **Free tier** | Some | Yes, 3 tools, no account needed |

Raw wrappers give you endpoints. This gives you answers.

## Security

Your credentials never leave your machine:

- The `.p8` private key is read locally. JWT tokens are generated on your computer.
- API calls go directly from your machine to `api.appstoreconnect.apple.com`.
- The license server sees only your license key string. Zero Apple data, zero credentials.
- Fully open source. [Read the code.](https://github.com/pofky/asc-mcp)

## Works With

- [Claude Code](https://claude.ai/code) (Anthropic)
- [Cursor](https://cursor.com)
- [Windsurf](https://codeium.com/windsurf)
- [Cline](https://github.com/cline/cline)
- Any client supporting the [Model Context Protocol](https://modelcontextprotocol.io)

## Requirements

- Node.js 18+
- Apple Developer Program membership
- App Store Connect API key (Admin or App Manager role)

## Legal

- [Privacy Policy](https://asc-mcp-license.remewdy.workers.dev/privacy)
- [Terms of Service](https://asc-mcp-license.remewdy.workers.dev/terms)

This project is not affiliated with, endorsed by, or sponsored by Apple Inc. Apple, App Store, App Store Connect, TestFlight, iOS, and macOS are trademarks of Apple Inc.

## License

MIT
