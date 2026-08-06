import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface ITunesApp {
  trackName: string;
  trackId: number;
  bundleId: string;
  averageUserRating: number;
  userRatingCount: number;
  version: string;
  currentVersionReleaseDate: string;
  formattedPrice: string;
  price: number;
  primaryGenreName: string;
  fileSizeBytes: string;
  sellerName: string;
  trackContentRating: string;
  description: string;
  releaseNotes?: string;
}

export const competitorSnapshotDefinition = {
  name: "competitor_snapshot",
  description:
    "Get a competitive snapshot of any app on the App Store. Shows ratings, reviews count, version history, pricing, and category. Use to compare your app against competitors. Accepts app name (search) or numeric App Store ID (lookup).",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          'App name to search for (e.g. "Medisafe") or numeric App Store ID (e.g. "573916946").',
      },
      country: {
        type: "string",
        description: "Two-letter country code for regional data (default: us).",
      },
    },
    required: ["query"],
  },
};

async function lookupById(
  id: string,
  country: string,
): Promise<ITunesApp | null> {
  const url = `https://itunes.apple.com/lookup?id=${id}&country=${country}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { resultCount: number; results: ITunesApp[] };
  return data.results[0] || null;
}

async function searchByName(
  term: string,
  country: string,
): Promise<ITunesApp[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "software");
  url.searchParams.set("country", country);
  url.searchParams.set("limit", "5");

  const resp = await fetch(url.toString());
  if (!resp.ok) return [];
  const data = (await resp.json()) as { resultCount: number; results: ITunesApp[] };
  return data.results;
}

function formatSize(bytes: string): string {
  const b = parseInt(bytes, 10);
  if (isNaN(b)) return "?";
  if (b > 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)} GB`;
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(0)} MB`;
  return `${(b / 1_000).toFixed(0)} KB`;
}

function formatApp(app: ITunesApp): string {
  let out = `### ${app.trackName}\n\n`;
  out += `| Field | Value |\n`;
  out += `|-------|-------|\n`;
  out += `| **App Store ID** | ${app.trackId} |\n`;
  out += `| **Bundle ID** | ${app.bundleId} |\n`;
  out += `| **Seller** | ${app.sellerName} |\n`;
  out += `| **Category** | ${app.primaryGenreName} |\n`;
  out += `| **Price** | ${app.formattedPrice} |\n`;
  out += `| **Rating** | ${app.averageUserRating?.toFixed(1) || "?"} stars (${(app.userRatingCount || 0).toLocaleString()} ratings) |\n`;
  out += `| **Version** | ${app.version} |\n`;
  out += `| **Last Updated** | ${(app.currentVersionReleaseDate || "").split("T")[0]} |\n`;
  out += `| **Size** | ${formatSize(app.fileSizeBytes)} |\n`;
  out += `| **Content Rating** | ${app.trackContentRating} |\n`;

  if (app.releaseNotes) {
    out += `\n**Latest Release Notes:**\n`;
    // Truncate long release notes
    const notes = app.releaseNotes.length > 500
      ? app.releaseNotes.slice(0, 500) + "..."
      : app.releaseNotes;
    out += `> ${notes.replace(/\n/g, "\n> ")}\n`;
  }

  return out;
}

export async function competitorSnapshot(
  args: { query: string; country?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Competitor snapshot", "competitor_snapshot");
  if (gate) return gate;

  const country = args.country || "us";
  const query = args.query.trim();

  // Check if query is a numeric ID
  const isId = /^\d+$/.test(query);

  let result = `## Competitor Snapshot\n\n`;

  if (isId) {
    const app = await lookupById(query, country);
    if (!app) {
      return `No app found with ID ${query} in the ${country.toUpperCase()} store.`;
    }
    result += formatApp(app);
  } else {
    const apps = await searchByName(query, country);
    if (apps.length === 0) {
      return `No apps found matching "${query}" in the ${country.toUpperCase()} store.`;
    }

    result += `Found ${apps.length} app(s) matching "${query}" (${country.toUpperCase()} store):\n\n`;

    for (const app of apps) {
      result += formatApp(app);
      result += "\n";
    }

    // Comparison summary if multiple results
    if (apps.length > 1) {
      result += `### Quick Comparison\n\n`;
      result += `| App | Rating | Reviews | Price | Last Update |\n`;
      result += `|-----|--------|---------|-------|-------------|\n`;
      for (const app of apps) {
        result += `| ${app.trackName.slice(0, 30)} | ${app.averageUserRating?.toFixed(1) || "?"} | ${(app.userRatingCount || 0).toLocaleString()} | ${app.formattedPrice} | ${(app.currentVersionReleaseDate || "").split("T")[0]} |\n`;
      }
    }
  }

  result += `\n*Data from iTunes Search API (${country.toUpperCase()} store). Ratings and reviews are all-time totals.*\n`;

  return result;
}
