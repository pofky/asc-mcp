import { createHash } from "node:crypto";
import { LICENSE_API_URL } from "./license.js";

/**
 * Namespace prefix for the trial fingerprint. Versioned so the derivation can
 * change later without silently colliding with digests already in the database.
 */
export const TRIAL_FINGERPRINT_SALT = "asc-mcp-trial-v1:";

/**
 * A stable, one-way identifier for the user's Apple developer account.
 *
 * The Issuer ID never leaves the machine: only this digest is sent, and only
 * when the user explicitly asks to start a trial. It is what stops one person
 * taking an unlimited number of free weeks, because a second digest costs a
 * second Apple Developer Program membership at $99 a year.
 */
export function fingerprintIssuer(issuerId: string): string {
  return createHash("sha256")
    .update(TRIAL_FINGERPRINT_SALT + issuerId.trim().toLowerCase())
    .digest("hex");
}

export interface TrialSuccess {
  ok: true;
  key: string;
  expires: string | null;
  days_remaining: number;
  already_started: boolean;
  checkout_url?: string;
}

export interface TrialFailure {
  ok: false;
  error: string;
  message: string;
  checkout_url?: string;
}

export type TrialResponse = TrialSuccess | TrialFailure;

/**
 * Ask the licence server for a trial key. Every failure mode returns a
 * TrialFailure with something the agent can say out loud; nothing throws, so a
 * licence-server outage degrades to a readable message rather than a tool error.
 */
export async function requestTrial(
  args: { issuerId: string; email: string; tool?: string },
  apiUrl: string = LICENSE_API_URL,
): Promise<TrialResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint: fingerprintIssuer(args.issuerId),
        email: args.email.trim(),
        ...(args.tool ? { tool: args.tool } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      error: "network",
      message:
        "Could not reach the license server. Check your connection and try again; nothing was created.",
    };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: "bad_response",
      message: `The license server returned an unreadable response (HTTP ${response.status}).`,
    };
  }

  if (response.ok && typeof body.key === "string") {
    return {
      ok: true,
      key: body.key,
      expires: (body.expires as string | null) ?? null,
      days_remaining: Number(body.days_remaining ?? 0),
      already_started: Boolean(body.already_started),
      checkout_url: typeof body.checkout_url === "string" ? body.checkout_url : undefined,
    };
  }

  return {
    ok: false,
    error: typeof body.error === "string" ? body.error : `http_${response.status}`,
    message:
      typeof body.message === "string"
        ? body.message
        : `The license server refused the request (HTTP ${response.status}).`,
    checkout_url: typeof body.checkout_url === "string" ? body.checkout_url : undefined,
  };
}
