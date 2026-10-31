/** Every outcome a preflight rule can have. There is no silent outcome. */
export type Status = "pass" | "warn" | "fail" | "unknown" | "skipped";

export interface Finding {
  rule: string;
  status: Status;
  /** Where it applies: a locale, a product, a file. Omitted when app-wide. */
  scope?: string;
  /** What was actually seen. Never file contents or a fetched page body. */
  saw: string;
}

/** One fetched resource: either its value, or why it could not be read. */
export type Part<T> = { ok: true; value: T } | { ok: false; reason: string };

export const okPart = <T>(value: T): Part<T> => ({ ok: true, value });
export const failedPart = <T>(reason: string): Part<T> => ({ ok: false, reason });

export interface VersionLocalization {
  id: string;
  locale: string;
  description: string | null;
  keywords: string | null;
  whatsNew: string | null;
  promotionalText: string | null;
  marketingUrl: string | null;
  supportUrl: string | null;
}

export interface AppInfoLocalization {
  locale: string;
  name: string | null;
  subtitle: string | null;
  privacyPolicyUrl: string | null;
}

export interface ScreenshotSet {
  displayType: string;
  /** Apple's assetDeliveryState.state for each image in the set. */
  imageStates: string[];
}

export interface BuildInfo {
  version: string;
  processingState: string;
  expired: boolean;
  /** null means Apple has no answer on record yet. */
  usesNonExemptEncryption: boolean | null;
  /** The icon file name Apple extracted from the build; see `iPadEvidence`. */
  iconFile: string | null;
  /** Apple's SDK build number, such as 23B77. null when it could not be read. */
  sdkBuild: string | null;
}

export interface ReviewDetail {
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  demoAccountName: string | null;
  demoAccountRequired: boolean | null;
}

export interface VersionSnapshot {
  id: string;
  platform: string;
  versionString: string;
  state: string;
  /** True when no version is in progress on this platform and this is the live one. */
  auditingLive: boolean;
  /** Another version on this platform has reached the store. */
  hasPriorRelease: boolean;
  copyright: string | null;
  localizations: Part<VersionLocalization[]>;
  /** Keyed by locale. */
  screenshots: Part<Record<string, ScreenshotSet[]>>;
  build: Part<BuildInfo | null>;
  review: Part<ReviewDetail | null>;
}

export interface Product {
  productId: string;
  state: string;
  kind: "iap" | "subscription";
}

export interface RecordSnapshot {
  appId: string;
  app: Part<{ name: string; bundleId: string; primaryLocale: string | null; contentRights: string | null }>;
  appInfo: Part<{ ageDeclared: boolean; hasPrimaryCategory: boolean; localizations: AppInfoLocalization[] }>;
  hasManualPrice: Part<boolean>;
  iaps: Part<Product[]>;
  subscriptions: Part<Product[]>;
  hasCustomEula: Part<boolean>;
  versions: VersionSnapshot[];
}

/** What a probe of one URL established. Never carries the response body. */
export type ProbeOutcome =
  | { kind: "live"; status: number; thin: boolean; parked: boolean }
  | { kind: "dead"; detail: string }
  | { kind: "inconclusive"; detail: string };

export type ProbeResults = Record<string, ProbeOutcome>;

export interface ProjectManifest {
  path: string;
  parsed: Part<{
    /** Category name to its declared reason codes. */
    accessed: Record<string, string[]>;
    collectedDataTypes: string[];
  }>;
  /** false when the project file exists and does not mention it. */
  inProject: boolean | null;
}

export interface ApiUse {
  category: string;
  /** "strong" names an Apple API exactly; "weak" could be someone's own symbol. */
  strength: "strong" | "weak";
  where: string;
}

export interface PurposeUse {
  keys: readonly string[];
  api: string;
  where: string;
}

export interface SdkUse {
  name: string;
  via: string;
  /** Whether a manifest could be seen on disk for this SDK. */
  manifest: "present" | "absent" | "not_on_disk";
}

export interface ProjectScan {
  root: string;
  manifests: ProjectManifest[];
  apis: ApiUse[];
  purposes: PurposeUse[];
  /** Info.plist purpose keys found anywhere, with whether each has text. */
  purposeKeys: Record<string, boolean>;
  sdks: SdkUse[];
  placeholderKeys: Array<{ key: string; where: string }>;
  /** From the target whose bundle id matches the app, when one does. */
  runsOnIpad: boolean | null;
  signInSeenAt: string | null;
  builtApp: string | null;
  /** Nothing to read here: no built app, or not a Mac. Source rules still ran. */
  binarySkipped: string | null;
  /** A built app was found and could not be read, so a requested check did not run. */
  binaryUnreadable: string | null;
  /** Set when a scan limit was reached, so absence of a finding proves nothing. */
  truncated: string | null;
  /** An Info.plist that could not be read, which leaves only the plist rules unsure. */
  plistIssue: string | null;
}

export type ProjectInput =
  | { provided: false }
  | { provided: true; error: string }
  | { provided: true; scan: ProjectScan };
