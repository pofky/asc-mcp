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

## 2. Resubmit to mcpservers.org (3 minutes)

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

## 3. Check and submit mcp.so (3 minutes)

Presence could not be confirmed from the terminal because the site returns 403 to everything that
is not a real browser.

1. Open <https://mcp.so> and search "App Store Connect"
2. If `pofky/asc-mcp` is absent, go to <https://mcp.so/submit?type=server>
3. Fields it asks for: name, one-sentence description, tool count (41), transport (stdio), repo URL,
   homepage URL, optional icon. Reuse the text from **`launch/mcpservers-org-submit.txt`**.

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
