import { describe, it, expect } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signES256 } from "../src/auth.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("signES256", () => {
  it("produces a three-part JWT with the header and claims we passed", () => {
    const jwt = signES256(
      { alg: "ES256", kid: "ABCDE12345", typ: "JWT" },
      { iss: "issuer", aud: "appstoreconnect-v1", exp: 123, iat: 1 },
      pem,
    );
    const [h, p] = jwt.split(".");
    expect(jwt.split(".")).toHaveLength(3);
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABCDE12345",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).iss).toBe("issuer");
  });

  /**
   * ES256 is the raw r||s pair, 64 bytes, not the variable-length DER sequence
   * OpenSSL emits by default. A DER signature here is accepted by nothing: Apple
   * answers 401 and the cause is invisible from the error.
   */
  it("signs with the raw r||s pair, not DER, and verifies", () => {
    const jwt = signES256({ alg: "ES256", typ: "JWT" }, { iss: "x" }, pem);
    const [h, p, sig] = jwt.split(".");
    const signature = Buffer.from(sig, "base64url");
    expect(signature).toHaveLength(64);
    expect(
      createVerify("SHA256")
        .update(`${h}.${p}`)
        .verify({ key: publicPem, dsaEncoding: "ieee-p1363" }, signature),
    ).toBe(true);
  });

  it("rejects a signature made over different bytes", () => {
    const jwt = signES256({ alg: "ES256", typ: "JWT" }, { iss: "x" }, pem);
    const [h, p, sig] = jwt.split(".");
    expect(
      createVerify("SHA256")
        .update(`${h}.${p}tampered`)
        .verify(
          { key: publicPem, dsaEncoding: "ieee-p1363" },
          Buffer.from(sig, "base64url"),
        ),
    ).toBe(false);
  });
});

/**
 * The package is CommonJS. An ESM-only dependency therefore throws
 * ERR_REQUIRE_ESM at startup on every runtime without `require(esm)`: all of
 * Node 18, and Node 20 before 20.19. That is exactly how `jose` v6 broke the
 * server for every user on the Node version this package claims to support,
 * and nothing in the build or the tests noticed, because CI runs a newer Node.
 */
describe("runtime dependencies stay require()-able", () => {
  it("has no ESM-only dependency", () => {
    const require = createRequire(import.meta.url);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.type).not.toBe("module"); // if this changes, this whole test is moot

    const offenders: string[] = [];
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      const depPkg = JSON.parse(
        readFileSync(require.resolve(`${dep}/package.json`), "utf-8"),
      );
      const exports = JSON.stringify(depPkg.exports ?? "");
      const hasCjs = depPkg.main || exports.includes("require");
      if (depPkg.type === "module" && !hasCjs) offenders.push(`${dep}@${depPkg.version}`);
    }
    expect(offenders).toEqual([]);
  });
});
