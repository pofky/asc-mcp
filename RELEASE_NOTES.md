v1.9.8: the trial tells you how long it has left

Download **asc-mcp-1.9.8.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**What changed**

A running trial reported itself as "Pro license active. All tools available." and nothing else. That is true and useless: the one fact a trial user needs is how many of the seven days are left, and the product never said, in any surface, until the day the tools stopped working.

`asc_setup_check` and `npx @pofky/asc-mcp doctor` now read the expiry the licence server has always returned. A trial reads "Pro trial: all tools unlocked, 5 days left". In the last two days it becomes a warning and names the price, because at that point the useful answer is what it costs to keep the write and control tools, not a green tick. A subscription is unchanged: no countdown, no upsell, just Pro.

The server's startup line says the same thing, so a client that surfaces stderr shows the remaining days without anyone having to ask.

Nothing else changed, and nothing behaves differently if you are a subscriber.
