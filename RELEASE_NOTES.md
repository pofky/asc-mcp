v1.9.4: an outage can no longer demote a subscriber, and your key stops being readable from your email address

Download **asc-mcp-1.9.4.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write`.

**If you subscribe, two things here matter.**

A licence-server hiccup used to drop you to the free tier. Validation treated any error, including our own 500s and a dropped connection, as a verdict of "not Pro", and the only cache was in memory, so every new session during an outage demoted you again and told you to buy what you had already bought. A key confirmed as Pro is now remembered on your machine and honoured for up to 14 days when the server cannot answer. Only a Pro verdict is ever remembered, so this can never hand Pro to a key the server has not approved.

And asking your agent for your key no longer discloses it to anyone who knows your email address. The first machine to claim a subscription keeps getting the key in the agent, exactly as now. A claim from any other machine gets the key emailed to the address on the subscription instead of returned in the response. You always end up with your key; someone who guessed your email gets a response with nothing in it, and you get an email telling you it happened.

Also fixed on the licence server, live already: a customer who cancelled and later resubscribed could be handed their old, dead key, which then failed to validate right after they had paid again. And the key lookup page now matches your email whatever case you type it in.

**If you use the Claude Desktop bundle**

The Pro upgrade message told you to set `ASC_LICENSE_KEY` in your MCP server config. A one-click install has no such file, so it was sending you to look for JSON that does not exist. It now points at the extension's own License key field.

Starting the server with no credentials also advertised a prompts capability it could not serve, so clients that list prompts on connect saw an error from the one mode whose job is to explain how to fix your setup.

**Smaller things**

`list_apps` now returns the SKU it was already fetching and quietly discarding. The setup check no longer describes the intelligence tools as free, because they are not. The setup guide points at real config paths instead of one Claude Code does not read. The product is called asc-mcp everywhere, including in the emails the licence server sends.

**Upgrading**

Worth it for every subscriber. The licence-server half is already live, so the key-lookup and resubscribe fixes apply to you whatever version you run; the outage grace and the bundle fixes need this release.
