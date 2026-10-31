import type { ToolName } from "../tool-meta.js";

/**
 * The preflight rule table: one row per rule, each with where it comes from and
 * when that source was last read. Bump `verified` only for a page actually
 * re-read, and move RULESET_DATE with it. The report prints this date, so a
 * stale table is visible to the person relying on it.
 */
export const RULESET_DATE = "2026-10-31";

/** A judgement, not an Apple number: Apple changes these pages several times a year. */
export const RULESET_STALE_AFTER_DAYS = 90;

export const SOURCES = {
  guidelines: {
    label: "App Review Guidelines",
    url: "https://developer.apple.com/app-store/review/guidelines/",
    verified: "2026-10-31",
  },
  screenshots: {
    label: "Screenshot specifications",
    url: "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications",
    verified: "2026-10-31",
  },
  requiredReason: {
    label: "Required reason API",
    url: "https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api",
    verified: "2026-10-31",
  },
  sdkList: {
    label: "Third-party SDK requirements",
    url: "https://developer.apple.com/support/third-party-SDK-requirements/",
    verified: "2026-10-31",
  },
  protectedResources: {
    label: "Protected resources",
    url: "https://developer.apple.com/documentation/bundleresources/protected-resources",
    verified: "2026-10-31",
  },
  metadataRef: {
    label: "App information reference",
    url: "https://developer.apple.com/help/app-store-connect/reference/app-information/",
    verified: "2026-10-31",
  },
} as const;

type SourceKey = keyof typeof SOURCES;

export interface Rule {
  family: string;
  source: SourceKey;
  /** The clause within the source, as a reader would look it up. */
  clause: string;
  fixTool?: ToolName;
  /** Argument or next step, printed after the tool name. */
  fixHint?: string;
}

/**
 * Lengths from Apple's app information reference. The minimum on a description
 * is this tool's own floor for "obviously not a real description", not Apple's.
 */
export const LIMITS = {
  descriptionMin: 10,
  descriptionMax: 4000,
  keywordsMax: 100,
  whatsNewMax: 4000,
  promotionalTextMax: 170,
  nameMax: 30,
  subtitleMax: 30,
} as const;

export const RULES = {
  "version.rejected": { family: "Version", source: "guidelines", clause: "the reasons in Apple's rejection notice" },
  "locale.present": { family: "Metadata", source: "metadataRef", clause: "at least one localization", fixTool: "update_version_metadata" },
  "meta.description": { family: "Metadata", source: "metadataRef", clause: "description, required, 4000 characters", fixTool: "update_version_metadata", fixHint: "description" },
  "meta.keywords": { family: "Metadata", source: "metadataRef", clause: "keywords, 100 characters", fixTool: "update_version_metadata", fixHint: "keywords" },
  "meta.promo": { family: "Metadata", source: "metadataRef", clause: "promotional text, 170 characters", fixTool: "update_version_metadata", fixHint: "promotional_text" },
  "meta.whatsnew": { family: "Metadata", source: "metadataRef", clause: "what's new, required on updates", fixTool: "update_version_metadata", fixHint: "whats_new" },
  "meta.name": { family: "Metadata", source: "metadataRef", clause: "name, required, 30 characters", fixTool: "update_version_metadata", fixHint: "name" },
  "meta.subtitle": { family: "Metadata", source: "metadataRef", clause: "subtitle, 30 characters", fixTool: "update_version_metadata", fixHint: "subtitle" },
  "meta.placeholder": { family: "Metadata", source: "guidelines", clause: "Guideline 2.1(a), placeholder text", fixTool: "update_version_metadata" },

  "shots.required": { family: "Screenshots", source: "screenshots", clause: "required device sizes", fixTool: "upload_screenshots" },
  "shots.nonempty": { family: "Screenshots", source: "screenshots", clause: "at least one screenshot per set", fixTool: "upload_screenshots" },
  "shots.duo": { family: "Screenshots", source: "screenshots", clause: "iPhone Duo, from April 2027, for apps on the iOS 27.1 SDK or later", fixTool: "upload_screenshots" },

  "build.attached": { family: "Build", source: "guidelines", clause: "Guideline 2.1(a), final versions", fixTool: "attach_build" },
  "build.encryption": { family: "Build", source: "metadataRef", clause: "export compliance", fixTool: "set_app_metadata", fixHint: "uses_non_exempt_encryption" },

  "app.age": { family: "App record", source: "metadataRef", clause: "age rating", fixTool: "set_age_rating" },
  "app.category": { family: "App record", source: "metadataRef", clause: "primary category", fixTool: "set_app_metadata", fixHint: "primary_category" },
  "app.price": { family: "App record", source: "metadataRef", clause: "price schedule", fixTool: "set_app_price", fixHint: "price_usd (0 for free)" },
  "app.content_rights": { family: "App record", source: "metadataRef", clause: "content rights", fixTool: "set_app_metadata", fixHint: "content_rights" },
  "app.copyright": { family: "App record", source: "metadataRef", clause: "copyright", fixTool: "set_app_metadata", fixHint: "copyright" },

  "review.contact": { family: "App Review details", source: "metadataRef", clause: "App Review contact", fixTool: "set_review_contact" },
  "review.demo": { family: "App Review details", source: "guidelines", clause: "Guideline 2.1(a), demo account", fixTool: "set_review_contact", fixHint: "demo_account_name, demo_account_password" },

  "iap.state": { family: "Products", source: "guidelines", clause: "Guideline 2.1(b), in-app purchase items" },
  "sub.terms": { family: "Products", source: "guidelines", clause: "Guideline 3.1.2(c), which defers to Schedule 2 of the licence agreement", fixTool: "update_version_metadata", fixHint: "description, add a Terms of Use link (or set a custom licence agreement on the website)" },

  "url.support.set": { family: "Links", source: "metadataRef", clause: "support URL, required", fixTool: "update_version_metadata", fixHint: "support_url" },
  "url.support.live": { family: "Links", source: "guidelines", clause: "Guideline 2.1(a), fully functional URLs", fixTool: "update_version_metadata", fixHint: "support_url" },
  "url.marketing.live": { family: "Links", source: "guidelines", clause: "Guideline 2.1(a), fully functional URLs", fixTool: "update_version_metadata", fixHint: "marketing_url" },
  "url.privacy.set": { family: "Links", source: "guidelines", clause: "Guideline 5.1.1(i), privacy policy link", fixTool: "update_version_metadata", fixHint: "privacy_policy_url" },
  "url.privacy.live": { family: "Links", source: "guidelines", clause: "Guideline 2.1(a) and 5.1.1(i)", fixTool: "update_version_metadata", fixHint: "privacy_policy_url" },
  "url.privacy.content": { family: "Links", source: "guidelines", clause: "Guideline 2.1(a), empty websites", fixTool: "update_version_metadata", fixHint: "privacy_policy_url" },
  "url.terms.live": { family: "Links", source: "guidelines", clause: "Guideline 2.1(a), fully functional URLs", fixTool: "update_version_metadata", fixHint: "description" },

  "manifest.present": { family: "Project", source: "requiredReason", clause: "privacy manifest" },
  "manifest.reasons": { family: "Project", source: "requiredReason", clause: "declared reasons (ITMS-91053)" },
  "sdk.manifest": { family: "Project", source: "sdkList", clause: "listed SDKs (ITMS-91061), for new apps and newly added SDKs" },
  "plist.purpose": { family: "Project", source: "protectedResources", clause: "purpose strings" },
  "plist.placeholder": { family: "Project", source: "guidelines", clause: "Guideline 2.1(a), temporary content" },
} as const satisfies Record<string, Rule>;

