# PRD 0003: plain-words explainer on every public surface

Type B (copy and one page section). Operator request, 31 Oct 2026: the "explained like a first grader" answer is good marketing, put it on the landing page and wherever the product is distributed.

## Problem
The landing page opens with "41 tools" and "MCP server". A visitor who does not already know those words cannot tell what the product is for.

## Change
- Landing: new section `#plain` straight after the hero CTA; the two terminal demos move out of the header into `#demo`.
- Same message in README, llms.txt, JSON-LD FAQ, npm, registry, plugin and `.mcpb` descriptions.
- Paste-ready listing copy: `launch/plain-explainer-long.txt`, `launch/plain-explainer-short.txt`, `launch/glama-description.txt`.

## Claims, checked against the code
- Free with no limit: whether Apple said yes or no (`review_status`). Reviews are Pro, with the 5-call preview in `src/gate.ts`.
- "Stops and asks" holds for submit, release, creating products, TestFlight add, version creation and changing an existing price. It does not hold for metadata, screenshots or a first price, so the copy says "changing a price".
- No promise of approval: "the store still decides".

## Test
No overflow at 320, 375, 1100. Independent legal, SEO+CRO+AEO, slop and completeness review. Live page and published package checked after release.

Flows: FLOWS.md F7.
