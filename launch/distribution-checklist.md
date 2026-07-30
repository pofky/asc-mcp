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

## Next, one-time, no account friction

- [ ] `punkpeye/awesome-mcp-servers` pull request. Largest MCP listicle, and listicles are
      the most cited format in AI answers. Add under the Apple or developer-tools section
      with one factual line.
- [ ] `wong2/awesome-mcp-servers` and `appcypher/awesome-mcp-servers` pull requests.
- [ ] PulseMCP, Glama and MCP.so profiles. Several index the official registry
      automatically, so check whether the 1.8.1 entry appeared before submitting by hand.
- [ ] Smithery listing.
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
