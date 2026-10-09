v1.9.13: a trial now survives a restart in every client

Download **asc-mcp-1.9.13.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**Update if you started a trial and it vanished**

A trial key was kept after a restart only when asc-mcp found its own server block at the top level of the Claude Desktop config, `~/.claude.json` or a local `.mcp.json`. A server added with `claude mcp add` at its default scope sits under a project instead, and Cursor, Windsurf and Cline keep their configs elsewhere, so for those installs the key lasted until the client closed. The next session was back on the free tier, with no days-left line and nothing to say a trial had ever started.

The key is now also saved on your machine, in `~/.asc-mcp/license.json`, with owner-only permissions on macOS and Linux, and read at startup when your client config carries no key. A key in your config always wins over it. Delete the file to remove it. asc-mcp also finds Cursor, Windsurf and Cline configs and Claude Code's per-project blocks, for the trial key and for `init --write`.

If your trial ended this way, ask your agent to run `asc_start_trial` with the same email. It will tell you where you stand, and if you have subscribed it fetches your paid key.

**What else changed**

`init --write` updates a server Claude Code keeps under a project in place. It used to add a second block beside it that the client never ran, and report success. When none of the configs it knows exists, it now lists the paths it looked for.

The playbook said the free tier included the intelligence tools. It does not: the free tools are `list_apps`, `app_details` and `review_status`, plus the setup check, the playbook and the trial starter. The README said three tools need no Apple key; it is two, the setup check and the playbook.
