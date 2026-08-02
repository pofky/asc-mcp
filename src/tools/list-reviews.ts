import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { UPGRADE_URL } from "../gate.js";

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
  if (tier !== "pro") {
    return (
      "Customer reviews require a Pro license ($9/mo).\n" +
      "Get your license at: " + UPGRADE_URL + "\n\n" +
      "Set ASC_LICENSE_KEY in your MCP server config to unlock."
    );
  }

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

  if (reviews.length === 0) {
    return "No customer reviews found matching your criteria.";
  }

  const stars = (n: number) => "\u2605".repeat(n) + "\u2606".repeat(5 - n);

  let result = `## Customer Reviews (${reviews.length} shown)\n\n`;

  for (const review of reviews) {
    const r = review.attributes;
    result += `### ${stars(r.rating)} ${r.title || "(No title)"}\n`;
    result += `**By** ${r.reviewerNickname || "Anonymous"} - ${r.territory} - ${r.createdDate.split("T")[0]}\n\n`;
    result += `${r.body || "(No body)"}\n\n---\n\n`;
  }

  const total = response.meta?.paging?.total;
  if (total && total > reviews.length) {
    result += `\n*Showing ${reviews.length} of ${total} total reviews.*\n`;
  }

  return result;
}
