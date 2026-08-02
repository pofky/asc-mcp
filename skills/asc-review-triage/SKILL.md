---
name: asc-review-triage
description: Use this skill whenever the user asks about App Store reviews, ratings, customer feedback, low-star reviews, reviewer sentiment, or what users are saying about an iOS or macOS app. Queries the asc-mcp server to pull and analyze reviews. Trigger on phrases like "any bad reviews", "what do my users say", "reviews this week", "1-star", "2-star", "3-star", "customer feedback", "ratings trend", "reviewer sentiment".
---

# App Store review triage

When the user asks about reviews, ratings, or customer feedback for their App Store apps, follow this procedure using the `asc-mcp` tools.

## Step 1. Identify the app

If the user specified an app name or ID, use it. Otherwise:

1. Call `list_apps` to get the full list.
2. If there is only one app, use it.
3. If there are several, ask the user which app they mean. Do not guess.

## Step 2. Pull reviews

Call `list_reviews` with:

- `app_id`: the app ID from step 1
- `rating`: 3 (covers 1, 2, and 3 star reviews when sorted correctly)
- `sort`: `newest`
- `limit`: 20 for a quick scan, up to 100 for a deep dive

If the user specifically asked about 1-star reviews only, set `rating: 1`. If they asked about all reviews (positive and negative), call `list_reviews` without a rating filter.

## Step 3. Confirm review status

Call `review_status` with the same `app_id`. This tells the user whether a new version is in review or waiting, which often correlates with review-score dips.

## Step 4. Summarize

Produce a concise summary with:

- Total reviews in the window
- Breakdown by rating (1, 2, 3, 4, 5)
- 3 to 5 themes, each with a review-count and one representative quote
- Any single review flagged as potentially actionable (specific bug report, feature request, competitor mention)
- The current review-queue status from step 3

## Guardrails

- Do not invent reviews. Quote only what `list_reviews` returned.
- Do not post a reply. This skill reads only. Drafting or posting responses is a separate Pro feature not in this skill.
- If `list_reviews` returns nothing, say so plainly.
- If the user does not have a Pro license (free tier), `list_reviews` will error. Explain the free-tier limit and link to https://buy.polar.sh/polar_cl_y86PS4ruc848PXevVvSYS49S8gZY8JYWF192v1UEgjj.

## Example usage

User: "Any bad reviews on my meditation app this week?"

Claude:
1. Calls `list_apps`, finds one app called "Meditation Timer".
2. Calls `list_reviews` with that app ID, rating 3, newest first, limit 20.
3. Calls `review_status`.
4. Returns: "7 reviews in the last 7 days, average 2.3 stars. 3 themes: crashes on iOS 18.2 (4 reviews), missing dark mode (2 reviews), confusion over premium tier (1 review). The version 2.4.1 submission is currently In Review (submitted 2 days ago)."
