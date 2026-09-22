/**
 * What may be counted as a person clicking "buy", and what may be sent to a
 * payment page.
 *
 * These lock the asymmetry the classifier is built around: the count may be
 * wrong about a crawler, the redirect may not be wrong about a person. Every
 * case below is a real shape seen on this worker's own /go link between August
 * and September 2026, except the browsers, which are the shapes that must never
 * be refused.
 */
import { describe, it, expect } from "vitest";
import { beaconPage, classifyGoVisit } from "../src/logic";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";

describe("classifyGoVisit", () => {
  it("counts a real browser click as a human and sends it to checkout", () => {
    for (const ua of [CHROME, SAFARI_IOS, FIREFOX]) {
      expect(classifyGoVisit(ua, [null, null, null, null])).toEqual({
        automated: false,
        redirect: true,
      });
    }
  });

  it("does not redirect a speculative load, whichever header announces it", () => {
    // Chrome sends Sec-Purpose, older Chrome sends Purpose, Firefox X-Moz.
    expect(classifyGoVisit(CHROME, ["prefetch;prerender", null, null, null])).toEqual({
      automated: true,
      redirect: false,
    });
    expect(classifyGoVisit(CHROME, [null, "prefetch", null, null]).redirect).toBe(false);
    expect(classifyGoVisit(CHROME, [null, null, "prefetch", null]).redirect).toBe(false);
    expect(classifyGoVisit(CHROME, [null, null, null, "preview"]).redirect).toBe(false);
  });

  it("ignores an empty prefetch header rather than reading it as a hint", () => {
    expect(classifyGoVisit(CHROME, ["", "  ", null, null])).toEqual({
      automated: false,
      redirect: true,
    });
  });

  it("refuses the redirect to anything that names itself a crawler", () => {
    const crawlers = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "curl/8.7.1",
      "python-requests/2.32.3",
      "Go-http-client/2.0",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HeadlessChrome/126.0.0.0",
    ];
    for (const ua of crawlers) {
      expect(classifyGoVisit(ua, [null, null, null, null])).toEqual({
        automated: true,
        redirect: false,
      });
    }
  });

  it("is case-insensitive about the user-agent", () => {
    expect(classifyGoVisit("GOOGLEBOT/2.1", [null]).automated).toBe(true);
  });

  it("still redirects an unrecognised non-browser, but does not count it", () => {
    // A stripped or exotic user-agent is also what privacy tooling produces in
    // front of a real person, so this one keeps the sale and loses the number.
    expect(classifyGoVisit(null, [null, null, null, null])).toEqual({
      automated: true,
      redirect: true,
    });
    expect(classifyGoVisit("", [null])).toEqual({ automated: true, redirect: true });
    expect(classifyGoVisit("asc-mcp/1.9.11", [null])).toEqual({
      automated: true,
      redirect: true,
    });
  });

  it("treats a HEAD from a browser user-agent as a machine", () => {
    expect(classifyGoVisit(CHROME, [null], "HEAD")).toEqual({
      automated: true,
      redirect: true,
    });
    expect(classifyGoVisit(CHROME, [null], "head").automated).toBe(true);
    expect(classifyGoVisit(CHROME, [null], "GET").automated).toBe(false);
  });
});

/**
 * The site beacon's page names.
 *
 * An allowlist, so the interesting cases are the ones it must refuse: the value
 * arrives from a public endpoint and is written into a stored string.
 */
describe("beaconPage", () => {
  it("names the pages the site actually has", () => {
    expect(beaconPage("/")).toBe("home");
    expect(beaconPage("/index.html")).toBe("home");
    expect(beaconPage("/writing/license-server/")).toBe("writing_license_server");
    expect(beaconPage("/writing/license-server")).toBe("writing_license_server");
    expect(beaconPage("/writing/app-store-connect-api-limits/")).toBe("writing_api_limits");
    expect(beaconPage("/writing/app-store-connect-api-limits")).toBe("writing_api_limits");
  });

  it("ignores a query string and a fragment", () => {
    expect(beaconPage("/?utm_source=hn")).toBe("home");
    expect(beaconPage("/#pricing")).toBe("home");
    expect(beaconPage("/writing/license-server/?ref=x#top")).toBe("writing_license_server");
  });

  it("buckets anything it does not recognise, rather than storing it", () => {
    // A SQL fragment and an overlong path: both must collapse to one safe
    // constant, because this value is written to the counter table.
    const hostile = "'; delete from intent_events where 1=1; --";
    for (const p of [
      "/admin",
      "/../etc/passwd",
      hostile,
      "/" + "a".repeat(5000),
      "",
      null,
      undefined,
      42 as unknown as string,
    ]) {
      expect(beaconPage(p as string)).toBe("other");
    }
  });
});
