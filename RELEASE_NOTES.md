v1.9.9: the free tier says what it is

Download **asc-mcp-1.9.9.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**What changed**

On the free tier the server told your agent nothing about tiers at all. So if you installed it and asked it to read something, it read it, and you never found out that 35 more tools exist or that seven days of them are free. The only way to discover any of that was to ask for something locked and get refused.

The instructions every MCP client hands the model now say, on the free tier only, which six tools work, which are locked and why, and that `asc_start_trial` unlocks everything for 7 days with no card and takes effect in the running session. They also tell the model to offer that once, drop it if you say no, and never to imply the free read tools are limited, because they are not. On Pro the instructions are unchanged and say nothing about tiers, trials or prices.

`asc_start_trial` is now also described as something to offer when you ask for something only a Pro tool can do, rather than only after a refusal has already happened.

No tool behaviour changed, and nothing new is sent anywhere.
