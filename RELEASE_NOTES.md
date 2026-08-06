v1.9.3: paying subscribers can fetch their key from inside the agent again

Download **asc-mcp-1.9.3.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write`.

**If you subscribe, this one matters.**

Asking your agent to run `asc_start_trial` with the email you checked out with is supposed to fetch your paid license key and put it in your config. Instead it answered "No new trial is available for that address", which is the message meant for someone whose free trial is spent, shown to someone who is actively paying.

The licence server only handed back a paid key when the same machine also held a trial row, which covers people who converted mid-trial and nobody else. Anyone who subscribed without trialling first, or who was setting up a second machine, was refused. That fix is already live on the licence server, so it works now regardless of which version of the package you run.

**Also in this release**

The one-click install had no way to save your license key. It looked for an `asc-mcp` block in a client config file, which an extension does not have, and then told you to hand-edit JSON that does not exist. It now points you at the extension's own License key field instead.

**Upgrading**

Worth it if you use the Claude Desktop bundle. If you install through `npx`, nothing here changes for you, since the licence-server half was already deployed.