export type RuleId = keyof typeof RULES;

export const ruleOf = (id: string): Rule | undefined => (RULES as Record<string, Rule>)[id];

/**
 * Display types a version needs, by platform. Read from Apple's screenshot page
 * and from the display types Apple's API enumerates.
 *
 * iPhone is a set of acceptable types, not one type. Apple's summary names
 * "Dynamic Island (medium)", while its table scales that from the large sets. On
 * 2026-10-31, five real apps with only APP_IPHONE_67 had been accepted into
 * review, so a large set alone is enough; a rule demanding one exact size would
 * fail apps Apple takes.
 */
export const IPHONE_ACCEPTED_SETS = ["APP_IPHONE_67", "APP_IPHONE_65", "APP_IPHONE_61"] as const;
export const IPAD_REQUIRED_SET = "APP_IPAD_PRO_3GEN_129";
export const PLATFORM_REQUIRED_SET: Record<string, string> = {
  MAC_OS: "APP_DESKTOP",
  TV_OS: "APP_APPLE_TV",
  VISION_OS: "APP_APPLE_VISION_PRO",
};

/**
 * Apple: "Starting in April 2027, screenshots will be required for any app using
 * the iOS 27.1 SDK or later." The day is not stated, so the first of the month.
 */
export const DUO_REQUIRED_FROM = "2027-04-01";

/**
 * Apple's SDK build numbers read major + letter, so 23B77 is iOS 26.1 and 24B is
 * iOS 27.1. Inferred from Apple's published Xcode build numbers, not documented
 * as a contract: an unparsable value is treated as "not known".
 */
export const DUO_SDK_FROM = { major: 24, letter: "B" } as const;

/** Text that should never reach App Review. Case-sensitive words, to spare to-do apps. */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /lorem ipsum/i,
  /\b(TODO|TBD|FIXME|XXXX+)\b/,
  /\[(your|insert|app name)[^\]]*\]/i,
  /\binsert [a-z ]{1,30} here\b/i,
];

/** Hosts reserved for documentation by RFC 2606, or that only exist on the machine. */
export const PLACEHOLDER_HOSTS: ReadonlySet<string> = new Set([
  "example.com",
  "www.example.com",
  "example.org",
  "www.example.org",
  "example.net",
  "www.example.net",
  "localhost",
]);

/** Common wordings on a Terms of Use link; a judgement. Any custom EULA also counts. */
export const TERMS_LINK_PATTERN = /(terms|eula|stdeula|\btos\b|legal)/i;

/**
 * Below this much visible text with no scripts, a page reads as empty. A
 * judgement, used only for a warning, never for a legal view of the page.
 */
export const THIN_PAGE_TEXT_CHARS = 200;

export const PARKED_PAGE_MARKERS: readonly RegExp[] = [
  /this domain is (for sale|parked)/i,
  /buy this domain/i,
  /domain (is )?parked/i,
  /sedoparking|parkingcrew|bodis\.com/i,
];
