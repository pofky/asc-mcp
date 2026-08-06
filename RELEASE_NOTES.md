v1.9.2: readable setup prompts in the one-click install

Download **asc-mcp-1.9.2.mcpb** below and open it. Claude for macOS and Windows installs it in one click, asks for your Issuer ID, and lets you pick your `.p8` with a file picker.

Every other client is unchanged: `npx @pofky/asc-mcp init --write`.

**What changed since 1.9.1**

The bundle's setup dialog was hard to read. Claude Desktop renders each config field's description twice, once as help text above the field and once as the placeholder inside it, so every field said the same sentence twice and then cut off mid-word. The three descriptions are now written to work in both roles.

No server behaviour changed. If you are already running 1.9.1, there is nothing here you need.

---

This file is the source of the next release's GitHub notes. `npm run release` reads it, uses the first line as the title and the rest as the body, and refuses to publish if it is missing or too short. Rewrite it for each version before releasing.
