/**
 * Douse friction row 16: right after upload_binary, Apple had not listed the new build, so wait_for_build
 * called the previous build "ready". With build_number it waits for that build; without it, it says the
 * newest listed build may be an older one.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { waitForBuild } from "../src/tools/builds.js";

type Row = { id: string; attributes: { version: string; processingState: string } };

function client(pages: Row[][]) {
  const calls: Record<string, string>[] = [];
  let i = 0;
  return {
    calls,
    get: async (_path: string, params: Record<string, string>) => {
      calls.push(params);
      const rows = pages[Math.min(i++, pages.length - 1)];
      const wanted = params["filter[version]"];
      return { data: wanted ? rows.filter((r) => r.attributes.version === wanted) : rows };
    },
  };
}

const b1: Row = { id: "old", attributes: { version: "1", processingState: "VALID" } };
const b2processing: Row = { id: "new", attributes: { version: "2", processingState: "PROCESSING" } };
const b2valid: Row = { id: "new", attributes: { version: "2", processingState: "VALID" } };

describe("wait_for_build build_number", () => {
  // The tool polls at least every 10 s; run the waits at once.
  afterEach(() => vi.restoreAllMocks());
  const instant = () =>
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0; }) as never);

  it("waits past an older VALID build until the named build is listed and VALID", async () => {
    instant();
    const c = client([[b1], [b2processing, b1], [b2valid, b1]]);
    const out = await waitForBuild(c as never, { app_id: "1", build_number: "2", poll_seconds: 0.001, max_wait_seconds: 5 }, "pro");
    expect(out).toContain("Build 2 is VALID");
    expect(out).toContain("build_id new");
    expect(c.calls.length).toBe(3);
    expect(c.calls[0]["filter[version]"]).toBe("2");
  });

  it("without build_number, says the newest listed build may predate an upload", async () => {
    const c = client([[b1]]);
    const out = await waitForBuild(c as never, { app_id: "1" }, "pro");
    expect(out).toContain("Newest listed build 1 is VALID");
    expect(out).toContain("build_number");
    expect(out).not.toMatch(/^Build 1 is VALID and ready/);
  });

  it("times out naming the build that never appeared", async () => {
    instant();
    const c = client([[b1]]);
    const out = await waitForBuild(c as never, { app_id: "1", build_number: "2", poll_seconds: 0.001, max_wait_seconds: 0.01 }, "pro");
    expect(out).toContain("build 2 not listed yet");
    expect(out).toContain("Apple has no build 2");
  });

  it("refuses a build_number that is not a CFBundleVersion", async () => {
    const out = await waitForBuild(client([[b1]]) as never, { app_id: "1", build_number: "v2" }, "pro");
    expect(out).toMatch(/^Error: build_number/);
  });
});
