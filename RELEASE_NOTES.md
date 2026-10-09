v1.9.15: release_notes accepts revisions and build tags again

Download **asc-mcp-1.9.15.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**Update if you pass a revision or a build tag to `release_notes`**

The security fix in 1.9.12 restricted `since_tag` to letters, digits and `. _ / -`. That also refused values that had always worked: a relative revision such as `HEAD~1` or `HEAD^`, and a build tag with a plus sign such as `v1.2.3+45`. They are accepted again. The fix itself stands: git is run without a shell, and a value still cannot start with a dash.

**What else changed**

If the licence server cannot be reached and this machine has never confirmed your key, the reply now says only that: your key could not be checked, it is fine, retry in a moment. Since 1.9.14 a subscriber in that position was counted through the free preview and then shown the price.

A licence key pasted with a stray space or newline around it now validates. It was sent exactly as it sat in the config and never matched.

Nothing else changes for subscribers: every other tool, argument and reply is identical to 1.9.14.
