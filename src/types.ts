/** App Store Connect API response types */

export interface ASCConfig {
  keyId: string;
  issuerId: string;
  privateKeyPath: string;
  licenseKey?: string;
}

export type Tier = "free" | "pro";

export interface LicenseStatus {
  valid: boolean;
  tier: Tier;
  expires?: string;
  /** True when this key is a 7-day in-agent trial rather than a subscription. */
  trial?: boolean;
  /** True when a paid key is past expiry but inside the renewal grace window. */
  grace?: boolean;
  reason?: string;
}

export interface ASCApp {
  id: string;
  name: string;
  bundleId: string;
  sku: string;
  primaryLocale: string;
  platform: string;
}

export interface ASCAppVersion {
  id: string;
  versionString: string;
  appStoreState: string;
  platform: string;
  createdDate: string;
}

export interface ASCReviewSubmission {
  id: string;
  state: string;
  submittedDate?: string;
  platform: string;
}

export interface ASCCustomerReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  createdDate: string;
  territory: string;
}

export interface ASCSalesReport {
  provider: string;
  date: string;
  units: number;
  proceeds: number;
  currency: string;
  title: string;
  sku: string;
  countryCode: string;
}

/** ASC API JSON:API envelope */
export interface ASCResponse<T> {
  data: ASCResourceObject<T>[] | ASCResourceObject<T>;
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging?: {
      total: number;
      limit: number;
    };
  };
}

export interface ASCResourceObject<T> {
  type: string;
  id: string;
  attributes: T;
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] }>;
  links?: { self: string };
}
