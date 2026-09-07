<!-- AUTOPILOT:BEGIN -->
# Autopilot — Project Rules

This project has autopilot active (`.autopilot/` present).
Full docs: `/Volumes/T7/Projects/autopilot/docs/` — read on demand.

## Hard rules (always active)

1. **Project-local logging** — write to THIS project's `WORKLOG.md`,
   `tasks/`, `.autopilot/reports/`, `.autopilot/queues/`. NEVER write
   to another project's worklog. Hook enforced.

2. **Storage** — all work on `/Volumes/T7/Projects/`. Redirect build
   caches to T7. Storage guardian daemon runs automatically.
   Details: `autopilot/docs/storage-management.md`

3. **Workflow** — Classify → PRD → Architect Review → Implement →
   Independent Test → Commit. Architect reviews BEFORE code.
   Tester is separate from implementer. Both technical + business
   logic checked. Details: `autopilot/docs/prd-standard.md`

4. **Self-verification** — never ask the user to test. Use MCP tools
   (xcodebuildmcp, idb, Playwright). Escalation ladder:
   `autopilot/docs/self-verification.md`

5. **UI quality** — design system + anti-AI-slop + senior clarity.
   Details: `autopilot/docs/design-system-standard.md`,
   `autopilot/docs/anti-ai-slop.md`

6. **Flow testing** — two testers (mechanic + senior), real simulator.
   Details: `autopilot/docs/flow-testing-standard.md`

7. **Legal compliance** — check before shipping anything touching
   privacy, payments, app store rules, health/legal/financial data.
   Details: `autopilot/docs/legal-compliance-framework.md`,
   `autopilot/docs/mission.md` (forbidden domains list)

8. **Security** — never ship known Tier 1 vulnerabilities. Scan on
   sensitive file changes. Details: `autopilot/docs/security-scanning.md`

9. **Commit hygiene** — rollback-safe splits, push main after gates
   pass. Details: `autopilot/docs/commit-hygiene.md`

## On-demand references (read when the topic comes up)

- PRD templates + amendment format: `autopilot/docs/prd-standard.md`
- Decision ladder (try before asking): `autopilot/docs/decision-ladder.md`
- Completeness checklist: `autopilot/docs/completeness-checklist.md`
- Lessons learned (bug patterns): `autopilot/docs/lessons-learned.md`
- Autonomous safety: `autopilot/docs/autonomous-safety.md`
- Self-improvement: `autopilot/docs/self-improvement.md`
- Mission + revenue goal: `autopilot/docs/mission.md`
- Notifications: `autopilot/docs/notifications.md`
- Telegram bridge: `autopilot/docs/telegram-bridge.md`
- Cron scheduling: `autopilot/docs/cron-scheduling.md`
- Status dashboard: `autopilot/docs/status-dashboard.md`
- Worklog format: `autopilot/docs/worklog-format.md`
- GeoWrecked cross-project: `autopilot/docs/geowrecked-cross-project.md`

## Skills (invoke before writing code)

Match skill to work: `android-development`, `compose-ui`, `react-best-practices`,
`frontend-design`, `systematic-debugging`, `brainstorming`, `cloudflare`, etc.

## Drive-by bugs

Found a bug unrelated to current task? Add to `.autopilot/queues/bug-queue.md`.
Bugs are auto-drained after primary task completes.

## Stuck tools

If an MCP tool or simulator hangs >60s, the watchdog kills it. If it
persists, `pkill -9 -f idb_companion` or restart the simulator.
See `lessons-learned.md` L-007, L-010.
<!-- AUTOPILOT:END -->
