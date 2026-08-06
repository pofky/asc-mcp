import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface LocalizationAttributes {
  locale: string;
  keywords: string | null;
  description: string | null;
}

interface SearchResult {
  trackName: string;
  trackId: number;
  averageUserRating: number;
  userRatingCount: number;
  formattedPrice: string;
  primaryGenreName: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: SearchResult[];
}

export const keywordInsightsDefinition = {
  name: "keyword_insights",
  description:
    "Analyze your app's App Store keywords against search competition. Shows which keywords have high competition, suggests gaps, and compares your keyword budget usage. Uses the public iTunes Search API for competition data.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description: "Your App Store Connect app ID. Use list_apps to find it.",
      },
      extra_keywords: {
        type: "string",
        description:
          "Optional comma-separated keywords to analyze beyond what's in your current metadata (e.g. 'habit tracker,daily planner').",
      },
    },
    required: ["app_id"],
  },
};

async function searchItunes(
  term: string,
  country: string = "us",
  limit: number = 10,
): Promise<ITunesSearchResponse> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "software");
  url.searchParams.set("country", country);
  url.searchParams.set("limit", String(limit));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`iTunes Search API error: ${resp.status}`);
  }
  return (await resp.json()) as ITunesSearchResponse;
}

export async function keywordInsights(
  client: ASCClient,
  args: { app_id: string; extra_keywords?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Keyword insights", "keyword_insights");
  if (gate) return gate;

  // 1. Get current keywords from ASC
  const versionsResp = await client.get<{ versionString: string; appStoreState: string }>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    {
      "fields[appStoreVersions]": "versionString,appStoreState",
      limit: "3",
    },
  );

  const versions = Array.isArray(versionsResp.data)
    ? versionsResp.data
    : [versionsResp.data];

  if (versions.length === 0) {
    return "No versions found for this app.";
  }

  const versionId = versions[0].id;

  let currentKeywords = "";
  try {
    const locResp = await client.get<LocalizationAttributes>(
      `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
      {
        "fields[appStoreVersionLocalizations]": "locale,keywords,description",
        limit: "5",
      },
    );
    const locs = Array.isArray(locResp.data) ? locResp.data : [locResp.data];
    // Use first locale with keywords
    for (const loc of locs) {
      if (loc.attributes.keywords) {
        currentKeywords = loc.attributes.keywords;
        break;
      }
    }
  } catch {
    // Continue without current keywords
  }

  // 2. Parse keywords to analyze
  const keywordsToAnalyze: string[] = [];
  if (currentKeywords) {
    keywordsToAnalyze.push(
      ...currentKeywords.split(",").map((k) => k.trim()).filter(Boolean),
    );
  }
  if (args.extra_keywords) {
    keywordsToAnalyze.push(
      ...args.extra_keywords.split(",").map((k) => k.trim()).filter(Boolean),
    );
  }

  if (keywordsToAnalyze.length === 0) {
    return (
      "No keywords found in your app metadata and no extra_keywords provided.\n" +
      "Pass extra_keywords to analyze specific terms (e.g. 'habit tracker,daily planner')."
    );
  }

  // 3. Analyze each keyword against iTunes Search
  let result = `## Keyword Insights for App ${args.app_id}\n\n`;

  if (currentKeywords) {
    result += `**Current keywords** (${currentKeywords.length}/100 chars):\n`;
    result += `\`${currentKeywords}\`\n\n`;
    const remaining = 100 - currentKeywords.length;
    if (remaining > 10) {
      result += `You have **${remaining} characters** of keyword budget unused. Consider adding more keywords.\n\n`;
    } else if (remaining < 0) {
      result += `**WARNING**: Keywords exceed the 100-character limit by ${-remaining} chars. Apple will truncate.\n\n`;
    }
  }

  result += `### Competition Analysis\n\n`;
  result += `| Keyword | Top App | Top Rating | Top Reviews | Competing Apps | Difficulty |\n`;
  result += `|---------|---------|-----------|-------------|---------------|------------|\n`;

  // Rate limit: max 20 searches per call to be respectful
  const limited = keywordsToAnalyze.slice(0, 20);

  for (const keyword of limited) {
    try {
      const searchResp = await searchItunes(keyword, "us", 10);
      const count = searchResp.resultCount;
      const top = searchResp.results[0];

      let difficulty = "LOW";
      if (top) {
        if (top.userRatingCount > 50000) difficulty = "VERY HIGH";
        else if (top.userRatingCount > 10000) difficulty = "HIGH";
        else if (top.userRatingCount > 1000) difficulty = "MEDIUM";
      }

      if (top) {
        result += `| ${keyword} | ${top.trackName.slice(0, 25)} | ${top.averageUserRating?.toFixed(1) || "?"} | ${top.userRatingCount || 0} | ${count}+ | ${difficulty} |\n`;
      } else {
        result += `| ${keyword} | (none) | - | - | 0 | LOW |\n`;
      }

      // Small delay to be respectful to the API
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      result += `| ${keyword} | (error) | - | - | ? | ? |\n`;
    }
  }

  // 4. Summary and recommendations
  result += `\n### Recommendations\n\n`;
  result += `- Keywords with VERY HIGH difficulty (top app has 50K+ ratings) are hard to rank for as a new app\n`;
  result += `- Look for MEDIUM or LOW difficulty keywords where top apps have fewer than 10K ratings\n`;
  result += `- Long-tail keywords (3+ words) typically have lower competition\n`;
  result += `- Use all 100 characters of keyword budget. Separate with commas, no spaces after commas\n`;
  result += `- Apple indexes your app name + subtitle + keywords. Don't repeat words across them\n`;

  if (limited.length < keywordsToAnalyze.length) {
    result += `\n*Analyzed ${limited.length} of ${keywordsToAnalyze.length} keywords (capped to respect API rate limits).*\n`;
  }

  return result;
}
