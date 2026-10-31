v1.10.0: release_preflight says what it could not check

Download **asc-mcp-1.10.0.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Claude Code: `/plugin install asc-mcp --marketplace pofky/asc-mcp`. Every other client: `npx -y @pofky/asc-mcp@latest`.

**Why this release**

The old preflight could print "PASS: Ready to submit" when Apple refused some of its reads, because those checks failed silently. It could also pass an app with no price, an empty screenshot set, an expired build, or a product Apple had sent back. A clean report now means every rule it lists ran. Project files are checked only when you pass `project_path`, and the verdict says so when they were not.

**The report has a new format, on this tool only**

If you or your agent read `release_preflight` output, expect these changes. The verdict is one of `BLOCKED`, `NOT CONFIRMED` or `NO BLOCKING ISSUES FOUND`. Each finding shows what was seen, the rule with its source and date, and the tool that fixes it. Any check that could not run prints `UNKNOWN` with the reason and withholds the clean verdict. "Ready to submit" is gone, since no tool can promise App Review's decision. `FAIL` and the manual steps section remain. A call with only `app_id` works as before.

**What it checks now**

- The support, marketing, privacy policy and terms links are loaded from your machine, following redirects, so a dead link fails. A site that blocks robots reads `UNKNOWN`, not `FAIL`.
- A privacy policy URL is required in the primary language on every app, per Guideline 5.1.1(i).
- Rejected versions are audited, every locale's screenshots are read, and apps with several platforms get a section each. Pass `platform` to audit one.
- Screenshots are judged by platform. A 13-inch iPad set is required if the build runs on iPad, and one large iPhone set is enough.
- New checks: real price rows, export compliance, content rights, copyright, build expiry, placeholder text, name and subtitle length, and the April 2027 iPhone Duo rule for builds on the iOS 27.1 SDK or later.
- A custom licence agreement now satisfies the subscription terms rule. The tool no longer claims Apple "auto-rejects".

**New, optional: `project_path`**

Point it at your Xcode project to check privacy manifests and reason codes (ITMS-91053), SDKs on Apple's list (ITMS-91061), purpose strings and sample ids. It reads locally, writes nothing, runs nothing from the project, and prints paths, line numbers and setting names, not file contents. A path it cannot read, or a build it cannot read, reads `UNKNOWN`. It also lists your declared data types to check against the App Privacy page, which Apple's API still cannot read.

**What else changed for subscribers**

Every other tool's replies are unchanged. A few descriptions and guide lines were corrected: the server instructions mention `project_path`, the slash-command prompts now treat `UNKNOWN` as not checked, and the screenshot guidance names `APP_IPAD_PRO_3GEN_129`. No licensing, price or account change.
