v1.9.12: a security fix in release_notes, and asc-mcp as a Claude plugin

Download **asc-mcp-1.9.12.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**Update if you use `release_notes`**

`release_notes` passed its `since_tag` argument into a shell command. A tag name is normally typed by you, but an agent can be talked into passing one it read somewhere else, and a crafted value could run a command on your machine. The tool no longer goes through a shell at all, `since_tag` is restricted to the characters a ref name uses, and `max_commits` is capped at 500. Everyone on 1.9.11 or earlier should update.

**What else changed**

Every tool now tells the client what it is. All 41 carry a title and say whether they only read or whether they change something, so a client can run the 20 read tools without asking and stop to confirm the 21 that write to your App Store account, a tester's inbox or this machine. Nothing about what the tools do changed, and no name or argument moved.

asc-mcp is installable as a plugin. One line in Claude Code installs the server and the review-triage skill together and asks for your Issuer ID. The plugin's README lists what it runs and what it sends.

A setting left blank in a plugin or bundle install is now treated as not set. Before, an empty licence field could reach the server as a placeholder, and `doctor` and the Pro gate would report a key that failed to validate to someone who had never entered one.

The trial tool now says what the address you give it is used for: the key, one reminder before the trial ends and one note after it, each with an unsubscribe link.

The review-triage skill no longer quotes a price or a checkout link. When a tool needs Pro, the tool says so itself.

No gating changed.
