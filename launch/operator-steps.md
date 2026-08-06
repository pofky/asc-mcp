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

## 4. Smithery, which turned out to be the wrong question

Smithery no longer lists a local server from a repo plus a `smithery.yaml`. It now takes exactly two
things: a **hosted HTTPS server** behind its gateway, which is impossible here because the whole
security story is that the `.p8` never leaves the user's machine, or a **prebuilt `.mcpb` bundle**
that clients download and run locally. The `smithery.yaml` written earlier on 6 August was based on
stale documentation and has been deleted.

So the account was never the blocker. The bundle was, and it now exists.

`npm run mcpb` produces `build/asc-mcp-<version>.mcpb`, 3.3 MB, from `scripts/build-mcpb.mjs`. The
manifest is generated from `package.json` so the version cannot drift, and production dependencies
are resolved by npm rather than copied from the dev tree, so a dev dependency cannot ride along into
a file users download.

**The bundle matters more than the Smithery listing.** Claude for macOS and Windows installs an
`.mcpb` in one click, and its manifest collects config natively: a file picker for the `.p8` and one
text field for the Issuer ID. That replaces the current onboarding, which is "find your client's
JSON config, paste a server block, know where your .p8 lives, restart", where every step is a place
to give up and all of them happen before the product has done anything for you.

Two code changes were needed to make it actually work, both verified by running the extracted bundle:

- The Key ID is now derived from the `.p8` filename when the file is outside Apple's standard
  directory. A file picker almost never returns a path in that directory, so before this every
  bundle install would have failed with "missing credentials" while holding a file whose name
  contains the missing value.
- A license key that arrives as the unsubstituted literal `${user_config.asc_license_key}`, which is
  what an optional field left blank can produce, is treated as no key instead of being posted to the
  license server on every start.

Remaining, and it needs your call: the bundle has to be attached to a GitHub release to be
installable, which means cutting v1.9.1 (npm publish plus the registry). See the release note at the
bottom of this file.

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

---

## Pending decision: cut v1.9.1 to ship the bundle

The `.mcpb` is built and verified locally, but it is not distributable until it is attached to a
GitHub release. That means a version bump, an npm publish and a registry publish, all of which touch
a package with paying customers, so it is not something to do without asking.

What would go into 1.9.1:

- Key ID derived from the `.p8` filename for keys outside the standard directory (fixes every MCPB
  install, and also helps anyone who keeps their key somewhere else today).
- Unsubstituted config placeholders no longer sent to the license server.
- `.mcpb` bundle attached as a release asset, plus a one-click install line in the README.
- The registry description finally goes out, which is what fixes the stale PulseMCP listing.

186 tests pass. The npm-lag lesson applies: publish in the same session as the version bump.
