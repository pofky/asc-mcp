# PRD 0006: be found by people and by LLMs looking for this tool

Status: implemented, 2026-11-12. Type B (copy, metadata, two static pages). Flows: F9 added, F8 entry amended.

## 1. Problem

Audit of 12 Nov 2026: web search for "MCP server for App Store Connect" returned no asc-mcp result in the top 16. The npm, registry and GitHub descriptions led with a metaphor, not the searched words; GitHub's homepage pointed at a dead GitHub Pages URL; llms.txt and the site said v1.10.3; PulseMCP's top result for "app store connect" (about 609 visitors a week) is our deprecated April entry; the Claude plugin directory refuses local servers from unverified organizations.

## 2. Scope

- GitHub: homepage, description, topics (fastlane, testflight, app-store, ios-development, release-automation, app-store-submission, asc-mcp). Done live.
- package.json description and keywords, server.json description (93 chars), README first screen (install first, one fastlane sentence, fastlane claim sourced to fastlane's docs).
- Site: two answer-first pages (`/writing/fastlane-alternative-for-ai-agents/`, `/writing/can-ai-submit-app-to-app-store/`) with Article and FAQPage JSON-LD matching visible text; homepage link to the fastlane page, version v1.11.1, "Four things" FAQ corrected; llms.txt and sitemap.
- PulseMCP email draft refreshed (owner sends). Plugin directory: recorded, owner decision.

Out of scope: naming or characterizing competitors beyond the existing dated table; paid listings.

## 3. Acceptance

- Pages: HTML and JSON-LD parse, ASCII only, Lighthouse mobile 100/100/100, links land, no horizontal scroll at 320 (change-tester PASS).
- Claims: every website-only step matches the homepage FAQ and the API limits page; fastlane statements match docs.fastlane.tools/app-store-connect-api (change-reviewer).
- npm and the registry carry the new description after the next publish.

## 4. Risks

- Comparative claims about fastlane: limited to what its docs state, linked.
