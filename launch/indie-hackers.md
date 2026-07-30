# Indie Hackers post, v1.8.1

Community launches on IH convert better than Product Hunt for bootstrapped dev tools, so
this is the higher-priority post of the two. Lead with the revenue reality, not the feature
list. Fill in the real MRR number before posting.

**Title:** I charge $9/mo for the half of my API wrapper that took months to get right

---

I build iOS apps, and the boring part is App Store Connect. Not the coding, the clicking:
metadata across locales, screenshots per device size, age ratings, territory pricing,
review contact, submit, release.

So I built an MCP server that lets my coding agent do it. It is on npm as `@pofky/asc-mcp`,
40 tools, and it has actually shipped a real app's 1.0 end to end.

**The pricing decision.** There are several free App Store Connect MCP servers. They wrap
Apple's endpoints one to one, sometimes hundreds of tools. I could not out-free them and I
did not want to. So the split is:

- Free, no account: 5 tools. Setup diagnosis, the playbook, list apps, app details, review
  status. Enough to confirm it works and to read exactly what the flow will be.
- Pro, $9/mo: the other 35. The write and control plane, the preflight audit, reviews and
  sales.

The reasoning: reading data is commoditised. Driving a submission safely is not. Every one
of those write tools exists in the shape it does because a live failure taught me something.
Setting an age rating is one call that merges the full declaration set, because a partial
PATCH silently loses declarations. Submitting aborts if the app's first in-app purchases are
pending, because Apple takes the version anyway and orphans it. Subscriptions get a no-op
PATCH nudge at the end because state is only recomputed at the subscription level.

None of that is visible in a feature list. All of it is why the paid half is worth $9.

**What I got wrong.** For three months npm's `latest` tag pointed at a version five minors
behind the repo. Paying customers were installing 13 tools while the repo had 40, and I only
found it when a new customer's install did not match my own docs. If you ship a CLI or a
library, verify from a clean install after every release, not from your dev machine.

**What worked.** Writing the limitations down as a first-class product surface. There is a
free tool, `asc_guide`, that prints the end-to-end playbook for a flow with every
website-only step flagged inline, and the docs in the repo are generated from it so they
cannot drift. It turns out "here is exactly what this cannot do" is the thing people trust.

Free tier, no signup: `npx @pofky/asc-mcp init`
https://asc-mcp.pages.dev

Happy to answer anything about the pricing split or the Polar setup.
