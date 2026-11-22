# Installing asc-mcp (for AI agents)

These steps are for an AI agent such as Cline, Claude Code or Cursor that is setting up asc-mcp for a user. asc-mcp is an App Store Connect MCP server. It runs locally over stdio with Node 18 or newer. The user's App Store Connect key never leaves their machine.

## 1. Add the server

Add this entry to the MCP settings file (for Cline: `cline_mcp_settings.json`). No env vars are needed yet.

```json
{
  "mcpServers": {
    "asc-mcp": {
      "command": "npx",
      "args": ["-y", "@pofky/asc-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Claude Code users can run this instead: `claude mcp add asc-mcp -- npx -y @pofky/asc-mcp`

Until it is connected, the server shows three setup tools: `asc_setup_check`, `asc_guide` and `asc_connect`.

## 2. Ask the user for two things

Do not invent either value. Ask the user.

1. **An App Store Connect API key file.** They create it at https://appstoreconnect.apple.com/access/integrations/api with the Admin or App Manager role and click Download. The file is named `AuthKey_XXXXXXXXXX.p8`. Apple allows only one download. Leaving it in `~/Downloads` or `~/Desktop` is fine.
2. **The Issuer ID.** The UUID at the top of that same page.

## 3. Connect in the chat

Call `asc_connect` with the Issuer ID. It finds the `.p8` in `~/.appstoreconnect/private_keys`, `~/Downloads` or `~/Desktop` and tests it against Apple before it touches anything. Then it moves a key found in `~/Downloads` or `~/Desktop` into `~/.appstoreconnect/private_keys` (a key anywhere else stays where it is), saves the Issuer ID in `~/.asc-mcp/credentials.json` and loads all 45 tools in the same session. A wrong Issuer ID is refused and nothing moves. If the key is somewhere else, pass its path as `key_path`.

If the client still lists only the setup tools afterwards, restart the MCP server once. It starts connected.

Terminal alternative: `npx -y @pofky/asc-mcp init --write`

## 4. Verify

Call `asc_setup_check`. It should report the key, the Issuer ID and a live connection as OK. Then call `list_apps` to show the user their apps.

## Free and Pro

Six tools are free with no time limit. Pro unlocks the rest. If the user wants it, call `asc_start_trial` with the email address the user gives you. That starts a 7-day trial with no card, in the same session. After the trial Pro costs $9 a month. Every write to App Store Connect, such as changing a price or submitting for review, previews first and runs only with `confirm: true`. Get the user's go-ahead before you pass it.

## Troubleshooting

- `npx @pofky/asc-mcp doctor` in a terminal checks the key, the Issuer ID, the connection and the license.
- `asc_guide` explains every flow, and lists the steps Apple's API cannot do, such as creating the app record.
- Issues: https://github.com/pofky/asc-mcp/issues
