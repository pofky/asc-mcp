import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewReplyKind, previewScope, takePreviewNotice, PREVIEW_CALLS } from "../src/gate.js";
import { clearLicenseCache } from "../src/license.js";
import { listBetaGroups } from "../src/tools/testflight.js";
import { listBuilds } from "../src/tools/builds.js";
import { metadataDiff } from "../src/tools/metadata-diff.js";
import { formatReviews } from "../src/tools/list-reviews.js";
import type { ASCClient } from "../src/client.js";

/**
 * The 4 November 2026 first-time-user test spent all five preview calls on
 * empty replies ("No beta groups", "Only one version found") and never reached
 * preflight. These run the real tools against an account with nothing in it,
 * so the replies checked are the ones a user gets, not copies of them.
 */

let home = "";
const used = () => JSON.parse(readFileSync(join(home, ".asc-mcp", "preview.json"), "utf8")).used;

/** An App Store Connect account that answers every list with nothing, and knows the app. */
function emptyAccount(versions: { versionString: string; appStoreState: string }[] = []): ASCClient {
  return {
    get: async (path: string) => {
      if (path.endsWith("/appStoreVersions")) {
        return { data: versions.map((attributes, i) => ({ id: String(i), attributes })) };
      }
      if (/^\/v1\/apps\/[^/]+$/.test(path)) return { data: { id: "1", attributes: { name: "App" } } };
      return { data: [] };
    },
  } as unknown as ASCClient;
}

/** Run a tool as the wrapper does: inside a call scope, then classify and refund. */
async function previewCall(run: () => Promise<string>) {
  return previewScope.run({ grant: null }, async () => {
    const body = await run();
    const notice = takePreviewNotice();
    const kind = previewReplyKind(body);
    if (notice && kind !== "answer") notice.refund();
    return { body, kind, previewed: Boolean(notice) };
  });
}

describe("an empty reply does not spend a preview call", () => {
  beforeEach(() => {
    clearLicenseCache();
    home = mkdtempSync(join(tmpdir(), "asc-preview-empty-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  it("no beta groups", async () => {
    const r = await previewCall(() => listBetaGroups(emptyAccount(), { app_id: "1" }, "free"));
    expect(r.previewed).toBe(true);
    expect(r.kind).toBe("empty");
    expect(used()).toBe(0);
  });

  it("no builds on an app that exists", async () => {
    const r = await previewCall(() => listBuilds(emptyAccount(), { app_id: "1" }, "free"));
    expect(r.kind).toBe("empty");
    expect(used()).toBe(0);
  });

  it("one version, so nothing to diff", async () => {
    const r = await previewCall(() =>
      metadataDiff(emptyAccount([{ versionString: "1.0", appStoreState: "READY_FOR_SALE" }]), { app_id: "1" }, "free"),
    );
    expect(r.kind).toBe("empty");
    expect(used()).toBe(0);
  });

  it("no reviews", () => {
    expect(previewReplyKind(formatReviews([]))).toBe("empty");
  });

  it("a reply with content is an answer and spends the call", async () => {
    const r = await previewCall(async () => {
      const { requirePro } = await import("../src/gate.js");
      requirePro("free", "Listing builds", "list_builds");
      return "## Builds\n- 1.0 (40) VALID";
    });
    expect(r.kind).toBe("answer");
    expect(used()).toBe(1);
  });

  it("still gives back a failed call, and a comparison with no differences is an answer", () => {
    expect(previewReplyKind("Error: Apple returned 500")).toBe("failed");
    expect(previewReplyKind("No app with id 9 in this account.")).toBe("failed");
    expect(previewReplyKind("## Metadata diff\n**No metadata differences found** between these versions.")).toBe("answer");
  });

  it("five empty replies in a row leave all five calls", async () => {
    for (let i = 0; i < PREVIEW_CALLS; i++) {
      await previewCall(() => listBetaGroups(emptyAccount(), { app_id: "1" }, "free"));
    }
    expect(used()).toBe(0);
  });
});
