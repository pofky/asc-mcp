v1.9.7: the setup check stops blaming your key when your trial simply ended

Download **asc-mcp-1.9.7.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**What changed**

On day 8 of the free trial, `asc_setup_check` (and `npx @pofky/asc-mcp doctor`) reported "A license key is set but did not validate as Pro" and told you to go and look up your key, or wait for the licence server to come back. Both are wrong: the key is fine, the server is fine, the trial is simply over. That is the one moment where the useful answer is the price and the link, and the check was hiding it.

The licence server already says why a key is not Pro, so the check now reads that reason. A finished trial says so and offers Pro at $9/month plus the reminder that `asc_start_trial` fetches your paid key if you already subscribed. A cancelled subscription and an expired licence get their own wording. Anything else, including an unreachable licence server, keeps the old message, which is correct for those cases.

Nothing else changed. If you are on 1.9.6 and not at the end of a trial, this release does nothing for you.
