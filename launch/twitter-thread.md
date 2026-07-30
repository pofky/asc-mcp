# X thread, v1.8.1

Refreshed 30 July 2026. One tweet every 45 seconds, not all at once.
Lowercase voice, no emoji, no hype words. Every number here is real.

## 1 (hook)

last month i shipped an ios app's 1.0 to the app store without opening app store connect.

my coding agent set the metadata, priced 3 iap products across 175 territories, attached the
build, uploaded screenshots, ran a preflight audit, and submitted. apple approved it.

## 2 (the honest part)

it is not fully automatable, and the interesting output was the list of walls:

- POST /v1/apps is 403 for api keys. you create the app record by hand, always.
- the privacy nutrition label is not in the public api
- EU trader status has no api attribute
- an app's FIRST in-app purchases can only be submitted with the version on the website

## 3 (the failure mode that matters)

that last one bites. a naive script submits the version, apple takes it without the
products, and now your version is in review missing its iaps.

so my submit tool detects pending first products and aborts instead. the abort is the
feature.

## 4 (what it does do)

40 tools, all job-shaped instead of one-per-endpoint:

- age rating in one call (fetch, merge the full declaration set, submit, because a partial
  patch silently drops declarations)
- subscription in one call: group, localization, availability, price in every territory,
  free trial
- preflight that lists every submission blocker with its fix

## 5 (guardrails)

submit_for_review, release_version and upload_binary all refuse to run without
confirm:true. an agent has to be told twice before anything reaches the public.

the review-reply tool writes a draft and never posts it.

## 6 (privacy)

your .p8 never leaves your machine. jwts are signed locally, calls go straight to
api.appstoreconnect.apple.com. the only other request checks a license key.

## 7 (call to action)

npx @pofky/asc-mcp init

5 tools free, no account, including asc_guide which prints the playbook for any flow with
the manual steps flagged. pro is $9/mo for the write and control plane.

https://asc-mcp.pages.dev
