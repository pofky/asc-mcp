# DISTRIBUTION.md

Product: asc-mcp (App Store Connect MCP)
Last updated: 2026-08-31
Stage: launched

Standard: `/Volumes/T7/Projects/autopilot/docs/distribution-virality-playbook.md`.
Registry and listicle status lives in `launch/distribution-checklist.md`; this file
is the plan, that file is the checklist.

---

## 1. Idea filter

- **One problem, one solution:** an indie iOS developer cannot finish an App Store
  release from the agent they already work in, so every release drops them into the
  App Store Connect website.
- **Named audience:** solo and two-person iOS/macOS developers who already run
  Claude Code, Cursor or Claude Desktop daily and ship their own apps.
- **Already paying for a worse version:** fastlane (free, but Ruby toolchain,
  YAML lanes and no agent), the ASC website (free, but manual), and the read-only
  ASC MCP wrappers (free, and they stop at the paywall of actually writing).
- **AI-unlocked:** the agent holds the release context (the diff, the commits, the
  reviews) and can now act on App Store Connect in the same conversation. Before
  the model there was nothing to hand a 41-tool control plane to.
- **We use it:** this project drove a real 1.0 submission end to end in June 2026,
  and every asc-mcp release since is checked with its own preflight tools.

## 2. Gotcha feature

- **The 15-second clip:** one prompt in Claude Code, "ship 1.2 to review", and the
  terminal streams: metadata written, screenshots uploaded, build attached,
  preflight audit green, submitted. No browser tab is ever opened.
- **The feature that makes the clip possible:** `release_preflight` plus
  `submit_for_review`, the two ends of the control plane.
- **The 5-second pitch:** Submit an App Store release from your agent.

## 3. Retention feature

- **Daily-reason feature:** `daily_briefing` and `triage_reviews`. Releases are
  monthly; reviews and review status are daily.
- **Why this audience opens it daily:** a live app generates reviews, ratings and
  review-state changes every day, and reading them in the agent beats the portal.
- **What churn tells us:** if people cancel after one release, the briefing is not
  worth opening between releases, and that is the thing to change, not the ads.

## 4. Channel

- **Where this audience already is:** MCP directories and listicles (the inclusion
  gate for AI answer engines), r/iOSProgramming and r/ClaudeAI, Hacker News Show HN,
  X threads from indie iOS developers, and the Claude Code / Cursor community
  channels.
- **Feed trained on the ICP:** not yet. This is the gap, and it is why the numbers
  in section 8 look the way they do.
- **The 10 creators we track:** to fill. Search that finds them: "indie iOS
  developer" plus "Claude Code" on X, and the top posters in r/iOSProgramming
  release threads.
- **What their outlier posts have in common:** to fill, monthly.

## 5. Source material

- **Corpus of real customer language:** `launch/reddit-ios.md`, `launch/show-hn.md`,
  the App Store review text this server itself reads, and the two support threads
  in `launch/reply-michael-appinfo.md`.
- **Where it comes from:** the subreddits above, the one customer email thread, and
  the limitations the tools themselves report (`LIMITATIONS.md` is written from what
  Apple's API actually refuses).
- **Refreshed:** at each release.

## 6. Creative plan

- **Save-earning format:** the "what Apple's API cannot do" list. It is the single
  piece of writing here that another developer bookmarks, because nobody else keeps
  it current.
- **Viral variants:** the 15-second submit clip, the preflight-catches-a-rejection
  clip, the "your agent reads your 1-star reviews" clip.
- **Converting variants:** the setup clip. Install to first authenticated call in
  under three minutes, uncut.
- **Winners to remix:** none yet, nothing has been posted at volume.
- **Ad-library study:** no paid acquisition at $9/month with this volume. Revisit
  only if organic conversion is proven.

## 7. Onboarding and paywall

- **Educate:** `asc_setup_check` is the first screen, and it is a real
  authenticated call, not a checklist.
- **Social proof:** none yet, deliberately omitted. Five subscriptions is not a
  logo wall, and inventing one breaks Rule 1.
- **Personalize:** the tools read the user's own apps, so the first useful answer is
  about their app, not a demo app.
- **Simulate the result:** `release_preflight` shows exactly what a submission would
  flag, before any Pro tool is needed, and it is itself behind the trial.
- **Paywall placement:** the moment the agent is asked to write something real, via
  `requirePro` in `src/gate.ts`, which leads with the trial and not the price.
- **Price and trial:** $9/month, 7-day trial with no card, started in-agent with
  `asc_start_trial`. The shape exists because sending someone to a browser for a
  card, at the moment their agent is mid-task, is where the sale dies.

## 8. Numbers

Measured 2026-08-31. Sources: npm registry API, GitHub traffic API, Polar API for
the `asc-mcp` organization, and the licence D1 (`intent_events`, `licenses`).

| Metric | Target | Actual (2026-08-31) | Read when |
|--------|--------|---------------------|-----------|
| Real installs (npm `latest` only) | 300/week | 66/week | weekly |
| Repo unique visitors | 200/14d | 10/14d | fortnightly |
| Trials started | 20/month | 4 ever, 0 since 16 Aug | weekly |
| Trial to paid | 25% | 0 of 4 | monthly |
| Paying subscribers | 25 | 5 active (1 in the new org) | monthly |
| MRR | $225 | $45 | monthly |

The read: the money path works and nobody is walking it. Downloads are mostly
registry mirrors spread across old versions; only `latest` is a human signal.

## 9. Launch-window revenue play

- **Cohorts:** the four trial emails (one converted to nothing), the five paying
  subscribers, and anyone who reaches `/go`.
- **Sending stack:** Polar for billing mail, Brevo for licence and announce mail
  (`/admin/announce` already exists and is token-guarded).
- **Review queue:** every outbound message is written to a `.txt` under `launch/`
  and read before it is sent.
- **Urgency:** none manufactured. There is no real deadline, so there is no
  urgency line.

## 10. Boundaries confirmed

- [x] No bought followers or engagement
- [x] No scraped-contact cold email or DM outbound
- [x] No fabricated reviews, testimonials or social proof
- [x] No impersonation, no unevidenced "as seen in"
- [x] Every channel used is within its own terms of service

---

## Next actions, ordered

Terminal, this session or the next:

1. Publish the registry description PulseMCP mirrors, so the listing stops selling
   the April read-only tool (`launch/pulsemcp-listing-update.txt` is the fallback).
2. Post the Show HN that is already written (`launch/show-hn*.txt`).
3. Post the r/iOSProgramming and X drafts (`launch/reddit-ios.md`,
   `launch/twitter-thread.md`).

Operator, browser, minutes each:

4. Claim the Glama listing, <https://glama.ai/mcp/servers/pofky/asc-mcp>.
5. Submit to <https://mcp.so/submit?type=server>.
6. Turn on Cloudflare Web Analytics for `asc-mcp.pages.dev` and paste the beacon
   token here. The stored API token has no RUM scope, so this cannot be done from a
   terminal, and without it the site has no traffic number at all.

Smithery is deliberately not on this list: it no longer lists a local stdio
server from a repo, and a hosted variant is impossible when the whole point is
that the `.p8` never leaves the user's machine. See
`launch/distribution-checklist.md`.
