import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const TOKEN_LIFETIME_SECONDS = 20 * 60; // 20 minutes (Apple max)
const REFRESH_BUFFER_SECONDS = 60; // Refresh 1 minute before expiry

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Generate a JWT for App Store Connect API authentication.
 * Uses ES256 algorithm with the developer's .p8 private key.
 * Tokens are cached and auto-refreshed before expiry.
 */
export async function getToken(
  keyId: string,
  issuerId: string,
  privateKeyPath: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && now < tokenExpiresAt - REFRESH_BUFFER_SECONDS) {
    return cachedToken;
  }

  const resolvedPath = privateKeyPath.startsWith("~")
    ? resolve(homedir(), privateKeyPath.slice(2))
    : resolve(privateKeyPath);

  const privateKeyPem = readFileSync(resolvedPath, "utf-8");
  const exp = now + TOKEN_LIFETIME_SECONDS;

  // Individual API keys use `sub: "user"` instead of `iss: issuerId`.
  // Detect by empty/missing issuer ID.
  const claims: Record<string, unknown> = {
    iat: now,
    exp,
    aud: "appstoreconnect-v1",
    ...(issuerId ? { iss: issuerId } : { sub: "user" }),
  };

  const jwt = signES256({ alg: "ES256", kid: keyId, typ: "JWT" }, claims, privateKeyPem);

  cachedToken = jwt;
  tokenExpiresAt = exp;

  return jwt;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * Sign an ES256 JWT with Node's own crypto.
 *
 * This used to be `jose`, which is ESM-only from v6. The package is CommonJS,
 * so `require("jose")` throws ERR_REQUIRE_ESM on any runtime without
 * `require(esm)`: every Node 18, and Node 20 before 20.19. The server did not
 * start at all there, while package.json, the README, the site and the .mcpb
 * manifest all claimed Node 18 was supported. Verified on 18.20.8.
 *
 * ES256 wants the raw r||s pair, not the DER sequence OpenSSL produces by
 * default, which is what `dsaEncoding: "ieee-p1363"` asks for. Getting that
 * wrong produces a token Apple rejects with a 401, so it is covered by a test
 * that checks the signature length and verifies it back.
 */
export function signES256(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: createPrivateKey(privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Clear the cached token (useful for tests or forced refresh). */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
