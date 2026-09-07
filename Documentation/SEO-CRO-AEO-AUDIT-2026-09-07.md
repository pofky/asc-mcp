# SEO + CRO + AEO Audit, 2026-09-07

Auditor: seo-cro-aeo-auditor. Standard: `/Volumes/T7/Projects/engine-agentic/docs/seo-cro-aeo-standard.md`.

## Surfaces audited (all live, fetched 2026-09-07)

- `site/index.html` -> https://asc-mcp.pages.dev/ (200, single landing page incl. pricing, FAQ, JSON-LD)
- `site/llms.txt` -> https://asc-mcp.pages.dev/llms.txt (200, `text/plain`)
- `site/robots.txt` -> https://asc-mcp.pages.dev/robots.txt (200)
- `site/sitemap.xml` -> https://asc-mcp.pages.dev/sitemap.xml (200)
- `site/writing/license-server/index.html` -> https://asc-mcp.pages.dev/writing/license-server/ (200, long-form post)
- `README.md` -> what npm and Glama render for the package page (markdown, no `<head>`; most HTML-only criteria are n/a here and marked as such in the matrix, not skipped)

Lab data pulled live with Lighthouse 12.8.2 (headless Chrome) against both HTML pages. External links (GitHub, npm, Polar checkout, license-worker `/privacy`, `/terms`, `/key`, `/go`) were curled for status codes. JSON-LD blocks were parsed with `json.loads`. No site file was edited; every fix below is a recommendation.

## Commercial context that shapes the ranking below

Six trials ever started, zero converted, none since 2 September. The one paying subscription churned today on a declined renewal card. The site carries no analytics, so on-site traffic and drop-off are unmeasured. The Glama directory listing gets a measured 1,377 search impressions and 845 profile views in 30 days, an order of magnitude over GitHub, but serves a stale April description with an empty tool list because Glama's own builder keeps failing (`WORKLOG.md:263-392`); that is an external listing, not a file this audit can fix, but it is the single highest-leverage item in the whole funnel and is called out first for that reason. Competitors are free and larger by raw tool count (Heimdall/erayendes 890 tools, zelentsov-dev 208, alperduzgun, plus fastlane and the ASC website itself).

## Summary per page

