import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface AppAttributes {
  name: string;
  bundleId: string;
}

interface VersionAttributes {
  versionString: string;
  platform: string;
  appStoreState: string;
  createdDate: string;
}

interface ReviewAttributes {
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  territory: string;
  createdDate: string;
}

export const dailyBriefingDefinition = {
  name: "daily_briefing",
  description:
    "Get a morning briefing across all your apps: review status, recent customer reviews, and version states. One call for full situational awareness. Pro license adds review details.",
  inputSchema: {
    type: "object" as const,
    properties: {
      days: {
        type: "number",
        description:
          "Look back N days for reviews (default 3). Only affects review section.",
      },
    },
    required: [] as string[],
  },
};

export async function dailyBriefing(
  client: ASCClient,
  args: { days?: number },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Daily briefing", "daily_briefing");
  if (gate) return gate;

  const lookbackDays = args.days || 3;
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  let result = `## Daily Briefing - ${today}\n\n`;

  // 1. List all apps
  const appsResponse = await client.get<AppAttributes>("/v1/apps", {
    "fields[apps]": "name,bundleId",
    limit: "50",
  });

  const apps = Array.isArray(appsResponse.data)
    ? appsResponse.data
    : [appsResponse.data];

  if (apps.length === 0) {
    return result + "No apps found in your account.\n";
  }

  result += `**${apps.length} app${apps.length > 1 ? "s" : ""}** in your account\n\n`;

  // 2. For each app, get version status and recent reviews
  for (const app of apps) {
    const appName = app.attributes.name;
    const appId = app.id;

    result += `### ${appName}\n`;

    // Get latest versions
    try {
      const versionsResponse = await client.get<VersionAttributes>(
        `/v1/apps/${appId}/appStoreVersions`,
        {
          "fields[appStoreVersions]":
            "versionString,platform,appStoreState,createdDate",
          limit: "3",
        },
      );

      const versions = Array.isArray(versionsResponse.data)
        ? versionsResponse.data
        : [versionsResponse.data];

      if (versions.length > 0) {
        const latest = versions[0];
        const state = formatState(latest.attributes.appStoreState);
        result += `- **Latest**: v${latest.attributes.versionString} (${latest.attributes.platform}) - ${state}\n`;

        // Flag anything in review
        const reviewStates = [
          "WAITING_FOR_REVIEW",
          "IN_REVIEW",
          "PENDING_APPLE_RELEASE",
          "PENDING_DEVELOPER_RELEASE",
        ];
        const inReview = versions.filter((v) =>
          reviewStates.includes(v.attributes.appStoreState),
        );
        if (inReview.length > 0) {
          for (const v of inReview) {
            result += `- **Action needed**: v${v.attributes.versionString} is ${formatState(v.attributes.appStoreState)}\n`;
          }
        }

        // Flag rejections
        const rejected = versions.filter((v) =>
          ["REJECTED", "METADATA_REJECTED"].includes(
            v.attributes.appStoreState,
          ),
        );
        if (rejected.length > 0) {
          for (const v of rejected) {
            result += `- **REJECTED**: v${v.attributes.versionString} - check App Store Connect for details\n`;
          }
        }
      }
    } catch {
      result += `- Could not fetch version info\n`;
    }

    // Get recent reviews (Pro only, but show count for free)
    if (tier === "pro") {
      try {
        const reviewsResponse = await client.get<ReviewAttributes>(
          `/v1/apps/${appId}/customerReviews`,
          {
            "fields[customerReviews]":
              "rating,title,body,reviewerNickname,territory,createdDate",
            sort: "-createdDate",
            limit: "20",
          },
        );

        const allReviews = Array.isArray(reviewsResponse.data)
          ? reviewsResponse.data
          : [reviewsResponse.data];

        // Filter to recent
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - lookbackDays);
        const recentReviews = allReviews.filter(
          (r) => new Date(r.attributes.createdDate) >= cutoff,
        );

        if (recentReviews.length > 0) {
          const avgRating =
            recentReviews.reduce((sum, r) => sum + r.attributes.rating, 0) /
            recentReviews.length;
          const lowRatings = recentReviews.filter(
            (r) => r.attributes.rating <= 2,
          );

          result += `- **Reviews** (last ${lookbackDays}d): ${recentReviews.length} new, avg ${avgRating.toFixed(1)} stars\n`;

          if (lowRatings.length > 0) {
            result += `- **Attention**: ${lowRatings.length} review${lowRatings.length > 1 ? "s" : ""} with 1-2 stars:\n`;
            for (const r of lowRatings.slice(0, 3)) {
              const stars = "★".repeat(r.attributes.rating) + "☆".repeat(5 - r.attributes.rating);
              result += `  - ${stars} "${r.attributes.title}" (${r.attributes.territory})\n`;
            }
          }
        } else {
          result += `- No new reviews in the last ${lookbackDays} days\n`;
        }
      } catch {
        result += `- Could not fetch reviews\n`;
      }
    } else {
      result += `- Reviews: upgrade to Pro to see review details in briefings\n`;
    }

    result += "\n";
  }

  return result;
}

function formatState(state: string): string {
  const stateMap: Record<string, string> = {
    IN_REVIEW: "In Review",
    WAITING_FOR_REVIEW: "Waiting for Review",
    PENDING_APPLE_RELEASE: "Approved - Pending Release",
    PENDING_DEVELOPER_RELEASE: "Approved - Your Release",
    READY_FOR_SALE: "Live",
    REJECTED: "REJECTED",
    METADATA_REJECTED: "Metadata Rejected",
    PREPARE_FOR_SUBMISSION: "Preparing",
    READY_FOR_REVIEW: "Ready for Review",
  };
  return stateMap[state] || state;
}
