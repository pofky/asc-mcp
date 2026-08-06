/**
 * Pure decision logic for the licence worker.
 *
 * Separate from index.ts for two reasons. The Workers runtime only accepts a
 * default handler export from the entry module, so exporting these constants and
 * helpers from there stopped `wrangler dev` from starting at all, which meant
 * the worker could never be exercised locally before a deploy. And every rule in
 * here has cost a paying customer their access at least once, so it belongs
 * where it can be unit-tested directly rather than through HTTP.
 */

/**
 * The Polar checkout link. Lives in one place because moving the product to a
 * different Polar organization changes it, and the old link keeps working, so a
 * missed copy silently sells into the wrong org. `src/gate.ts` in the npm
 * package holds the same value; `scripts/set-checkout-url.mjs` rewrites both.
 */
export const CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_y86PS4ruc848PXevVvSYS49S8gZY8JYWF192v1UEgjj";

/** How long a self-served in-agent trial lasts. */
export const TRIAL_DAYS = 7;

/**
 * A tool name is echoed into an analytics row and into the checkout URL's
 * `utm_content`, both of which are attacker-influenced strings otherwise.
 * Restrictive on purpose: every real tool name in this product matches.
 */
export function isValidToolName(s: unknown): s is string {
  return typeof s === "string" && /^[a-z0-9_]{1,64}$/.test(s);
}

