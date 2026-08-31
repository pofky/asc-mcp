v1.9.6: `init` works when an agent runs it

Download **asc-mcp-1.9.6.mcpb** below and open it for a one-click install on Claude for macOS and Windows. Every other client: `npx @pofky/asc-mcp init --write --issuer <your-issuer-uuid>`.

**The install path was broken for exactly the people this server is for.**

The documented way in is a coding agent running `npx @pofky/asc-mcp init --write`. An agent has no terminal, so that ran with stdin piped, and the non-interactive branch printed one line of advice and exited. It wrote no config and printed no config block, even when it had just found your `.p8` and `ASC_ISSUER_ID` was already set, which is the case where everything it needed was known. The user was left with no server block and a failure that looked like the package.

`init` now finishes the job without a terminal. It takes `--issuer`, `--key-path`, `--key-id`, `--license` and `--config`, reads the matching `ASC_*` variables when a flag is absent, prints the paste-ready block, and with `--write` writes it into your client config, backing the original up first.

Two things it deliberately will not do: it never invents a value (a missing Issuer ID is reported, not guessed, because a config with a wrong one fails later at Apple's auth with a confusing error), and with several client configs on the machine it prints the block and asks which, rather than picking one for you.

**The server did not start at all on Node 18**

`jose` is ESM-only from v6 and this package is CommonJS, so `require("jose")` threw `ERR_REQUIRE_ESM` before the first line of our code ran. That is every Node 18, and every Node 20 before 20.19, while package.json, the README, the landing page and the .mcpb manifest all said Node 18 or newer. Anyone on those versions installed it, saw their client report a server that failed to start, and had nothing to go on.

The dependency is gone. ES256 JWTs are signed with Node's own `crypto`, which needs no package and no build step, and the raw r||s encoding Apple requires is now covered by a test that verifies the signature back. Confirmed live on 18.20.8: authentication, tool calls and the one-click bundle all work. A second test walks the dependency tree and fails if an ESM-only package is ever added again, because nothing in the build or the previous tests noticed this one.

**Three more things the flow audit found**

`list_reviews` never printed a review id, and `draft_review_response` takes one, its schema saying "from list_reviews". The documented reviews flow, read the bad reviews then reply to one, had no way across that gap: Apple's ids are opaque UUIDs with nothing to derive them from. Every listed review now carries its id.

`draft_review_response` on a client without Sampling used to answer "drafting unavailable, draft by hand", which wastes the one model already in the conversation. It now hands that model the review and the exact rules the draft must follow, so the agent writes it.

A mistyped command (`asc-mcp int`) fell through to the MCP server, which then waited on stdio for a JSON-RPC frame no human is going to type. From a terminal that is indistinguishable from a hang. It now says what it did not recognise and exits.

**Licence server: the renewal grace window actually works now**

The four-day grace exists so a late or dropped renewal webhook cannot demote someone who has paid. It could never be reached. The webhook path writes `active = 0` the moment the paid period end is in the past, and the validation check refused an inactive row before it ever looked at the grace window, so the customer it was written for, the one in card retry, was locked out anyway. Revocation stays terminal and is now identified by the revoke timestamp rather than by the active flag, cancellation still ends access when the paid period does, and a trial still gets no grace at all.

The key-recovery and trial endpoints now look at the same rule, so a customer mid-renewal is not told they have no licence. And `POST /key` with a JSON body returns 400 instead of 500.
