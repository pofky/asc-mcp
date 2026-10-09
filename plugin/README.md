# asc-mcp

Run an App Store release from a conversation. asc-mcp connects Claude to your App Store Connect account: read review status, reviews and sales, edit metadata, upload screenshots, attach a build, manage TestFlight, create in-app purchases, submit for review and release.

This plugin bundles two things:

- The `asc-mcp` MCP server, which runs locally on your Mac or PC and talks to Apple's API from there.
- The `asc-review-triage` skill, which tells Claude how to pull and triage customer reviews.

## Install

From Claude Code:

```
/plugin install asc-mcp --marketplace pofky/asc-mcp
```

## Setup

You need Node.js 18 or later, an Apple Developer Program membership, and an App Store Connect API key with the Admin or App Manager role. Create the key at <https://appstoreconnect.apple.com/access/integrations/api> and download the `.p8` file.

When you enable the plugin it asks for three values:

- **Issuer ID** (required): the UUID shown above the key list in App Store Connect.
- **API private key** (optional): the path to your `AuthKey_XXXXXXXXXX.p8`. Leave it empty if the file is in `~/.appstoreconnect/private_keys/`, where it is found automatically.
- **License key** (optional): leave it empty to use the free tier.

Then ask Claude to run `asc_setup_check`. It tests the key, the Issuer ID and a live connection to Apple, and prints the exact fix for anything that is wrong.

## Use it

Ask in plain language: "what is the review status of my app", "show me this week's 1-star reviews", "update the description for the German listing", "attach the newest build and submit for review". `asc_guide` returns the full playbook for each release task, including the steps Apple only allows on its website.

Tools that only read are marked read-only. Every tool that changes something in your account is marked as a write, so a client can ask before running it, and the ones that cannot be undone (submitting, releasing, notifying testers) also require an explicit `confirm: true`.

## Free and Pro

Six tools are free: setup check, guide, list apps, app details, review status and starting a trial. The rest need Pro, which is $9 a month through Polar, plus any tax Polar adds at checkout, billed monthly until you cancel. `asc_start_trial` gives 7 days of Pro with no card, once per Apple developer account, and needs an email address. When the trial ends the server goes back to the six free tools and nothing is charged. A tool that needs Pro says so when called and does nothing else.

## What this plugin runs and sends

The plugin starts one process: `npx -y @pofky/asc-mcp@<version>`, pinned to an exact version of the [npm package](https://www.npmjs.com/package/@pofky/asc-mcp), whose source is this repository. `npx` downloads that package and its dependencies from the npm registry (`registry.npmjs.org`). The plugin has no hooks, commands or agents.

The server process itself makes network requests to three places:

- **Apple's App Store Connect API** (`api.appstoreconnect.apple.com`), authenticated with a token signed on your machine from your `.p8` key. This is where every App Store read and write goes. Screenshot files are sent to the upload addresses Apple returns for them.
- **Apple's iTunes Search API** (`itunes.apple.com`), for the public store data behind `keyword_insights` and `competitor_snapshot`. The request carries the search term or app ID and nothing about your account.
- **The asc-mcp licence server** (`asc-mcp-license.remewdy.workers.dev`), only in the two cases described under Privacy Policy below.

Some tools run other programs on your machine when you call them:

- `build_and_archive` and `upload_binary` run Apple's own `xcodebuild` and `altool`. Both contact Apple: `xcodebuild` to fetch signing assets, `altool` to upload the `.ipa`, signed in with your API key.
- `setup_app_store_signing` downloads your provisioning profiles from Apple into `~/Library/MobileDevice/Provisioning Profiles` and writes an `ExportOptions.plist`.
- `release_notes` runs `git log` in the project folder you point it at.
- `triage_reviews` and `draft_review_response` pass review text to your own Claude client through MCP sampling, so it goes to the model you are already using and not to us.

## Privacy Policy

Full policy: <https://asc-mcp-license.remewdy.workers.dev/privacy>

**Data collection.** Using the free tier, or using Pro once a key is set, stores nothing with us. Your `.p8` private key is read on your machine to sign a short-lived token and is not sent to us or to anyone else. That token names your Key ID and Issuer ID and goes to Apple, as does the `altool` upload. None of the three is sent to us; the Issuer ID reaches us only as the one-way digest described below. No App Store Connect data passes through our servers. The server has no usage analytics or telemetry. The only tool name it ever sends is the optional one in a trial request, described below.

Two requests go from the server process to the licence server, each only when you cause it:

- If a licence key is set, the key string is sent on startup to check it, and the result is cached for 24 hours.
- If you call `asc_start_trial`, it sends the email address you give it, a one-way SHA-256 digest of your Issuer ID (hashed on your machine, the Issuer ID itself is not sent to us), and the name of the tool you were trying to use.

One more reaches it from your browser. If you open a subscribe link the server printed, the browser passes through a redirect on the licence server that adds one to a daily count for the tool named in the link. The count holds a date, a tool name and a number, and nothing about you. A subscribe link in an email we sent you also carries your address, only to prefill the checkout.

If you subscribe, Polar passes us your email address and subscription ID so a licence key can be issued.

**Usage and storage.** The email address is used to send you the key, one reminder shortly before the trial ends, one note after it, and rarely a product notice or a personal note from the developer. Each carries an unsubscribe link or can be stopped by replying stop. A deletion confirmation link is sent only when you ask for one. The digest stops one developer account from taking unlimited trials. Records are stored on Cloudflare D1 in the EU region.

For licensing, the server keeps one small file on your machine, `~/.asc-mcp/last-verdict.json`, holding the last licence check and a hash of the key (not the key), so a paid licence keeps working when the licence server cannot be reached. Starting a trial writes the new key into `~/.claude.json`, the Claude Desktop config or `./.mcp.json`, but only into a file that already has an asc-mcp entry, and leaves a backup beside it. For this plugin it otherwise tells you to set the License key option yourself.

**Third-party sharing.** Nothing is sold or shared for advertising. Two processors handle data on our behalf: Cloudflare (hosting and database) and Brevo (email delivery, which receives your address and the message). If you subscribe, Polar takes the payment as merchant of record under its own privacy policy; we never see card details.

**Data retention.** The whole record (email, licence key, subscription ID, the Issuer ID digest, the tool name, and the dates) is kept for as long as it exists, including after a trial ends or a subscription is cancelled. There is no automatic purge. You can delete everything at any time at <https://asc-mcp-license.remewdy.workers.dev/delete>, which emails a confirmation link and deletes when you click it.

**Contact.** The data controller is Povilas Konopackas, sole trader, Lithuania. povkonop@gmail.com

## Support

Issues: <https://github.com/pofky/asc-mcp/issues>. User guide: <https://github.com/pofky/asc-mcp/blob/master/USER_GUIDE.md>. Terms: <https://asc-mcp-license.remewdy.workers.dev/terms>.

This project is not affiliated with, endorsed by, or sponsored by Apple Inc. Apple, App Store, App Store Connect, TestFlight, Xcode, iOS and macOS are trademarks of Apple Inc. Claude is a trademark of Anthropic, PBC. This project is not affiliated with or endorsed by Anthropic.