/** The fingerprint is a SHA-256 hex digest computed on the user's machine. */
export function isValidFingerprint(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

/**
 * Deliberately loose. This is a deliverability check, not an identity check:
 * the address is where the key gets emailed, and rejecting a valid-but-unusual
 * address costs a lead.
 */
export function isValidEmail(s: unknown): s is string {
  return typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Trial expiry, as the ISO string stored in expires_at. */
export function trialExpiry(now: Date, days = TRIAL_DAYS): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Whole days left before an expiry, floored at 0. */
export function daysRemaining(expiresAt: string | null, now: Date): number {
  if (!expiresAt) return 0;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * The checkout URL with attribution attached. The redirect target is this
 * constant, never anything derived from the request, so /go cannot be turned
 * into an open redirect.
 */
export function buildCheckoutUrl(tool?: string, email?: string): string {
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set("utm_source", "agent");
  url.searchParams.set("utm_medium", "mcp");
  if (isValidToolName(tool)) url.searchParams.set("utm_content", tool);
  if (isValidEmail(email)) url.searchParams.set("customer_email", email);
  return url.toString();
}

/**
 * Renewals reach us as a `subscription.updated` webhook that pushes
 * `expires_at` to the new period end. If that delivery is late or dropped, the
 * old expiry is already in the past and a customer who paid gets demoted to the
 * free tier mid-session. Polar's own dunning runs for days, so a few days of
 * grace costs nothing and prevents a support ticket, or a cancellation, over
 * our own webhook plumbing.
 *
 * Exported for regression tests.
 */
export const GRACE_DAYS = 4;

export function isLicenseUsable(
  row: { expires_at: string | null; active: number; source?: string | null },
  now: Date,
): { usable: boolean; reason?: string; grace?: boolean } {
  if (!row.active) return { usable: false, reason: "inactive" };
  if (!row.expires_at) return { usable: true };

  const expiry = new Date(row.expires_at);
  if (Number.isNaN(expiry.getTime())) return { usable: true };
  if (expiry >= now) return { usable: true };

  // The grace window exists for one reason: a renewal webhook that is late or
  // dropped must never demote someone who has paid. A trial has no renewal and
  // nothing to be late, so granting it grace would just silently turn every
  // 7-day trial into an 11-day one. Anything that is not explicitly a trial
  // keeps the paid behaviour, including the rows that predate this column.
  if (row.source === "trial") return { usable: false, reason: "trial_expired" };

  const graceEnds = new Date(expiry.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  if (now <= graceEnds) return { usable: true, grace: true };

  return { usable: false, reason: "expired" };
}

/**
 * Decide whether a subscription should be active given the status on an
 * active-type Polar event. Exported for regression tests: this is the exact
 * logic that three times now left paying customers at active=0. Anything that
 * is not a known-dead status (including an absent status, "active",
 * "trialing", "past_due", "incomplete", "canceled") activates the license.
 */
export function computeActiveFlag(status?: string): 0 | 1 {
  return status && DEAD_STATUSES.has(status) ? 0 : 1;
}

/**
 * The activation decision actually written to the row: the status verdict, and
 * additionally never active once the paid period is over.
 *
 * Two orderings make the status alone insufficient. Polar's own cancellation
 * emits `canceled` and `revoked` back to back, and any late or retried
 * `subscription.updated` carrying the still-live status would otherwise
 * resurrect a licence that `revoked` had just switched off. And a `cycled` or
 * `updated` replayed long after a subscription lapsed would reactivate it.
 * A period end in the past means no entitlement, whatever the status says.
 */
export function shouldBeActive(
  status: string | undefined,
  currentPeriodEnd: string | null | undefined,
  now: Date,
): 0 | 1 {
  if (!computeActiveFlag(status)) return 0;
  if (!currentPeriodEnd) return 1;
  const end = new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return 1;
  return end > now ? 1 : 0;
}

export function classifyPolarEvent(
  type: string,
): "activate" | "cancel" | "ignore" {
  if (ACTIVE_EVENTS.has(type)) return "activate";
  if (CANCEL_EVENTS.has(type)) return "cancel";
  return "ignore";
}

/**
 * Every webhook signing secret this worker will accept, newest first. Exported
 * for tests.
 */
export function webhookSecrets(env: {
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_WEBHOOK_SECRET_2?: string;
  POLAR_WEBHOOK_SECRET_SANDBOX?: string;
}): string[] {
  return [
    env.POLAR_WEBHOOK_SECRET_2,
    env.POLAR_WEBHOOK_SECRET,
    env.POLAR_WEBHOOK_SECRET_SANDBOX,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * Polar has emitted the product id under several shapes over time, and a guard
 * that reads only one of them silently falls through to "provision it", which
 * is exactly how the stray-licence incident happened.
 */
export function resolveProductId(data: Record<string, unknown>): string | null {
  const direct = data.product_id ?? data.productId;
  if (typeof direct === "string" && direct) return direct;
  const nested = (data.product as { id?: unknown } | undefined)?.id;
  return typeof nested === "string" && nested ? nested : null;
}

/**
 * Whether this event is for one of our products. An event with NO product id is
 * ours by default: dropping those would break the legacy payload shape that the
 * existing subscriptions still arrive in, and a false negative here costs a
 * paying customer their key.
 */
export function isOwnProduct(
  data: Record<string, unknown>,
  extraIds: string[] = [],
): boolean {
  const id = resolveProductId(data);
  if (!id) return true;
  return OWN_PRODUCT_IDS.has(id) || extraIds.includes(id);
}

/**
 * Verify a Polar webhook using the Standard Webhooks spec
 * (https://www.standardwebhooks.com). Polar signs `${id}.${timestamp}.${body}`
 * with HMAC-SHA256 using the base64 secret (whsec_ prefix), and sends the
 * result base64-encoded as space-delimited `v1,<sig>` entries.
 */
export async function verifyPolarSignature(
  reqHeaders: Headers,
  rawBody: string,
  secrets: string[],
): Promise<boolean> {
  const id = reqHeaders.get("webhook-id");
  const timestamp = reqHeaders.get("webhook-timestamp");
  const sigHeader = reqHeaders.get("webhook-signature");
  if (!id || !timestamp || !sigHeader || !secrets.length) return false;

  // Replay protection: reject timestamps more than 5 minutes from now.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > 300) return false;

  const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);

  // Each Polar organization signs with its own secret, and during the move to a
  // dedicated org both deliver at once: the old org still sends renewals and
  // cancellations for the grandfathered subscriptions while the new one sends
  // new signups. Accept a signature from any configured secret.
  for (const secret of secrets) {
    for (const keyBytes of candidateKeys(secret)) {
      const key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, signed);
      const expected = bytesToBase64(new Uint8Array(sigBuf));

      // Header may carry multiple space-delimited signatures (key rotation).
      const match = sigHeader.split(" ").some((part) => {
        const [version, sig] = part.split(",");
        return version === "v1" && sig != null && timingSafeEqual(sig, expected);
      });
      if (match) return true;
    }
  }

  return false;
}

/**
 * The HMAC key bytes to try for one secret.
 *
 * A secret copied from the Polar dashboard looks like `polar_whs_...`, and the
 * key is the raw UTF-8 of the whole string: Polar's `validateEvent`
 * base64-encodes the secret before handing it to the Standard Webhooks library,
 * which base64-decodes it straight back. Getting this wrong meant zero licence
 * rows were ever created and the first paying customer got no key.
 *
 * A secret minted through `POST /v1/webhooks/endpoints` comes back as
 * `whsec_<base64>`, the canonical Standard Webhooks shape, where the key is the
 * base64-decoded remainder. Rather than bet a customer's first purchase on
 * which convention applies, try both. Two extra HMACs on a rejected request.
 */
export function candidateKeys(secret: string): Uint8Array[] {
  if (!secret) return [];
  const keys = [new TextEncoder().encode(secret)];

  const marker = secret.indexOf("_");
  if (marker > 0) {
    const body = secret.slice(marker + 1);
    try {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length) keys.push(bytes);
    } catch {
      // Not base64: the raw-UTF-8 candidate is the only one.
    }
  }

  return keys;
}

export interface LookupRow {
  key: string;
  tier: string;
  active: number;
  expires_at: string | null;
  source: string | null;
}

/**
 * Which key to show someone who looks up their email.
 *
 * A user can legitimately hold two rows: the trial they started and the
 * subscription they then bought. Newest-first alone would hand a paying
 * customer their dead trial key, which validates as free and looks exactly like
 * "I paid and it does not work". Paid always wins; an expired trial is not
 * offered at all.
 */
export function pickLookupRow(rows: LookupRow[], now: Date): LookupRow | null {
  const usable = rows.filter((r) => isLicenseUsable(r, now).usable);
  return usable.find((r) => r.source !== "trial") ?? usable[0] ?? null;
}

export const ACTIVE_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  // A renewal starts a new billing period. Polar sends `cycled` for it, and
  // historically `updated` too; handling only `updated` would leave a renewed
  // customer on last period's `expires_at` if that ever stops being sent, and
  // they would fall to the free tier once the grace window closed.
  "subscription.cycled",
  // Both mean access resumes with a fresh period end.
  "subscription.uncanceled",
  "subscription.resumed",
]);
// In Polar, `subscription.canceled` means "will not renew": the customer keeps
// access until the period they already paid for ends. Only `revoked` means
// access ends now. Treating both as immediate revocation took away time
// customers had paid for, which is the one thing a licence server must not do.
export const CANCEL_EVENTS = new Set([
  "subscription.canceled",
  "subscription.revoked",
]);
export const IMMEDIATE_REVOKE_EVENTS = new Set(["subscription.revoked"]);
// Statuses that mean the subscription is NOT usable even though an
// active-type event fired. Anything else (active, trialing, past_due,
// incomplete, or absent) is treated as active so a paying customer is
// never left without a key.
//
// `canceled` is deliberately NOT here. Polar sets it the moment a customer
// turns off renewal, while `current_period_end` is still in the future and they
// are still entitled. It arrives on a `subscription.updated`, so listing it as
// dead demoted a paying customer the instant they cancelled, taking away time
// they had already paid for. The CANCEL_EVENTS path was fixed for this in
// v1.8.2; this is the same bug through the other door, and a sandbox
// cancellation reproduced it against the live worker. `revoked` is what ends
// access, and expires_at ends it naturally otherwise.
const DEAD_STATUSES = new Set([
  "revoked",
  "incomplete_expired",
  "unpaid",
]);

/**
 * Every asc-mcp Pro product, across organizations.
 *
 * Polar delivers each event to EVERY webhook endpoint registered in the
 * organization, so an endpoint in a shared org receives the other products'
 * sales too. That has already caused a real incident on this account: one
 * project's test purchase fanned out and minted three stray licences plus
 * welcome emails in a sibling project. The old org sold asc-mcp alongside other
 * products, so without this guard someone else's subscription would mint an
 * asc-mcp Pro key and email it to them.
 */
const OWN_PRODUCT_IDS = new Set([
  // Original product, in the shared organization c16ec812.
  "7cf11984-03f1-4251-b765-4c0abb3ab99f",
  // Dedicated asc-mcp organization 3bef20c6, where new signups go.
  "7cd3dd0b-7ee2-43db-a920-f7d4371f9d9a",
]);

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Constant-time string compare. Used for webhook signatures and for the admin
 * tokens: `!==` short-circuits on the first differing character, which leaks
 * the prefix of a secret to anyone willing to measure.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** How long a deletion confirmation link stays valid. */
export const DELETE_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function signDeleteToken(
  secret: string,
  email: string,
  expiresAt: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${email}.${expiresAt}`),
  );
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${expiresAt}.${hex}`;
}

export async function verifyDeleteToken(
  secret: string,
  email: string,
  token: string,
  now: number,
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = await signDeleteToken(secret, email, expiresAt);
  return timingSafeEqual(token, expected);
}

