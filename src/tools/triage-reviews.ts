/**
 * triage_reviews tool (Pro). Uses MCP Sampling to cluster customer reviews
 * into themes on the user's own Claude (zero cost to us).
 *
 * Pipeline:
 *   1. Fetch up to `limit` reviews via the ASC API (reuses list_reviews logic)
 *   2. If none, return empty result, skip Sampling
 *   3. Ask the user's client to cluster via Sampling
 *   4. Parse JSON response from the model; degrade gracefully on parse error
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { sample, MODEL_HINTS } from "../sampling.js";
import { requirePro } from "../gate.js";

interface ReviewAttributes {
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  createdDate: string;
  territory: string;
}

interface Theme {
  theme: string;
  count: number;
  action_bucket: "bug" | "missing_feature" | "pricing" | "ux" | "content" | "other";
  quote: string;
}

export interface TriageResult {
  app_id: string;
  reviews_analyzed: number;
  themes: Theme[];
  note?: string;
  degraded: boolean;
}

const MAX_REVIEWS = 30;
const MIN_FOR_CLUSTERING = 3;

const SYSTEM_PROMPT = [
  "You are a product-review triage assistant.",
  "Given a list of App Store reviews, group them into 3 to 5 themes.",
  "Each theme gets:",
  "  - a short label (3 to 7 words)",
  "  - the exact count of reviews that fit it",
  "  - an action_bucket from: bug, missing_feature, pricing, ux, content, other",
  "  - a single representative verbatim quote (must be one of the reviews, unedited)",
  "",
  "Rules:",
  "  - Reply ONLY with a valid JSON object matching the schema below. No prose, no markdown.",
  "  - Never invent themes with zero reviews.",
  "  - Never invent quotes; they must appear in the input verbatim.",
  "  - If fewer than 3 reviews, still produce 1 to 2 themes.",
  "",
  'Schema: { "themes": [{ "theme": string, "count": number, "action_bucket": string, "quote": string }] }',
].join("\n");

export async function triageReviews(
  server: McpServer,
  client: ASCClient,
  args: { app_id: string; rating?: number; limit?: number; days?: number },
  tier: Tier,
): Promise<TriageResult> {
  if (tier !== "pro") {
    return {
      app_id: args.app_id,
      reviews_analyzed: 0,
      themes: [],
      degraded: true,
      note: requirePro(tier, "Review triage", "triage_reviews")!,
    };
  }

  const limit = Math.min(args.limit ?? 30, MAX_REVIEWS);
  const params: Record<string, string> = {
    "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory",
    limit: String(limit),
    sort: "-createdDate",
  };
  if (args.rating && args.rating >= 1 && args.rating <= 5) {
    params["filter[rating]"] = String(args.rating);
  }

  const response = await client.get<ReviewAttributes>(
    `/v1/apps/${args.app_id}/customerReviews`,
    params,
  );

  const reviews = Array.isArray(response.data) ? response.data : [response.data];
  const total = reviews.length;

  if (total === 0) {
    return {
      app_id: args.app_id,
      reviews_analyzed: 0,
      themes: [],
      degraded: false,
      note: "No reviews found for this app in the requested window.",
    };
  }

  if (total < MIN_FOR_CLUSTERING) {
    const themes: Theme[] = reviews.map((r) => {
      const a = r.attributes;
      return {
        theme: (a.title || a.body.slice(0, 40) || "Untitled").slice(0, 60),
        count: 1,
        action_bucket: "other",
        quote: (a.body || a.title || "").slice(0, 240),
      };
    });
    return {
      app_id: args.app_id,
      reviews_analyzed: total,
      themes,
      degraded: false,
      note: `Only ${total} review(s) found; returning pass-through summary without Sampling.`,
    };
  }

  const reviewText = reviews
    .map((r, i) => {
      const a = r.attributes;
      return `[${i + 1}] ${a.rating}/5 - ${a.territory} - "${a.title || ""}" :: ${a.body || ""}`;
    })
    .join("\n");

  const samplingResult = await sample(server, {
    system: SYSTEM_PROMPT,
    user: `Cluster these ${total} App Store reviews into 3 to 5 themes. Reply with JSON only.\n\n${reviewText}`,
    maxTokens: 1200,
    modelPreferences: MODEL_HINTS.fast,
  });

  if (!samplingResult.ok) {
    if ("unsupported" in samplingResult && samplingResult.unsupported) {
      return {
        app_id: args.app_id,
        reviews_analyzed: total,
        themes: [],
        degraded: true,
        note: "Your MCP client does not support Sampling. Raw review bodies returned; ask your agent to cluster manually.",
      };
    }
    return {
      app_id: args.app_id,
      reviews_analyzed: total,
      themes: [],
      degraded: true,
      note: `Sampling failed: ${"error" in samplingResult ? samplingResult.error : "unknown"}. Raw reviews returned.`,
    };
  }

  const parsed = safeParseThemes(samplingResult.text);
  if (!parsed) {
    return {
      app_id: args.app_id,
      reviews_analyzed: total,
      themes: [],
      degraded: true,
      note: `Sampling returned invalid JSON. Raw: ${samplingResult.text.slice(0, 200)}`,
    };
  }

  return {
    app_id: args.app_id,
    reviews_analyzed: total,
    themes: parsed,
    degraded: false,
  };
}

function safeParseThemes(text: string): Theme[] | null {
  let json = text.trim();
  const fenced = json.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) json = fenced[1].trim();
  try {
    const obj = JSON.parse(json) as { themes?: unknown };
    if (!obj.themes || !Array.isArray(obj.themes)) return null;
    const out: Theme[] = [];
    for (const t of obj.themes) {
      if (!t || typeof t !== "object") continue;
      const row = t as Record<string, unknown>;
      const theme = String(row.theme ?? "").slice(0, 120);
      const count = Number(row.count ?? 0);
      const actionBucket = String(row.action_bucket ?? "other");
      const quote = String(row.quote ?? "").slice(0, 500);
      if (!theme || count <= 0) continue;
      out.push({
        theme,
        count,
        action_bucket: validBucket(actionBucket),
        quote,
      });
    }
    return out.slice(0, 8);
  } catch {
    return null;
  }
}

function validBucket(s: string): Theme["action_bucket"] {
  const allowed: Theme["action_bucket"][] = [
    "bug",
    "missing_feature",
    "pricing",
    "ux",
    "content",
    "other",
  ];
  return (allowed as string[]).includes(s) ? (s as Theme["action_bucket"]) : "other";
}

export function formatTriageForAgent(res: TriageResult): string {
  if (res.themes.length === 0) {
    return res.note ?? "No reviews to triage.";
  }
  const lines: string[] = [
    `# Review triage: app ${res.app_id}`,
    `Reviews analyzed: ${res.reviews_analyzed}${res.degraded ? " (degraded)" : ""}`,
    "",
  ];
  for (const t of res.themes) {
    lines.push(`## ${t.theme}  (${t.count}, ${t.action_bucket})`);
    lines.push(`> ${t.quote}`);
    lines.push("");
  }
  if (res.note) {
    lines.push(`_${res.note}_`);
  }
  return lines.join("\n");
}
