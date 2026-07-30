# r/iOSProgramming

Refreshed 30 July 2026 for v1.8.1. Value-first post, product mentioned once near the end.
Read the subreddit rules before posting: self-promotion needs to be incidental to the
substance, so the substance here is the limitation list.

**Title:** What I learned automating an App Store submission: the five things the API cannot do

---

I spent a few weeks driving App Store Connect entirely through its API to ship an app's
1.0, and the useful output was not the automation. It was the list of walls. Posting it
here because I could not find this written down anywhere, and every one of these cost me
a wasted afternoon.

**1. You cannot create an app record.** `POST /v1/apps` returns 403, "resource 'apps' does
not allow CREATE", for every API key regardless of role. App Groups are the same story,
portal only. So the first ten minutes of any new app are manual, always.

**2. The App Privacy nutrition label is not in the public API.** The `appDataUsages`
resource is not exposed. If you were hoping to script "Data Not Collected" across ten apps,
you cannot.

**3. EU DSA trader status has no API attribute.** It is also a legal declaration about who
you are, so honestly it should stay manual.

**4. An app's very first in-app purchases cannot be submitted through the API.** You get
`FIRST_NON_CONSUMABLE_MUST_BE_SUBMITTED_ON_VERSION`. Only the website can bundle products
with a version for review. Later products submit over the API fine. This one is nasty
because a naive script submits the version without the products and orphans it.

**5. Xcode cloud signing does not work with a least-privilege API key.** You get "no
profiles found" or a cloud signing permission error. The fix that worked: create
`IOS_APP_STORE` profiles directly via `POST /v1/profiles`, install them into
`~/Library/MobileDevice/Provisioning Profiles`, then export with `signingStyle=manual`
and an explicit bundle-id to profile mapping.

**Two smaller ones.** Subscription state is only recomputed on a subscription-level PATCH,
so after setting price, availability and screenshots your product sits in MISSING_METADATA
until you make a no-op PATCH to the subscription itself. And a universal app with
portrait-only orientations fails iPad multitasking validation on upload, so either commit
to an iPad layout or set the device family to iPhone only.

Everything else really is automatable: version metadata with character limits, screenshots
per display type, build attach, TestFlight, age rating, territory pricing, submit, release,
phased rollout.

I packaged all of this into an MCP server so my agent can drive it and stops at each manual
step with the exact instructions instead of failing: `@pofky/asc-mcp`
(https://asc-mcp.pages.dev). Five tools are free including the playbook one, the write and
control tools are $9/mo. Your `.p8` never leaves your machine.

Happy to go deeper on any of the five if it helps someone avoid the afternoon I lost.
