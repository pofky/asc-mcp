# Operator steps, 6 August 2026

Everything that could be done from a terminal is done and deployed. What is left needs a browser
login, which the automation cannot do. Total time is about fifteen minutes, and step 1 is worth
more than the rest combined.

Do them in this order. Each one names the file to paste from.

---

## 1. Claim the Glama listing (2 minutes, highest value)

We are already indexed at <https://glama.ai/mcp/servers/pofky/asc-mcp> but the page is marked
**Unclaimed**, and Glama's own notice on that page says unclaimed servers get limited
discoverability. `glama.json` is already committed declaring `pofky` as maintainer, which is the
half that proves ownership.

1. Open <https://glama.ai/mcp/servers/pofky/asc-mcp>
2. Click **Claim**
3. Authorize with GitHub as `pofky`

Nothing to paste. It should recognise `glama.json` on the repo.

---

### Result of step 1, measured 6 August

Claiming unlocked analytics. Last 30 days: 1,377 search impressions, 0 search clicks, 845 profile
views. That is an order of magnitude more traffic than GitHub, and it was invisible until the claim.
The 0.0% CTR was against the April "13 curated tools" snippet, now replaced. Baseline recorded;
re-read the Analytics tab on 13 August and 6 September.

This is why the remaining steps matter more than they looked. Each directory is plausibly another
few hundred impressions a month, for minutes of work.

---

## 2. Resubmit to mcpservers.org, DONE 6 August

Submitted twice, and the second one is the one that should win.

The first submission used Server Name "App Store Connect", the bare Apple mark as the product name.
That is the one trademark posture worth avoiding, so it was resubmitted minutes later as `asc-mcp`
with the mark used descriptively in the sentence instead: "An MCP server for App Store Connect:
41 tools to ship a release from your agent, covering metadata, screenshots, builds, TestFlight,
in-app purchases, submit and release." Link `https://github.com/pofky/asc-mcp`, Category
Development, Contact povkonop@gmail.com. Premium Submit ($39) left unchecked both times.

Both are in the same review queue. **If both get approved, ask them to remove the "App Store
Connect" one.** Reviewed within 12 hours with an email on approval; if nothing arrives by
8 August, resubmit.

Original instructions kept below in case a resubmission is needed.

### If you need to do it again

This one form feeds two surfaces: mcpservers.org itself, and `wong2/awesome-mcp-servers` on GitHub
(4.2k stars), which is generated from it and explicitly refuses pull requests.

We are already listed, but under `mcpservers.org/servers/pofky/appstore-connect-mcp`, a slug from
the package name we retired, describing the old read-only server. There is no edit route, so the
fix is to submit again.

1. Open <https://mcpservers.org/submit>
2. Paste each field from **`launch/mcpservers-org-submit.txt`**. The file is laid out in the form's
   own field order: Server Name, Short Description (135 characters, fits the single-line input),
   Link, Category, Contact Email.
3. Ignore the $39 "Premium Submit" option. It buys faster review, not better placement.

---

## 3. mcp.so, BLOCKED on a $39 decision

Checked in the browser on 6 August. We are **not listed**, and searching "App Store Connect" there
returns only 4 results, so the category is unusually thin: MCPXcode, a mirror repo,
`zelentsov-dev` (advertising "208 tools across 25 workers"), and `alperduzgun`. A curated 41-tool
server would stand out rather than be buried.

The problem is that **mcp.so no longer has a free submission route.** The submit page now offers one
path, "Paid submission $39, one-time publishing fee", covering publish without review, featured
placement, a verified badge and a dofollow link. The "submit a ticket" link next to it is support,
not a free listing. Nothing was submitted, because spending money is your call.

**Decided 6 August: skip it for now.** No paid placement until a free surface has proven that
directory traffic converts, not just that it exists. Glama gives 845 profile views a month and, so
far, zero attributable signups, because nothing measures that hop yet. Paying $39 into a directory
whose traffic we cannot measure at all, before we know the measurable one converts, is buying a
second unknown.

**Revisit when either is true:** the 13 August or 6 September Glama re-read shows a CTR above zero
against the new snippet, or a paying customer arrives whose `/go?tool=` attribution traces back to a
directory. At that point $39 once against $9/month is an easy yes.

To do it: <https://mcp.so/submit?type=server>, Repository URL `https://github.com/pofky/asc-mcp`,
Name `App Store Connect`, then pay.

---

## 4. Create a Smithery account (5 minutes, then it is scriptable forever)

Not listed at all. `smithery.yaml` is already committed with the stdio start command and the config
schema for the three required environment variables, so the repo side is done.

1. Sign up at <https://smithery.ai> with GitHub
2. Tell me once you are in, and the publish itself (`smithery mcp build`, then
   `smithery mcp publish`) runs from the terminal

---

## 5. Optional, and only if you want the traffic now: post the field notes

The page is live at <https://asc-mcp.pages.dev/writing/license-server/>.

Three files, one per Hacker News form field:

- **`launch/show-hn-license-server-title.txt`** into Title (70 characters, HN's limit is 80)
- **`launch/show-hn-license-server-url.txt`** into URL
- **`launch/show-hn-license-server-text.txt`** into Text

Post Tuesday to Thursday, 8am to 10am Eastern, and stay available to reply for the first two hours.
A Show HN with no author replying dies regardless of the content.

Worth knowing before you post: this page is also the demand probe for the "licensing as a package
for other MCP sellers" idea. Its call to action asks anyone who wants that to open an issue. If the
thread produces no such request, that is the answer, and it cost a day rather than two weeks.

---

## Not for you, for the next session

- **PulseMCP needs nothing.** It pipes `server.json` from the official MCP registry, so the stale
  April description corrects itself at the next release publish. The email in
  `launch/pulsemcp-listing-update.txt` is a fallback only if it has not resynced a week after the
  next release.
- **`--dim` fails WCAG AA** at 4.26:1 on the ink background. Fixed on the new page, still wrong on
  the homepage footer and eyebrow text.
- **Cloudflare Pages returns 200 with the homepage for unknown URLs.** Every mistyped path is a soft
  404 that search engines can index as duplicate content. Needs a real 404 page.
- **The site does not deploy on `git push`.** It needs
  `npx wrangler pages deploy site --project-name=asc-mcp --branch=master`. Deploying to `main`
  silently lands as a preview.
