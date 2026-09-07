v1.9.10: a declined renewal now says so

Download **asc-mcp-1.9.10.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**What changed**

If a subscription renewal is declined by your bank, the subscription is closed and the licence key stops unlocking Pro. That part is expected. What the product said about it was not: `doctor` reported "a license key is set but did not validate as Pro" and sent you to re-check a key that was never wrong, and the Pro tools greeted you with "Free for 7 days, no card: call `asc_start_trial`", which is an offer the trial endpoint refuses to anyone who has already subscribed.

Now the licence server distinguishes a revoked subscription from a cancelled one from a merely inactive row, and the server says what actually happened. `doctor` names the declined renewal and links straight to restarting. The Pro tools drop the trial offer for anyone who has subscribed before and lead with the price and the link instead.

Nothing about tier gating changed: the same keys unlock the same tools as before. This only changes what you are told when a key stops working, and what you are offered next.

Upgrade if you are a subscriber. If you are on the free tier or in a trial, nothing here affects you.
