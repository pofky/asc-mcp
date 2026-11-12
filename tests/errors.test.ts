import { describe, it, expect } from "vitest";
import { explainError, ISSUES_URL } from "../src/errors.js";
import { ASCAPIError } from "../src/client.js";

/**
 * Every failure reply must end with a Next: line naming who acts. Inputs are
 * the shapes Node and Apple actually produce.
 */
function fetchFailed(code: string): Error {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
}

describe("explainError", () => {
  it("routes Apple auth failures to asc_setup_check and the key page", () => {
    const t = explainError(new ASCAPIError(401, "/v1/apps", JSON.stringify({ errors: [{ detail: "Provide a properly configured and signed bearer token" }] })));
    expect(t).toMatch(/^Error: ASC API error 401/);
    expect(t).toContain("Next: call asc_setup_check");
    expect(t).toContain("appstoreconnect.apple.com/access/integrations/api");
  });

  it("sends a 404 to list_apps and a 409 to the state readers", () => {
    expect(explainError(new ASCAPIError(404, "/v1/apps/1", "{}"))).toContain("Next: call list_apps");
    expect(explainError(new ASCAPIError(409, "/v1/x", '{"errors":[{"code":"STATE_ERROR","detail":"d"}]}'))).toContain("review_status");
  });

  it("warns that a failed change may have applied on a 5xx", () => {
    expect(explainError(new ASCAPIError(503, "/v1/x", "down"))).toContain("check first with the matching read tool");
  });

  it("explains a dropped connection as the user's network, not a bug", () => {
    for (const code of ["ENOTFOUND", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"]) {
      const t = explainError(fetchFailed(code));
      expect(t).toContain("could not reach App Store Connect");
      expect(t).toContain(code);
      expect(t).toContain("Next: the user checks the internet connection");
    }
    expect(explainError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toContain("could not reach");
  });

  it("explains a missing or damaged .p8 with the download step", () => {
    const missing = Object.assign(new Error("ENOENT: no such file or directory, open '/x/AuthKey_ABCDE12345.p8'"), { code: "ENOENT" });
    const damaged = Object.assign(new Error("error:1E08010C:DECODER routines::unsupported"), { code: "ERR_OSSL_UNSUPPORTED" });
    for (const e of [missing, damaged]) {
      const t = explainError(e);
      expect(t).toContain("key file (.p8) could not be read or used");
      expect(t).toContain("Apple allows one download per key");
    }
  });

  it("gives anything else a check, a retry and where to report", () => {
    const t = explainError(new Error("something odd"));
    expect(t).toMatch(/^Error: something odd\n\nNext: call asc_setup_check/);
    expect(t).toContain(ISSUES_URL);
    expect(explainError("a string")).toContain("Error: a string");
  });
});
