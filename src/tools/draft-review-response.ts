/**
 * draft_review_response tool (Pro). Drafts a public reply to a single
 * App Store review via Sampling, in the review's locale. Never posts.
 *
 * Pipeline:
 *   1. Fetch the target review
 *   2. If `tone` not provided and client supports Elicitation, ask for it
 *   3. Sampling request to draft the reply
 *   4. Post-filter draft for Apple guideline 1.2 violations (disputes,
 *      promo-only content, personal info)
 *   5. Return draft with a warning. Never call Apple's POST endpoint.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { sample, MODEL_HINTS } from "../sampling.js";
import { elicit, clientSupportsElicitation } from "../elicitation.js";
import { requirePro } from "../gate.js";

interface ReviewAttributes {
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  createdDate: string;
  territory: string;
}

type Tone = "apologetic" | "factual" | "promotional" | "curious";
const TONES: Tone[] = ["apologetic", "factual", "promotional", "curious"];

export interface DraftArgs {
  app_id: string;
  review_id: string;
  tone?: Tone;
  include_support_link?: boolean;
  context_note?: string;
}

export interface DraftResult {
  app_id: string;
  review_id: string;
  locale: string;
  tone_used: Tone | "default_factual";
  draft: string;
  warning: string;
  degraded: boolean;
  note?: string;
}

const APPLE_GUIDELINE_DISCLAIMER =
  "This is a draft, not a posted response. Always review before posting via App Store Connect. We never post on your behalf.";

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /refund\s+(your|you)|contact\s+apple/i, reason: "avoid directing users to Apple for refunds" },
  { re: /lawyer|legal action|sue|attorney/i, reason: "no legal threats" },
  { re: /\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/, reason: "remove phone numbers" },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, reason: "replace email with a generic support link" },
];

export async function draftReviewResponse(
  server: McpServer,
  client: ASCClient,
  args: DraftArgs,
  tier: Tier,
): Promise<DraftResult> {
  if (tier !== "pro") {
    return emptyResult(args, "default_factual", {
      note: requirePro(tier, "draft_review_response", "draft_review_response")!,
    });
  }

  let review: ReviewAttributes;
  try {
    const response = await client.get<ReviewAttributes>(
      `/v1/customerReviews/${args.review_id}`,
      { "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory" },
    );
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!data) {
      return emptyResult(args, "default_factual", {
        note: `Review ${args.review_id} not found.`,
      });
    }
    review = data.attributes;
  } catch (err) {
    return emptyResult(args, "default_factual", {
      note: `Could not fetch review: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const locale = localeFromTerritory(review.territory);

  let tone: Tone | "default_factual" = args.tone ?? "default_factual";
  let includeSupportLink = args.include_support_link ?? false;
  let contextNote = (args.context_note ?? "").slice(0, 500);

  if (!args.tone && clientSupportsElicitation(server)) {
    const elicitResult = await elicit(server, {
      message: `Drafting a response to a ${review.rating}-star review from ${review.territory}. Set the tone.`,
      schema: {
        type: "object",
        properties: {
          tone: {
            type: "string",
            enum: TONES,
            description: "Response tone.",
          },
          include_support_link: {
            type: "boolean",
            description: "Mention that users can reach support with questions.",
          },
          context_note: {
            type: "string",
            description: "Optional context to weave in (release notes, known-fix mention).",
            maxLength: 500,
          },
        },
        required: ["tone"],
      },
    });
    if (elicitResult.ok) {
      const v = elicitResult.values;
      if (typeof v.tone === "string" && (TONES as string[]).includes(v.tone)) {
        tone = v.tone as Tone;
      }
      if (typeof v.include_support_link === "boolean") {
        includeSupportLink = v.include_support_link;
      }
      if (typeof v.context_note === "string") {
        contextNote = v.context_note.slice(0, 500);
      }
    }
    // declined/cancelled/unsupported all fall through to defaults
  }

  const toneDirective = toneToDirective(tone);
  const supportClause = includeSupportLink
    ? "Remind the user they can reach us for further help. Do not include a specific email or phone."
    : "";
  const contextClause = contextNote ? `Customer context to respect: ${contextNote}` : "";

  const systemPrompt = [
    "You are drafting a public App Store developer response to a customer review.",
    "Rules:",
    `  - Write in the language matching locale ${locale} (ISO code). For en, write English.`,
    "  - Apple guideline 1.2 applies: stay factual, courteous, avoid disputing the customer.",
    "  - Keep under 500 characters (Apple's practical limit for readability).",
    "  - Never include: email addresses, phone numbers, legal threats, refund promises, competitor names, AI disclosures.",
    "  - Do not quote the reviewer back at length.",
    "  - One paragraph maximum. No headers, no markdown, no emoji unless locale-appropriate.",
    toneDirective,
    supportClause,
    contextClause,
    "Reply with the draft text only, no preamble, no quotes around it.",
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = [
    `Review (${review.rating}/5):`,
    `Title: ${review.title || "(none)"}`,
    `Body: ${review.body || "(none)"}`,
    `Reviewer: ${review.reviewerNickname || "Anonymous"}`,
    `Territory: ${review.territory}`,
  ].join("\n");

  const samplingResult = await sample(server, {
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 500,
    temperature: 0.4,
    modelPreferences: MODEL_HINTS.balanced,
  });

  if (!samplingResult.ok) {
    if ("unsupported" in samplingResult && samplingResult.unsupported) {
      return emptyResult(args, tone, {
        locale,
        note: "Your MCP client does not support Sampling. Drafting unavailable. Upgrade Claude Desktop or Claude Code, or draft by hand.",
      });
    }
    return emptyResult(args, tone, {
      locale,
      note: `Sampling failed: ${"error" in samplingResult ? samplingResult.error : "unknown"}`,
    });
  }

  const draft = cleanDraft(samplingResult.text);
  const filterViolation = filterForbidden(draft);
  if (filterViolation) {
    return {
      app_id: args.app_id,
      review_id: args.review_id,
      locale,
      tone_used: tone,
      draft: "",
      warning: `Draft rejected by post-filter: ${filterViolation}. Try a different tone, or edit manually.`,
      degraded: true,
    };
  }

  return {
    app_id: args.app_id,
    review_id: args.review_id,
    locale,
    tone_used: tone,
    draft,
    warning: APPLE_GUIDELINE_DISCLAIMER,
    degraded: false,
  };
}

function emptyResult(
  args: DraftArgs,
  tone: Tone | "default_factual",
  extras: { locale?: string; note?: string },
): DraftResult {
  return {
    app_id: args.app_id,
    review_id: args.review_id,
    locale: extras.locale ?? "en",
    tone_used: tone,
    draft: "",
    warning: APPLE_GUIDELINE_DISCLAIMER,
    degraded: true,
    note: extras.note,
  };
}

function localeFromTerritory(territory: string): string {
  const map: Record<string, string> = {
    US: "en", GB: "en", CA: "en", AU: "en", IE: "en", NZ: "en",
    DE: "de", AT: "de", CH: "de",
    FR: "fr", BE: "fr",
    ES: "es", MX: "es", AR: "es", CO: "es", CL: "es",
    IT: "it",
    NL: "nl",
    JP: "ja",
    KR: "ko",
    CN: "zh-Hans", HK: "zh-Hant", TW: "zh-Hant",
    BR: "pt-BR", PT: "pt",
    RU: "ru",
    PL: "pl",
    TR: "tr",
    SE: "sv",
    NO: "nb",
    DK: "da",
    FI: "fi",
  };
  return map[territory] ?? "en";
}

function toneToDirective(tone: Tone | "default_factual"): string {
  switch (tone) {
    case "apologetic":
      return "Tone: warmly apologetic. Acknowledge the issue, avoid excuses.";
    case "promotional":
      return "Tone: brief, forward-looking. Mention an upcoming improvement only if it is real and concrete.";
    case "curious":
      return "Tone: curious and inviting. Ask one clarifying question in case they want to share more detail.";
    case "factual":
    case "default_factual":
    default:
      return "Tone: neutral and factual. Acknowledge, then state what you intend to do next.";
  }
}

function cleanDraft(text: string): string {
  return text
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\s*(draft|reply|response)\s*[:\-]\s*/i, "")
    .slice(0, 1200);
}

function filterForbidden(draft: string): string | null {
  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(draft)) return reason;
  }
  return null;
}

export function formatDraftForAgent(res: DraftResult): string {
  if (!res.draft) {
    return res.note ?? "No draft produced.";
  }
  const lines = [
    `# Draft response (locale ${res.locale}, tone ${res.tone_used})`,
    "",
    res.draft,
    "",
    `_${res.warning}_`,
  ];
  return lines.join("\n");
}
