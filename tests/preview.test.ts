import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PREVIEW_CALLS, previewScope, requirePro, takePreviewNotice } from "../src/gate.js";
import { clearLicenseCache, validateLicense } from "../src/license.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");

/** A fresh home for each test, so one test's count never reaches the next. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "asc-preview-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}
const countFile = (home: string) => join(home, ".asc-mcp", "preview.json");
const used = (home: string) => JSON.parse(readFileSync(countFile(home), "utf8")).used;

/** Ask the gate from inside a tracked call, as the tool wrapper does. */
function gated(tier: "free" | "pro", capability: string, tool?: string) {
  return previewScope.run({ grant: null }, () => ({
    refusal: requirePro(tier, capability, tool),
    notice: takePreviewNotice(),
  }));
}

describe("the free preview of Pro read tools", () => {
  beforeEach(() => {
    clearLicenseCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearLicenseCache();
  });

  it(`lets a read tool through ${PREVIEW_CALLS} times, then asks for the price before the trial`, () => {
    const home = freshHome();
    for (let call = 1; call <= PREVIEW_CALLS; call++) {
      expect(gated("free", "Customer reviews", "list_reviews").refusal, `call ${call}`).toBeNull();
      expect(used(home)).toBe(call);
    }
    const refused = gated("free", "Customer reviews", "list_reviews").refusal!;
    expect(refused).toContain("Customer reviews requires Pro");
    expect(refused).toContain(`You have used the ${PREVIEW_CALLS} free Pro calls`);
    expect(refused.indexOf("$9/month")).toBeLessThan(refused.indexOf("asc_start_trial"));
    expect(used(home)).toBe(PREVIEW_CALLS);
  });

  it("counts across tools: it is one allowance, not one per tool", () => {
    freshHome();
    const tools = ["list_reviews", "sales_report", "list_builds", "release_preflight", "daily_briefing"];
    expect(tools).toHaveLength(PREVIEW_CALLS);
    for (const tool of tools) expect(gated("free", "x", tool).refusal).toBeNull();
    expect(gated("free", "Keyword insights", "keyword_insights").refusal).toContain("requires Pro");
  });

  it("tells the user how many are left, and says so on the last one", () => {
    freshHome();
    const footers: string[] = [];
    for (let call = 1; call <= PREVIEW_CALLS; call++) {
      footers.push(gated("free", "Listing builds", "list_builds").notice!.footer);
    }
    expect(footers[0]).toContain(`${PREVIEW_CALLS - 1} of ${PREVIEW_CALLS} Pro calls left`);
    expect(footers[0]).toContain("$9/month");
    expect(footers[0]).toContain("/go?tool=list_builds");
    expect(footers[1]).toContain(`${PREVIEW_CALLS - 2} of ${PREVIEW_CALLS} Pro calls left`);
    expect(footers[1]).not.toContain("$9");
    expect(footers.at(-1)).toContain(`the last of your ${PREVIEW_CALLS} free Pro calls`);
    expect(footers.at(-1)).toContain("$9/month");
    expect(footers.at(-1)).toContain("asc_start_trial");
    expect(gated("free", "Listing builds", "list_builds").notice).toBeNull();
  });

  it("keeps one number in the file and nothing else", () => {
    const home = freshHome();
    gated("free", "Listing builds", "list_builds");
    expect(JSON.parse(readFileSync(countFile(home), "utf8"))).toEqual({ used: 1 });
  });

  it("gives a call back when it failed", () => {
    const home = freshHome();
    const { notice } = gated("free", "Listing builds", "list_builds");
    expect(used(home)).toBe(1);
    notice!.refund();
    expect(used(home)).toBe(0);
  });

  it("never previews a tool that changes something", () => {
    const home = freshHome();
    for (const tool of ["submit_for_review", "update_version_metadata", "release_version", "upload_binary", "create_iap"]) {
      const { refusal, notice } = gated("free", "x", tool);
      expect(refusal, tool).toContain("requires Pro");
      expect(notice).toBeNull();
    }
    expect(existsSync(countFile(home))).toBe(false);
  });

  it("does not preview the sampling tools, the manual-step checklists or the hour-long wait", () => {
    const home = freshHome();
    for (const tool of ["triage_reviews", "draft_review_response", "set_privacy_nutrition", "set_eu_trader_status", "wait_for_build"]) {
      expect(gated("free", "x", tool).refusal, tool).toContain("requires Pro");
    }
    expect(existsSync(countFile(home))).toBe(false);
  });

  it("gives no preview when the count cannot be kept", () => {
    if (process.platform === "win32") return;
    const home = freshHome();
    mkdirSync(join(home, ".asc-mcp"));
    chmodSync(join(home, ".asc-mcp"), 0o500);
    expect(gated("free", "Listing builds", "list_builds").refusal).toContain("requires Pro");
    chmodSync(join(home, ".asc-mcp"), 0o700);
  });

  for (const reason of ["trial_expired", "revoked", "canceled"]) {
    it(`gives no preview to someone the licence server reports as ${reason}`, async () => {
      const home = freshHome();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ valid: false, tier: "free", reason }), { status: 200 }),
      );
      await validateLicense("ASC-OLD-KEY");
      expect(gated("free", "Listing builds", "list_builds").refusal).toContain("requires Pro");
      expect(existsSync(countFile(home))).toBe(false);
    });
  }

  /**
   * An agent runs tool calls side by side. With one shared list of grants,
   * whichever call finished first took the notice: a free tool announced the
   * preview count and a failed call's refund went to a different call.
   */
  it("keeps each call's preview to itself when calls overlap", async () => {
    const home = freshHome();
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const slowPreview = previewScope.run({ grant: null }, async () => {
      requirePro("free", "Customer reviews", "list_reviews");
      await pause(40);
      return takePreviewNotice();
    });
    // A free tool that finishes while the preview is still running.
    const fastFree = previewScope.run({ grant: null }, async () => takePreviewNotice());
    // A previewed call that fails while the first is still running.
    const fastFailure = previewScope.run({ grant: null }, async () => {
      requirePro("free", "Listing builds", "list_builds");
      takePreviewNotice()!.refund();
    });

    expect(await fastFree).toBeNull();
    await fastFailure;
    const notice = await slowPreview;
    expect(notice!.footer).toContain("tool=list_reviews");
    expect(notice!.footer).toContain(`${PREVIEW_CALLS - 1} of ${PREVIEW_CALLS}`);
    expect(used(home)).toBe(1);
  });

  it("grants nothing outside a tracked call, where it could not be reported or refunded", () => {
    const home = freshHome();
    expect(requirePro("free", "Listing builds", "list_builds")).toContain("requires Pro");
    expect(existsSync(countFile(home))).toBe(false);
  });
});

