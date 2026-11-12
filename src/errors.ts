/**
 * What a failed tool call tells the person and the agent.
 *
 * A tool that throws used to reply `Error: <whatever Node said>`, so a dropped
 * connection read "fetch failed" and a damaged key read like an OpenSSL
 * internals dump, with no word on what to do. Every failure now ends with a
 * `Next:` line that says what to do and who does it: the agent (call a tool) or
 * the person (something only they can do, on Apple's site or this computer).
 * The agent is told in the server instructions to follow that line.
 */

import { ASCAPIError } from "./client.js";
import { INTEGRATIONS_URL } from "./connect.js";

/** Where a person reports something the product got wrong. */
export const ISSUES_URL = "https://github.com/pofky/asc-mcp/issues";

const NETWORK_CODES = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR|CERT_|SELF_SIGNED/;

function codeOf(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return String(e?.code ?? e?.cause?.code ?? "");
}

function isNetwork(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return err.message === "fetch failed" || NETWORK_CODES.test(codeOf(err)) || NETWORK_CODES.test(err.message);
}

/** The .p8 could not be opened, or what it holds is not a usable private key. */
function isKeyFile(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = codeOf(err);
  if ((code === "ENOENT" || code === "EACCES" || code === "EISDIR") && /\.p8\b/i.test(err.message)) return true;
  return /^ERR_OSSL|ERR_CRYPTO|DECODER|asn1|PEM|unsupported key|private key/i.test(`${code} ${err.message}`);
}

function nextForApple(status: number): string {
  if (status === 401 || status === 403) {
    return "Next: call asc_setup_check, which tests the key and Issuer ID against Apple and names the exact fix. If it says the key was revoked or lacks a role, the user creates a new key (App Manager or Admin) at " +
      `${INTEGRATIONS_URL}, then restarts the MCP client.`;
  }
  if (status === 404) return "Next: call list_apps to get the right app id, then retry with it.";
  if (status === 409) {
    return "Next: call review_status or app_details to see the version's current state; the detail above names what Apple objects to.";
  }
  if (status === 422 || status === 400) return "Next: fix the value Apple names above and retry.";
  if (status === 429) return "Next: wait about a minute, then retry once.";
  if (status >= 500) {
    return "Next: retry in a minute. If this call was a change, check first with the matching read tool, since Apple may have applied it before failing. Apple's status: https://developer.apple.com/system-status/";
  }
  return "Next: call asc_setup_check; if it passes, the detail above is Apple's own reason.";
}

/**
 * The reply text for a tool call that threw. Always one paragraph of what
 * happened, then a `Next:` line.
 */
export function explainError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ASCAPIError) return `Error: ${msg}\n\n${nextForApple(err.status)}`;
  if (isNetwork(err)) {
    return (
      `Error: could not reach App Store Connect from this computer (${msg}${codeOf(err) ? `, ${codeOf(err)}` : ""}).\n\n` +
      "Next: the user checks the internet connection, VPN or proxy; then retry. If this call was a change, check it with the matching read tool before retrying."
    );
  }
  if (isKeyFile(err)) {
    return (
      `Error: the App Store Connect key file (.p8) could not be read or used (${msg}).\n\n` +
      "Next: call asc_setup_check to see which file is configured. If the file is missing, damaged or was opened and saved by an editor, the user downloads a new key at " +
      `${INTEGRATIONS_URL} (Apple allows one download per key), saves it to ~/.appstoreconnect/private_keys, and restarts the MCP client.`
    );
  }
  return (
    `Error: ${msg}\n\n` +
    `Next: call asc_setup_check. If it passes, retry once. If the same error comes back, it is a bug in asc-mcp: the user can report it with this message at ${ISSUES_URL}.`
  );
}