- **index.html**: SEO is clean (single h1, canonical, OG/Twitter complete, valid JSON-LD, AI-crawler allowlist, sitemap, llms.txt all present and 200). Lighthouse: performance 1.00, accessibility 1.00, best-practices 1.00, SEO 0.92 (the one ding is a Lighthouse tooling false-positive on `robots-txt`, confirmed 200 by curl). CRO gap: the only proof visitors see is the setup-check terminal, never the trial-start terminal, and the trial itself has no copy-paste command the way `npx @pofky/asc-mcp init` does. AEO gap: no named, on-page comparison against the free and larger competitors an answer engine would be resolving "best App Store Connect MCP" against; that comparison exists in README but not on the URL that is actually indexed and cited as the canonical.
- **llms.txt**: Full llmstxt.org shape (H1, blockquote summary, facts, key pages, Q&A, citation string). Only real defect: it asserts a SHA-256-hash-of-Issuer-ID trial-identification detail (line 56) that is not stated anywhere on index.html or in the FAQPage schema, so an LLM citing llms.txt and an LLM citing the page schema will say different things about what data the trial sends.
- **writing/license-server/**: Best AEO surface on the site (BreadcrumbList, BlogPosting with real dates, FAQPage, four citable comparison-style facts per case study, honest cost lines). CRO/trust defect: the footer and nav both hardcode `v1.9.5`, four minor versions stale against the site's own `v1.9.10`, which reads exactly like a page nobody maintains anymore.
- **README.md**: Content is consistent with the site (pricing, tool count, trial mechanics all match). No HTML-level SEO controls exist here by definition (npm/Glama own the `<head>`), so those criteria are marked `n/a`. The comparison table that is missing from index.html lives here (lines 268-284) and is the single best asset to promote onto the live page.

## CRITICAL (blocks launch)

None. The site is already live, passes Core Web Vitals, has valid schema, and has no broken internal links among the ones tested. Nothing here should block continuing to ship; the items below are ordered by expected effect on trials started, not by launch-blocking severity, per the brief.

## HIGH (before launch), ordered by expected effect on trials started

1. **Glama listing is stale and traffic there is 10x GitHub's** (external, not a repo file: `glama.json`, `launch/glama-description.txt`, Glama's own build). `WORKLOG.md:380-392` records 1,377 impressions, 845 views, 0 clicks in 30 days and attributes the 0 clicks to the stale April snippet and empty tool list, not to lack of demand. This dwarfs every on-page fix below in raw reach: fixing this is worth more expected trials than everything else in this report combined, but it is not an artifact this audit can hand you a `file:line` fix for. Re-trigger the Glama build and verify the listing matches `glama.json` before doing anything else.

2. **The page never shows what starting a trial looks like.** `site/index.html:224-241` is a terminal block for `asc_setup_check`, ending in a WARN that tells the visitor to run `asc_start_trial` but never shows that tool's output. A visitor who has never used an MCP tool call has now seen exactly one example of "ask your agent to run X" succeeding, and it was a read-only diagnostic, not the thing that unlocks the product. Six trials in the product's life is consistent with people stalling at not knowing what actually happens when they type it. Fix: add a second terminal panel in the pricing section (`site/index.html:369-408`) showing the literal prompt ("start my asc-mcp trial, my email is you@example.com") and a realistic `asc_start_trial` response (license key issued, tools unlocked, no restart needed), mirroring the install command's copy button pattern at `site/index.html:216-219`.

3. **The trial-start command has no copy-paste affordance; the install command does.** `site/index.html:216-219` gives `npx @pofky/asc-mcp init` a code box with a Copy button. The trial instruction at `site/index.html:221-222` and again at `site/index.html:373-374` is prose ("Ask your agent to run `asc_start_trial`") with no equivalent box. Every other action on the page that matters is copy-pasteable; the one action tied to revenue is not. Fix: give the exact trial-start sentence (with a placeholder email) the same `.install`-style copy box as the init command, in both the hero and the pricing section.

4. **No on-page comparison against the named free and bigger competitors.** The `#different` section (`site/index.html:324-367`) argues against "wrappers" in the abstract; README's actual comparison table (`README.md:268-284`, "Raw API wrappers (free) vs This server") never made it onto the indexed, canonical, JSON-LD-carrying URL. Given the explicit commercial context that Heimdall (890 tools, MIT, free) and three other free alternatives exist, a visitor or an answer engine landing on asc-mcp.pages.dev has no honest, on-page reason to pick a $9/month product over a free one with more raw tools. Fix: port the comparison table (or an equivalent prose table) into `site/index.html`, ideally inside or right after `#different`, and add it as a fifth `FAQPage` question ("Why pay for asc-mcp when free MCP servers exist?") so it is both human-readable and citable.

## MEDIUM (next iteration)

5. **Footer "last updated" date on the home page is stale against its own schema.** `site/index.html:493` reads "Last updated 31 August 2026" while the `SoftwareApplication` JSON-LD two lines later, `site/index.html:519`, carries `"dateModified":"2026-09-07"`. An LLM quoting the visible date and one quoting the schema will disagree about currency on the same page. Fix: drive both from one source; the site build script that already bumps `softwareVersion` and `dateModified` should also rewrite the visible footer sentence.

6. **`writing/license-server/` carries a hardcoded version four releases stale.** `site/writing/license-server/index.html:142` (nav) and `:317` (footer) both say `v1.9.5`; the product is at `v1.9.10` everywhere else on the site. This is a standalone HTML file with its own copy of the version string, so it silently drifts every release: the version badge exists in two files and only one gets updated. Fix: template the version badge from the same source `index.html` reads, or drop the version badge from sub-pages entirely and keep it only on the canonical home page.

7. **llms.txt states a trial-identification detail the page schema does not.** `site/llms.txt:56` says a trial sends "a SHA-256 hash of your Issuer ID." Neither `site/index.html`'s FAQPage entry on trial safety (`site/index.html:525`) nor its trial-start entry (`:522`) mentions hashing; they only say the license check "sends your license key, not your credentials" (`site/index.html:350`). Both statements can be true at once (hash sent once at trial start, key sent on every later check), but stated on two different surfaces with no cross-reference, they read as two different technical claims about what leaves the user's machine, which is exactly the kind of inconsistency a security-conscious developer, this product's actual buyer, will notice and bounce on. Fix: state the hash detail in the FAQPage answer on index.html too, or drop it from llms.txt if it is already covered by the general license-key-only claim.

8. **Title omits the brand token entirely.** `site/index.html:6`, `<title>App Store Connect MCP: ship a release from your agent</title>`, is 53 characters (within the 60-char budget) and leads with the primary keyword, which is correct per the standard, but there is no "asc-mcp" anywhere in the title, so branded search has nothing in the `<title>` to match against. The writing page gets this right (`site/writing/license-server/index.html:6`, ends "| asc-mcp"). Fix: shorten the front half and append the brand, for example "App Store Connect MCP: ship a release | asc-mcp" (49 chars), keeping keyword first, brand last, within budget.

## What's already good

- **Core Web Vitals are excellent on both HTML pages**, measured live: LCP 1.0s (index) / 0.9s (writing), CLS 0, TBT 0ms, Speed Index 1.0s. No web fonts, no render-blocking third-party JS, inline SVG favicon, and system font stack across the board.
- **All JSON-LD parses as valid JSON** (`json.loads` clean) on both HTML pages: `Organization`, `WebSite`, `SoftwareApplication` with `offers` and `featureList`, `FAQPage` (6 questions on index, 4 on the writing page), plus `BreadcrumbList` and `BlogPosting` on the writing page. No `Review`/`AggregateRating` anywhere, correctly, since no real reviews exist to cite.
- **robots.txt allows 15 AI-crawler user-agents by name** (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot, Applebot-Extended, CCBot, Bytespider, Amazonbot, meta-externalagent, plus `*`), triple the standard's floor of 5, and links the sitemap.
- **llms.txt is a complete, correctly-shaped implementation** of the llmstxt.org spec: H1, blockquote, facts with real numbers and dates, key pages, citation-style Q&A, and a preferred citation string.
- **No em-dashes anywhere** across index.html, llms.txt, the writing page, or README.md, and no phrasing from the standard's banned-word list was found in any of the four surfaces (checked by direct scan, zero hits).
- **Pricing is consistent across every surface checked**: $9/month Pro, 7-day trial, no card, 41 tools, 6 free tools, on index.html, llms.txt, the writing page, and README.md.
- **No forms anywhere on the site**, so the form-label criterion is architecturally satisfied: trial start happens inside the user's own agent, never through a web form that could be mislabeled.
- **Trust signals sit at the actual moment of risk**: the Pro tier card (`site/index.html:388-405`) carries "cancel any time," a license-key-recovery link, the privacy/terms links, and the ".p8 never leaves your machine" line immediately next to the $9/month CTA, not in a separate trust section.
- **No unsupportable claims**: no invented star ratings, no "trusted by N teams," no fabricated social proof anywhere in the four surfaces.
- **og.png is correctly sized** at 1200x630 (confirmed via `file` on the downloaded asset) and readable as a thumbnail (clear wordmark, high contrast).

## Re-verification, 2026-09-07 (post-deploy)

The findings below were acted on and deployed same-day. Re-checked independently
against the live site (curl + Lighthouse 12.8.2 + `json.loads` + grep against
`src/gate.ts` and `src/index.ts`), not by trusting the deploy summary.

- **HIGH #2 (trial never shown): FIXED, verified live.** `index.html` now has a second
  terminal block, `asc_start_trial`, directly under the setup-check one, showing the Pro
  refusal, the user's one-line answer, and the trial-start confirmation. Three of the
  strings were checked against source and are verbatim: `"Editing metadata requires
  Pro."`-shaped refusal and `"Free for 7 days, no card: call the asc_start_trial tool
  with the user's email..."` (`src/gate.ts:58,68-69`), `"Saved to ... so it survives a
  restart."` (`src/index.ts:277`), `"Pro trial started. N day(s), no card, nothing to
  cancel."` (`src/index.ts:302`).
- **HIGH #4 (no comparison): FIXED, verified live.** A dated comparison table in
  `#pricing` names Heimdall (890 tools, free, MIT, linked to
  `github.com/erayendes/app-store-connect-mcp`), zelentsov-dev/asc-mcp (502 tools, free,
  MIT, linked), fastlane and the App Store Connect website, with a "read from each
  project on 7 September 2026" line and a paragraph that concedes tool count rather than
  disputing it. The same block is mirrored in `llms.txt` under "How it compares (verified
  7 September 2026)".
- **MEDIUM #5 (date contradiction): FIXED, verified live.** Footer now reads "Last
  updated 7 September 2026", matching the JSON-LD `dateModified` of `2026-09-07`.
- **MEDIUM #6 (stale version badge): FIXED, verified live.** Both occurrences on
  `writing/license-server/index.html` (nav and footer) now read `v1.9.10`.
- **MEDIUM #8 (title lacks brand): PARTIALLY addressed, new defect introduced.** The
  title is now `asc-mcp: App Store Connect MCP server for releases` (50 chars, verified
  live), which puts the brand token first and the primary keyword second. The standard
  requires primary keyword first, brand last; this reverses that order rather than
  fixing it. Not launch-blocking, no CRITICAL item depends on it, but it should be
  reordered, for example `App Store Connect MCP: for releases | asc-mcp`, keyword first,
  brand last, within the 60-char budget.
- **HIGH #3 (no trial copy box): still open, confirmed live.** `asc_start_trial` is
  still plain prose at `index.html:232,374,408`; the install command still has the only
  copy button. CRO friction, not a launch blocker.
- **MEDIUM #7 (llms.txt hash claim uncorroborated): still open, confirmed live.**
  `llms.txt` (lines 12 and 56 in this fetch) still states the SHA-256-hash-of-Issuer-ID
  detail with no matching line in `index.html`'s FAQPage (grepped live, no "hash"
  anywhere on the page). Minor AEO cross-surface consistency gap, not a launch blocker.
- **HIGH #1 (Glama listing): confirmed external, no repo-side fix.** Their builder fails
  resolving `debian:trixie-slim` from Docker Hub before it ever clones this repo.
  Correctly out of scope for a site-file audit.

Overall verdict on re-verification: **PASS**. No CRITICAL item existed in the original
report or exists now; two HIGH-tier items (#3, #7) and one new MEDIUM-tier regression
(title order) remain open but none block launch. Sentinel written to
`.autopilot/state/seo_review_done`.

## Criteria matrix

```csv
criterion,target,verdict,evidence
seo.title.length,index.html,pass,"53 chars, ""App Store Connect MCP: ship a release from your agent"""
seo.title.length,writing/license-server/,pass,"59 chars, includes ""| asc-mcp"""
seo.title.length,llms.txt,n/a,"plain text file, no <title>"
seo.title.length,README.md,n/a,"markdown rendered by npm/Glama, no <head>"
seo.title.keyword,index.html,fail,"re-verified 2026-09-07 post-deploy: title changed to ""asc-mcp: App Store Connect MCP server for releases"" (50 chars), brand now present but leads the title with keyword second, reversing the required order; see MEDIUM #8 re-verification note"
seo.title.keyword,writing/license-server/,pass,"writing/license-server/index.html:6, keyword first, ""| asc-mcp"" last"
seo.title.keyword,llms.txt,n/a,"plain text, no <title>"
seo.title.keyword,README.md,n/a,"npm/Glama render their own chrome around the markdown"
seo.meta.description,index.html,pass,"125 chars, index.html:7, keyword present, does not open with ""We are"""
seo.meta.description,writing/license-server/,pass,"152 chars, writing/license-server/index.html:7, within budget"
seo.meta.description,llms.txt,n/a,"plain text file"
seo.meta.description,README.md,n/a,"npm renders the first paragraph as its own description, no <meta> control"
seo.h1.single,index.html,pass,"exactly one <h1> (index.html:209), names the value prop"
seo.h1.single,writing/license-server/,pass,"exactly one <h1> (writing/license-server/index.html:150)"
seo.h1.single,llms.txt,n/a,"plain text; H1-equivalent is the first markdown # line per llms.txt spec, present at llms.txt:1"
seo.h1.single,README.md,pass,"single # asc-mcp at README.md:1"
seo.heading.hierarchy,index.html,pass,"h2s at pipeline/different/pricing/setup/faq sections cover keyword variations (release, App Store Connect, MCP client, tools)"
seo.heading.hierarchy,writing/license-server/,pass,"h1 plus per-case h2s (Cancel is not revoke, etc.) plus Q&A h3s"
seo.heading.hierarchy,llms.txt,n/a,"plain text"
seo.heading.hierarchy,README.md,pass,"## sections cover Setup, Tools, Security, Comparison"
seo.canonical,index.html,pass,"index.html:9, https://asc-mcp.pages.dev/, matches served URL"
seo.canonical,writing/license-server/,pass,"writing/license-server/index.html:9, matches served URL"
seo.canonical,llms.txt,n/a,"no canonical concept for a text resource"
seo.canonical,README.md,n/a,"npm/Glama own canonicalization of package pages"
seo.robots.meta,index.html,pass,"index.html:8, content=""index,follow"", correct for public page"
seo.robots.meta,writing/license-server/,pass,"writing/license-server/index.html:8, index,follow"
seo.robots.meta,llms.txt,n/a,"governed by robots.txt, not a per-resource meta tag"
seo.robots.meta,README.md,n/a,"npm/Glama control indexing of their own pages"
seo.opengraph,index.html,pass,"index.html:10-14, og:type/url/title/description/image all present"
seo.opengraph,writing/license-server/,pass,"writing/license-server/index.html:10-14, og:type=article, all five present"
seo.opengraph,llms.txt,n/a,"no HTML head"
seo.opengraph,README.md,n/a,"npm/Glama generate their own share cards"
seo.twitter.card,index.html,pass,"index.html:15-18, summary_large_image plus twitter:image"
seo.twitter.card,writing/license-server/,pass,"writing/license-server/index.html:15-18, summary_large_image plus twitter:image"
seo.twitter.card,llms.txt,n/a,"no HTML head"
seo.twitter.card,README.md,n/a,"no HTML head"
seo.image.alt,index.html,n/a,"zero <img> tags on the page (grep confirmed); favicon is a decorative inline SVG data URI, not content"
seo.image.alt,writing/license-server/,n/a,"zero <img> tags on the page (grep confirmed)"
seo.image.alt,llms.txt,n/a,"no images"
seo.image.alt,README.md,n/a,"no images embedded"
seo.semantic.html,index.html,pass,"nav/main/button present (index.html:194,245,218); zero div onclick (grep confirmed, JS uses addEventListener at index.html:498)"
seo.semantic.html,writing/license-server/,pass,"nav/main/article present (writing/license-server/index.html:136,146,156); no onclick"
seo.semantic.html,llms.txt,n/a,"not HTML"
seo.semantic.html,README.md,n/a,"not HTML"
seo.robots.txt,<site>,pass,"site/robots.txt: 200 live, Allow: / by default, Sitemap: line present"
seo.robots.ai,<site>,pass,"15 named AI-crawler allow blocks in site/robots.txt (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot, Applebot-Extended, CCBot, Bytespider, Amazonbot, meta-externalagent), 3x the floor of 5"
seo.sitemap,<site>,pass,"site/sitemap.xml lists both public pages (/ and /writing/license-server/) with lastmod 2026-09-03; live 200"
seo.internal.links,<site>,pass,"privacy/terms/pricing reachable from index.html footer (index.html:481-489) and pricing section; writing page links back to home and #pricing"
seo.broken.links,<site>,pass,"all tested internal and cross-surface links (GitHub, releases/latest, USER_GUIDE.md, LIMITATIONS.md, logic.ts, Polar checkout, license-worker /privacy /terms /key /go) returned 200; npm package URL returned 403 to curl but this is npmjs.com's own bot wall, not a site defect"
cro.hero.single.cta,index.html,pass,"one ranked primary CTA (amber .btn ""Start free, no card"", index.html:215) plus one visually secondary install box (index.html:216-219); no floating widgets, no popups"
cro.hero.single.cta,writing/license-server/,n/a,"editorial post, not a conversion page; single CTA block deferred to end of article, writing/license-server/index.html:296-300"
cro.hero.single.cta,llms.txt,n/a,"not a visual page"
cro.hero.single.cta,README.md,pass,"single primary link (pricing) in the opening line, README.md:5"
cro.risk.reversal,index.html,pass,"no card and nothing to cancel, .p8 key never leaves your machine, sits directly under the hero CTA, index.html:221-222; repeated at pricing, index.html:373-374"
cro.risk.reversal,writing/license-server/,pass,"end-of-article CTA restates the trial terms, writing/license-server/index.html:298"
cro.risk.reversal,llms.txt,n/a,"not a visual page"
cro.risk.reversal,README.md,pass,"README.md:15, trial terms stated next to the install command"
cro.friction,index.html,pass,"pricing fully visible with no email gate (index.html:369-408); no forms anywhere on the page (grep confirmed zero <form>/<label>); no comparison table exists yet to paywall, the gap is absence not paywalling, see HIGH #4"
cro.friction,writing/license-server/,n/a,"no pricing or forms on this page by design"
cro.friction,llms.txt,n/a,"not an interactive surface"
cro.friction,README.md,pass,"pricing link and cost stated in plain text with no gate, README.md:5,15"
cro.trust.signals,index.html,pass,"cancel-any-time, key-recovery link, privacy/terms links, and .p8-never-leaves-machine line sit inside the Pro tier card next to its CTA, index.html:396-404"
cro.trust.signals,writing/license-server/,pass,"footer carries maintainer identity, license, jurisdiction; article itself is the trust signal via named incidents and a real link to logic.ts"
cro.trust.signals,llms.txt,n/a,"not a visual page"
cro.trust.signals,README.md,pass,"Security section states the same .p8-local claim, README.md:286-293"
cro.mobile.thumb,index.html,pass,"primary CTA min-height 48px (index.html:102-105 .btn rule), hero CTA sits within first viewport on 375px width, verified via CSS clamp() h1 sizing"
cro.mobile.thumb,writing/license-server/,n/a,"long-form reading page, no primary conversion CTA above the fold by design"
cro.mobile.thumb,llms.txt,n/a,"not a visual page"
cro.mobile.thumb,README.md,n/a,"npm/Glama control their own mobile rendering"
cro.speed.cta,index.html,pass,"primary CTA is a plain <a href> (index.html:215), not JS-gated; zero web fonts loaded (system font stack, index.html:29); Lighthouse TBT 0ms, LCP 1.0s live"
cro.speed.cta,writing/license-server/,pass,"same system font stack, zero blocking JS; Lighthouse TBT 0ms, LCP 0.9s live"
cro.speed.cta,llms.txt,n/a,"not a rendered page"
cro.speed.cta,README.md,n/a,"npm/Glama control their own page performance"
cro.depth.intent,index.html,pass,"pricing is a same-page anchor section, zero clicks to reach content, index.html:369"
cro.depth.intent,writing/license-server/,pass,"single scroll-depth article, no pagination or gating"
cro.depth.intent,llms.txt,n/a,"not a navigable page"
cro.depth.intent,README.md,pass,"pricing link and cost stated in the first five lines, README.md:5,15"
cro.cta.copy,index.html,fail,"""Start free, no card"" (index.html:215) names an outcome, not a destination, and does not itself start anything, it scrolls to #pricing where the actual action is a prose instruction; see HIGH #2/#3"
cro.cta.copy,writing/license-server/,pass,"the end-of-article link names its destination plainly (asc-mcp), writing/license-server/index.html:298"
cro.cta.copy,llms.txt,n/a,"not a visual page"
cro.cta.copy,README.md,pass,"[Get Pro](...) and [Retrieve your license key](...) both name their destination, README.md:159"
aeo.schema.organization,<site>,pass,"index.html:517, Organization with name/url/email/founder all present"
aeo.schema.website,<site>,pass,"index.html:518, WebSite schema present; no SearchAction, correctly omitted since the site has no search feature to advertise"
aeo.schema.product,<site>,pass,"index.html:519, SoftwareApplication matches actual product type (DeveloperApplication), with offers and featureList"
aeo.schema.faq,index.html,pass,"index.html:520-527, FAQPage with 6 Q&A pairs covering cost, trial start, safety, capability limits, client compatibility"
aeo.schema.faq,writing/license-server/,pass,"writing/license-server/index.html:123-131, FAQPage with 4 Q&A pairs specific to the article's technical claims"
aeo.schema.faq,llms.txt,n/a,"not JSON-LD; llms.txt has its own citation-style Q&A section instead (llms.txt:41-59), the correct format for that file type"
aeo.schema.faq,README.md,n/a,"markdown has no JSON-LD capability"
aeo.schema.breadcrumb,index.html,n/a,"home page, standard requires BreadcrumbList on sub-pages only"
aeo.schema.breadcrumb,writing/license-server/,pass,"writing/license-server/index.html:110-112, BreadcrumbList linking back to home"
aeo.schema.breadcrumb,llms.txt,n/a,"not a sub-page in the schema sense"
aeo.schema.breadcrumb,README.md,n/a,"no JSON-LD capability"
aeo.schema.review,<site>,pass,"no Review/AggregateRating anywhere on any surface, correct because no real reviews exist to cite, checked all four surfaces"
aeo.schema.valid,index.html,pass,"json.loads parses the full @graph block clean, no trailing commas or syntax errors"
aeo.schema.valid,writing/license-server/,pass,"json.loads parses both JSON-LD blocks clean"
aeo.schema.valid,llms.txt,n/a,"no JSON-LD in a text file"
aeo.schema.valid,README.md,n/a,"no JSON-LD in markdown"
aeo.answer.block,index.html,pass,"direct quotable statements throughout #different (index.html:329-365), for example ""This server ships 41 opinionated tools"" and ""Nothing, for the first seven days"""
aeo.answer.block,writing/license-server/,pass,"each of the 7 cases opens with a direct factual claim plus a named Rule callout, for example writing/license-server/index.html:167"
aeo.answer.block,llms.txt,pass,"Facts section (llms.txt:5-19) is written entirely as quotable declarative sentences"
aeo.answer.block,README.md,pass,"tool tables and Security section state capabilities as direct facts, README.md:286-293"
aeo.evidence,index.html,fail,"specific numbers present (41 tools, $9/month, 7 days, 175 territories) but the visible ""Last updated 31 August 2026"" (index.html:493) contradicts the schema's dateModified of 2026-09-07 (index.html:519); a self-contradicting date is worse than no date, see MEDIUM #5"
aeo.evidence,writing/license-server/,pass,"re-verified 2026-09-07 post-deploy: both version badges now read v1.9.10, matching the rest of the site; see MEDIUM #6 re-verification note"
aeo.evidence,llms.txt,fail,"trial hash-of-Issuer-ID claim (llms.txt:56) is not corroborated on index.html's own FAQPage, so the specific claim is not evidenced consistently across the site's own citable surfaces; see MEDIUM #7"
aeo.evidence,README.md,pass,"version, publish date, and tool counts in README.md:7 match the live site exactly"
aeo.comparison,index.html,pass,"re-verified 2026-09-07 post-deploy: dated comparison table live in #pricing naming Heimdall, zelentsov-dev/asc-mcp, fastlane and the ASC website, each linked, with a concession paragraph on tool count; see HIGH #4 re-verification note"
aeo.comparison,writing/license-server/,n/a,"article is about license-server engineering, not product comparison; not the right page for this content"
aeo.comparison,llms.txt,pass,"re-verified 2026-09-07 post-deploy: ""How it compares (verified 7 September 2026)"" section added to llms.txt mirroring the on-page comparison table"
aeo.comparison,README.md,pass,"explicit comparison table against ""Raw API wrappers (free)"", README.md:268-284, honest about tradeoffs (tool count 80-982 vs 41)"
aeo.dates,index.html,pass,"re-verified 2026-09-07 post-deploy: footer now reads ""Last updated 7 September 2026"", matching dateModified 2026-09-07; see MEDIUM #5 re-verification note"
aeo.dates,writing/license-server/,pass,"datePublished and dateModified in schema (writing/license-server/index.html:117) match the visible ""Last updated 7 August 2026"" (writing/license-server/index.html:320)"
aeo.dates,llms.txt,pass,"llms.txt:63 citation string carries an explicit updated date matching the current release"
aeo.dates,README.md,n/a,"README has no persistent dateModified concept; npm shows its own last-publish timestamp independently"
aeo.llms.txt,<site>,pass,"site/llms.txt: H1 (line 1), blockquote summary (line 3), Facts (5-19), What the API cannot do (21-29), Key pages (31-39), Q&A (41-59), Citation (61-63); served live at /llms.txt with 200 and correct text/plain content-type per site/_headers"
aeo.og.image,<site>,pass,"og.png confirmed 1200x630 via file on the downloaded live asset, clear wordmark, readable as a thumbnail"
copy.no.emdash,index.html,pass,"zero em-dashes, regex-scanned"
copy.no.emdash,writing/license-server/,pass,"zero em-dashes, regex-scanned"
copy.no.emdash,llms.txt,pass,"zero em-dashes, regex-scanned"
copy.no.emdash,README.md,pass,"zero em-dashes, regex-scanned"
copy.no.slop,index.html,pass,"no banned-word-list phrases found, direct scan against the standard's list, zero hits"
copy.no.slop,writing/license-server/,pass,"no banned-word-list phrases found, zero hits"
copy.no.slop,llms.txt,pass,"no banned-word-list phrases found, zero hits"
copy.no.slop,README.md,pass,"no banned-word-list phrases found, zero hits"
copy.claims.supported,index.html,pass,"no fabricated social proof; the ""shipped a real app"" claim (index.html:361-364) is specific (June 2026, named artifacts) rather than a vague trust badge"
copy.claims.supported,writing/license-server/,pass,"claims are backed by named test counts (180 unit tests, 39 HTTP checks, and so on, writing/license-server/index.html:268) rather than round marketing numbers"
copy.claims.supported,llms.txt,pass,"no unsupportable claims, all figures traceable to the same facts stated on index.html"
copy.claims.supported,README.md,pass,"comparison table claims are attributed and specific, not vague superiority claims"
copy.pricing.consistent,<site>,pass,"$9/month, 7-day trial, no card, 41 tools, 6 free tools stated identically across index.html, llms.txt, writing/license-server/index.html, and README.md"
```
