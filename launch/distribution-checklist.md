# Distribution checklist, asc-mcp

Ordered by (impact x feasibility) for a paid developer tool, per
`engine-agentic/docs/distribution-virality-playbook.md`. Directory and registry presence is
the inclusion gate for AI answer engines: near every tool cited by ChatGPT has profiles on
several of these. Listicles ("best MCP servers for X") are the single most cited format.

## Done, 30 July 2026

- [x] npm `latest` = 1.8.1, matching the repo. `homepage`, `repository` and `bugs` set so
      the package page links to the site and issues.
- [x] Official MCP registry: `io.github.pofky/asc-mcp` v1.8.1 published and active.
      Superseded entry `io.github.pofky/appstore-connect-mcp` 0.2.1 marked deprecated.
      Publishing runs from `.github/workflows/publish-mcp-registry.yml` on every `v*` tag.
- [x] Stale npm package `@pofky/appstore-connect-mcp` deprecated with a pointer.
- [x] Landing page live at https://asc-mcp.pages.dev with canonical, Organization +
      WebSite + SoftwareApplication + FAQPage JSON-LD, robots.txt with an AI-crawler
      allowlist, sitemap.xml, llms.txt. GitHub Pages duplicate retired.

## Listicles, resolved 6 August 2026

The three awesome-lists turned out to be three different mechanisms, only one of which is a
pull request. Recording that here so nobody spends the afternoon again.

- [x] `punkpeye/awesome-mcp-servers` PR
      [#11198](https://github.com/punkpeye/awesome-mcp-servers/pull/11198) open since 30 July,
      entry refreshed on 6 August from "40 job-shaped tools ... Free tier, no account" to 41
      tools and "six tools are free with no account". Largest list at 91.6k stars.
- [x] `wong2/awesome-mcp-servers` **does not accept pull requests.** The README says so at the
      top: submissions go through <https://mcpservers.org/submit>, which is wong2's own
      directory and the source the list is generated from. Paste-ready text:
      `launch/mcpservers-org-submit.txt`. Needs a browser, so it is on the operator.
      A branch with the README edit exists on the fork in case they ever reopen PRs.
- [x] `appcypher/awesome-mcp-servers` **is archived** (5.7k stars, read-only, no PRs possible).
      It still ranks and still gets cited, but it can no longer be changed by anyone. Dead end,
      do not retry.

## Directories, state as of 6 August 2026

- [ ] **PulseMCP: listed, and mirroring the DEPRECATED registry entry.** Re-checked 31 August in a
      real browser (the site 403s anything that is not one). The page
      <https://www.pulsemcp.com/servers/pofky-app-store-connect> shows the name
      `io.github.pofky/appstore-connect-mcp`, the April 2026 read-only description, and a Learn More
      button pointing at the pre-rename repo URL. **The earlier diagnosis here was wrong**: this is
      not a sync that has not run yet, it is a sync from an entry that is deprecated and will never
      get another version, so waiting cannot fix it. They have to repoint the listing at
      `io.github.pofky/asc-mcp`. Email rewritten and ready:
      `launch/pulsemcp-listing-update.txt`, to hello@pulsemcp.com.

- [x] **Glama: listed at <https://glama.ai/mcp/servers/pofky/asc-mcp>, marked Unclaimed**, which
      Glama's own notice says means "limited discoverability". `glama.json` added to the repo
      root on 6 August, declaring `pofky` as maintainer, which is the half that can be done from
      a terminal.
- [ ] Claim the Glama listing at <https://glama.ai/mcp/servers/pofky/asc-mcp> (button on the
      page, GitHub ownership verification). Operator, browser, two minutes.
- [ ] **MCP.so: presence unconfirmed**, the site returns 403 to everything that is not a browser.
      Submit at <https://mcp.so/submit?type=server> if absent. Fields: name, one-sentence
      description, tool count, transport (stdio), repo URL, homepage, icon.
- [x] **Smithery: not listed, and closed as a dead end (6 August).** A `smithery.yaml` was written
      that morning and deleted the same day in `9fee03b`: Smithery no longer lists a local server
      from a repo plus a yaml. It takes either a hosted HTTPS server, which is impossible when the
      whole point is that the `.p8` never leaves the user's machine, or a prebuilt `.mcpb`. The
      bundle exists instead. **Corrected 31 August**: this entry still claimed the yaml was in the
      repo root, which it has not been since 6 August, and the next line still listed
      `smithery mcp build && smithery mcp publish` as work to do. Do not re-add the yaml.
