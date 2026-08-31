import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface ReviewAttributes {
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  createdDate: string;
  territory: string;
}

export const listReviewsDefinition = {
  name: "list_reviews",
  description:
    "List customer reviews for an app. Filter by rating (1-5 stars). Pro feature - requires license key.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description: "The App Store Connect app ID.",
      },
      rating: {
        type: "number",
        description: "Filter by star rating (1-5). Omit for all ratings.",
      },
      limit: {
        type: "number",
        description: "Maximum reviews to return (default 20, max 100).",
      },
      sort: {
        type: "string",
        enum: ["newest", "oldest", "rating_high", "rating_low"],
        description: "Sort order (default: newest).",
      },
    },
    required: ["app_id"],
  },
};

export async function listReviews(
  client: ASCClient,
  args: { app_id: string; rating?: number; limit?: number; sort?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Customer reviews", "list_reviews");
  if (gate) return gate;

  const limit = Math.min(args.limit ?? 20, 100);
  const params: Record<string, string> = {
    "fields[customerReviews]":
      "rating,title,body,reviewerNickname,createdDate,territory",
    limit: String(limit),
  };

  // Sort mapping
  const sortMap: Record<string, string> = {
    newest: "-createdDate",
    oldest: "createdDate",
    rating_high: "-rating",
    rating_low: "rating",
  };
  params.sort = sortMap[args.sort ?? "newest"] || "-createdDate";

  if (args.rating && args.rating >= 1 && args.rating <= 5) {
    params["filter[rating]"] = String(args.rating);
  }

  const response = await client.get<ReviewAttributes>(
    `/v1/apps/${args.app_id}/customerReviews`,
    params,
  );

  const reviews = Array.isArray(response.data)
    ? response.data
    : [response.data];

  return formatReviews(reviews, response.meta?.paging?.total);
}

/**
 * Render a page of reviews. Split out from the fetch so the shape the agent
 * actually reads can be tested without a live App Store Connect account.
 */
export function formatReviews(
  reviews: { id: string; attributes: ReviewAttributes }[],
  total?: number,
): string {
  if (reviews.length === 0) {
    return "No customer reviews found matching your criteria.";
  }

  const stars = (n: number) => "\u2605".repeat(n) + "\u2606".repeat(5 - n);

  let result = `## Customer Reviews (${reviews.length} shown)\n\n`;

  for (const review of reviews) {
    const r = review.attributes;
    result += `### ${stars(r.rating)} ${r.title || "(No title)"}\n`;
    result += `**By** ${r.reviewerNickname || "Anonymous"} - ${r.territory} - ${r.createdDate.split("T")[0]}\n`;
    // The id is the whole point of listing a review you intend to answer.
    // `draft_review_response` takes `review_id` and its schema says "from
    // list_reviews", but this formatter never printed one, so the documented
    // reviews flow, read a review then reply to it, dead-ended here: the agent
    // had a review it could see and no way to name it. Apple's ids are opaque
    // UUIDs, so there is nothing to derive it from either.
    result += `**Review ID**: \`${review.id}\` (pass to draft_review_response)\n\n`;
    result += `${r.body || "(No body)"}\n\n---\n\n`;
  }

  if (total && total > reviews.length) {
    result += `\n*Showing ${reviews.length} of ${total} total reviews.*\n`;
  }

  return result;
}
