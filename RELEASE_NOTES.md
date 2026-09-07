v1.9.11: the trial tool now says what it stores, where you can read it

Download **asc-mcp-1.9.11.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**What changed**

`asc_start_trial` sends two things: the email address you give it, so the key can reach you, and a one-way SHA-256 hash of your Issuer ID, computed on your machine, so one Apple developer account cannot take unlimited free weeks. That has always been true and has always been documented on the website, but the website is not where it happens. The trial is started from inside your agent by someone who may never open the site at all, so the tool now says it at the moment it asks for your address, and the confirmation you get back names both values and links to the deletion page and the privacy policy.

Nothing about what is collected changed. This release changes only where you are told.

Alongside it, the published privacy policy was corrected. It said the Issuer ID fingerprint is "never sent if you never start a trial", and that was wrong: `asc_start_trial` is also how a subscriber fetches their paid key onto a new machine, and that path records the same fingerprint. The policy now says so, names the lawful basis for each thing it holds, names Brevo as the email processor, and points at the Lithuanian supervisory authority.

No tool behaviour changed and no gating changed.