/**
 * The promise to people who already pay: nothing about this exists for them.
 */
describe("a Pro user sees none of it", () => {
  it("is let through with no count kept and nothing to report", () => {
    const home = freshHome();
    for (let call = 0; call < PREVIEW_CALLS + 3; call++) {
      expect(gated("pro", "Listing builds", "list_builds")).toEqual({ refusal: null, notice: null });
      expect(gated("pro", "Submitting for review", "submit_for_review")).toEqual({ refusal: null, notice: null });
    }
    expect(existsSync(join(home, ".asc-mcp"))).toBe(false);
  });
});

/**
 * Over the wire, against the built server. `release_notes` is the one previewed
 * tool that needs neither Apple nor the network: it reads `git log` here.
 */
describe("the preview as a client sees it", () => {
  beforeAll(() => {
    if (!existsSync(ENTRY)) throw new Error("dist/index.js is missing. Run `npm run build` first.");
  });

  let server: Server | undefined;
  afterEach(() => server?.close());

  /**
   * A repository with one commit of known wording. Reading this project's own
   * history made the assertions depend on what the latest commit message said.
   */
  let repo: string | undefined;
  function fixtureRepo(): string {
    if (repo) return repo;
    repo = mkdtempSync(join(tmpdir(), "asc-fixture-repo-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(repo, "a.txt"), "a");
    git("add", "a.txt");
    git("commit", "-q", "-m", "fix: the fixture commit");
    return repo;
  }

  async function releaseNotesReplies(calls: number, licence: "none" | "pro"): Promise<{ replies: string[]; home: string }> {
    server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ valid: true, tier: "pro" }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const home = mkdtempSync(join(tmpdir(), "asc-preview-"));

    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ASC_KEY_ID: "x",
        ASC_ISSUER_ID: "x",
        ASC_PRIVATE_KEY_PATH: "/dev/null",
        ASC_LICENSE_KEY: licence === "pro" ? "ASC-PAID" : undefined,
        ASC_INSTALL: undefined,
        ASC_LICENSE_API_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    const replies = new Map<number, string>();
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out. stdout: ${out}`)), 25_000);
      child.stdout.on("data", (chunk) => {
        out += chunk;
        for (const line of out.split("\n").filter(Boolean)) {
          try {
            const message = JSON.parse(line);
            if (message.id >= 10) replies.set(message.id, message.result.content[0].text);
          } catch {
            // A partial line; the next chunk completes it.
          }
        }
        if (replies.size === calls) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    for (let call = 0; call < calls; call++) {
      send({
        jsonrpc: "2.0",
        id: 10 + call,
        method: "tools/call",
        params: { name: "release_notes", arguments: { project_path: fixtureRepo(), max_commits: 1 } },
      });
    }
    await done;
    child.kill();
    return { replies: [...replies.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text), home };
  }

  it("answers five times with a countdown, then refuses with the price", async () => {
    const { replies } = await releaseNotesReplies(PREVIEW_CALLS + 1, "none");
    for (let call = 0; call < PREVIEW_CALLS; call++) {
      expect(replies[call], `call ${call + 1}`).not.toContain("requires Pro");
      expect(replies[call]).toContain("Pro calls");
      // The price rides on the first and the last preview reply only.
      const pricey = call === 0 || call === PREVIEW_CALLS - 1;
      expect(replies[call].includes("$9/month"), `price on call ${call + 1}`).toBe(pricey);
    }
    expect(replies[0]).toContain(`${PREVIEW_CALLS - 1} of ${PREVIEW_CALLS} Pro calls left`);
    expect(replies[PREVIEW_CALLS - 1]).toContain("the last of your");
    expect(replies[PREVIEW_CALLS]).toContain("Release notes generation requires Pro");
    expect(replies[PREVIEW_CALLS]).toContain(`You have used the ${PREVIEW_CALLS} free Pro calls`);
  }, 40_000);

  it("gives a subscriber the tool's own reply and nothing else, however often they call", async () => {
    const { replies, home } = await releaseNotesReplies(PREVIEW_CALLS + 2, "pro");
    for (const reply of replies) {
      expect(reply).not.toContain("preview");
      expect(reply).not.toContain("$9");
      expect(reply).not.toContain("requires Pro");
      expect(reply).toBe(replies[0]);
    }
    expect(existsSync(join(home, ".asc-mcp", "preview.json"))).toBe(false);
  }, 40_000);
});

/**
 * A previewed call still runs with the tier "free". The briefing used to branch
 * on that after the gate and swap the reviews for an upgrade line, so a preview
 * would have spent a call on a briefing with its main content cut out.
 */
describe("a previewed briefing is the whole briefing", () => {
  const client = {
    get: async (path: string) => {
      if (path === "/v1/apps") return { data: [{ id: "1", attributes: { name: "Demo", bundleId: "com.demo" } }] };
      if (path.endsWith("/appStoreVersions")) {
        return { data: [{ id: "v", attributes: { versionString: "1.0", appStoreState: "READY_FOR_SALE" } }] };
      }
      return {
        data: [
          {
            id: "r",
            attributes: {
              rating: 1,
              title: "Crashes on launch",
              body: "x",
              reviewerNickname: "n",
              territory: "USA",
              createdDate: new Date().toISOString(),
            },
          },
        ],
      };
    },
  };

  async function briefing(tier: "free" | "pro"): Promise<string> {
    const { dailyBriefing } = await import("../src/tools/daily-briefing.js");
    return previewScope.run({ grant: null }, () => dailyBriefing(client as never, {}, tier));
  }

  it("shows the reviews, and is word for word what a subscriber gets", async () => {
    freshHome();
    const preview = await briefing("free");
    expect(preview).toContain("Crashes on launch");
    expect(preview.toLowerCase()).not.toContain("upgrade");
    expect(preview).toBe(await briefing("pro"));
  });
});