- [x] **Re-submit to <https://mcpservers.org/submit>. Approved 7 August 2026**, live at
      <https://mcpservers.org/servers/pofky/asc-mcp> with accurate copy: 41 tools, the one-click
      bundle, the in-agent trial and the $9 price.
- [x] **Asked mcpservers.org to remove the duplicate. Email sent 7 August 2026.** The pre-rename listing is still up at
      `mcpservers.org/servers/pofky/appstore-connect-mcp`, pointing at the same repo under the old
      "App Store Connect MCP Server" name and describing a read-only tool from several releases ago.
      Two entries for one repo split the listing between an accurate page and a stale one, and the
      stale one carries exactly the name the rename existed to retire. Email is written and
      Text sent: `launch/mcpservers-org-remove-duplicate.txt`, to contact@mcpservers.org. It offered a
      redirect as an alternative to deletion. **Resolved: checked 31 August, the old slug returns
      404 and the current one returns 200.** They removed the duplicate; no follow-up needed. A stale duplicate is worth one email and one nudge,
      not a campaign.
- [ ] Not in the `wong2/awesome-mcp-servers` README itself (checked 7 August, no match for pofky).
      The site listing and the repo README are separate surfaces; the email above offers a redirect,
      and the README is the repo's own PR flow, which had PRs disabled when last tried.
- [ ] Declined for now: the sponsorship offer in the approval email buys placement on the site and
      the 4k-star repo. Paid, so it waits until directory traffic is proven to convert.
- [x] Official MCP registry is healthy: `io.github.pofky/asc-mcp` 1.9.0 is `isLatest: true`,
      published 6 August 2026, with every version back to 1.8.1 active. The official
      `modelcontextprotocol/servers` repo no longer maintains a server list and now points
      everyone at this registry, which makes the registry entry the highest-leverage string
      we own.
- [ ] **Registry description is doing no work.** It currently reads "Drive App Store Connect end
      to end: metadata, screenshots, builds, TestFlight, submit, release." Directories mirror
      this string verbatim. The nearest competitor on the registry, `io.github.erayendes/asc-mcp`,
      advertises "982 tools from Apple's OpenAPI spec", so curation is the differentiator and
      the description should say a number and say the trial. Change `server.json` at the next
      release rather than bumping a version for it alone.

## Competitive reality, measured not guessed

Glama alone indexes twenty App Store Connect MCP servers. Zero stars is therefore not the
problem to solve; being absent from the surfaces that rank is. Two of them share our short
name `asc-mcp`, including the registry entry above, so the package name `@pofky/asc-mcp` and
the site are the only unambiguous identifiers. Use both everywhere.
## Next, one-time, no account friction

- [ ] Crunchbase or an equivalent entity record, plus a Wikidata item. Wikidata has no
      notability bar for software and feeds knowledge graphs; being on four or more
      platforms materially raises the odds of being named in ChatGPT answers.
- [ ] Product Hunt. Treat as a credibility signal and a backlink, not a growth channel.
      Tuesday to Thursday, 12:01am PT, video demo, reply to every comment.

## Content that answers the question people actually type

Each of these is a page or post whose heading is the literal query, opening with a 40 to 60
word direct answer. That structure is what gets extracted and cited.

- [ ] "Can an AI agent submit an app to the App Store?" (the honest yes-with-four-exceptions)
- [ ] "What can the App Store Connect API not do?" (already on the landing page, expand it
      into its own page with the error strings, which is what people search)
- [ ] "How do I automate App Store screenshots and metadata?"
- [ ] One YouTube walkthrough of a real submission. YouTube has the strongest single-domain
      correlation with AI Overview citations, and one video is enough to be in the set.

## Ongoing

- [ ] r/iOSProgramming: contribute genuinely for several weeks before the limitations post
      in `reddit-ios.md`. Reddit is roughly 40% of LLM citations and about 47% of
      Perplexity's commercial-query citations, but a bad first impression there is permanent.
- [ ] Show HN when a second real proof point exists (see `show-hn.md`).
- [ ] Indie Hackers post (see `indie-hackers.md`), higher expected conversion than Product
      Hunt for a bootstrapped dev tool.
- [ ] Refresh the landing page "Last updated" date and version at every release. Perplexity
      cites recent content far more heavily.
- [ ] Monthly: ask ChatGPT, Claude, Perplexity and Google AI Overviews the priority
      questions above and log who gets cited. Track citation share, not rankings.
