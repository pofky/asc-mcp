/**
 * Fixes found while planning Douse's release: build_and_archive returns its own
 * .ipa, upload_screenshots checks sizes and delivery, set_age_rating shows
 * everything it wrote. Fake clients and a fake xcodebuild, no Apple calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execCalls: { cmd: string; args: string[]; cwd?: string }[] = [];
let failOn: string | null = null;
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: { cwd?: string }, cb: (e: Error | null, o: string, s: string) => void) => {
    execCalls.push({ cmd, args, cwd: opts?.cwd });
    const key = args[0] === "-exportArchive" ? "export" : args[0];
    if (failOn && (failOn === key || failOn === cmd)) return cb(new Error("x"), "", "boom");
    if (args.includes("-exportArchive")) {
      const dir = args[args.indexOf("-exportPath") + 1];
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "New.ipa"), "x");
    }
    cb(null, "ok", "");
  },
}));

import { buildAndArchive, uploadBinary } from "../src/tools/local-build.js";
import { uploadScreenshots, sizeRefusal } from "../src/tools/screenshots.js";
import { setAgeRating } from "../src/tools/age-rating.js";
import { readImageSize } from "../src/image-size.js";

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0]);
}

describe("build_and_archive", () => {
  let dir: string;
  let plist: string;
  beforeEach(() => {
    execCalls.length = 0;
    failOn = null;
    dir = mkdtempSync(join(tmpdir(), "bb-"));
    writeFileSync(join(dir, "A.xcodeproj"), "");
    plist = join(dir, "E.plist");
    writeFileSync(plist, "");
  });
  const base = () => ({ project_path: join(dir, "A.xcodeproj"), scheme: "A", export_options_plist: plist, output_dir: join(dir, "out") });

  it("returns the .ipa this export made, not an older one in output_dir", async () => {
    mkdirSync(join(dir, "out"), { recursive: true });
    writeFileSync(join(dir, "out", "Old.ipa"), "old");
    utimesSync(join(dir, "out", "Old.ipa"), 1000, 1000);
    const out = await buildAndArchive(base(), "pro");
    expect(out).toContain("New.ipa");
    expect(out).not.toContain("Old.ipa");
    expect(out).toContain("xcodegen");
    const exp = execCalls.find((c) => c.args.includes("-exportArchive"))!;
    expect(exp.args).toContain("-allowProvisioningUpdates");
    expect(execCalls.find((c) => c.args[0] === "archive")!.args).toContain("-allowProvisioningUpdates");
  });

  it("runs pre_build_command first in the project folder, without a shell", async () => {
    await buildAndArchive({ ...base(), pre_build_command: ["xcodegen", "generate"] }, "pro");
    const gen = execCalls.findIndex((c) => c.cmd === "xcodegen");
    const arch = execCalls.findIndex((c) => c.args[0] === "archive");
    expect(gen).toBeGreaterThan(-1);
    expect(gen).toBeLessThan(arch);
    expect(execCalls[gen].args).toEqual(["generate"]);
    expect(execCalls[gen].cwd).toBe(dir);
  });

  it("stops before archiving when the pre-build command fails", async () => {
    failOn = "xcodegen";
    const out = await buildAndArchive({ ...base(), pre_build_command: ["xcodegen", "generate"] }, "pro");
    expect(out).toContain("failed");
    expect(execCalls.some((c) => c.args[0] === "archive")).toBe(false);
  });

  it("names project files and build settings when a build number was reused", async () => {
    const ipa = join(dir, "x.ipa");
    writeFileSync(ipa, "");
    failOn = "altool";
    const out = await uploadBinary({ keyId: "k", issuerId: "i" }, { ipa_path: ipa, confirm: true }, "pro");
    expect(out).toContain("Upload failed");
    expect(out).toContain("CURRENT_PROJECT_VERSION");
    expect(out).toContain("project.yml");
  });
});

describe("image size", () => {
  it("reads PNG and JPEG headers", () => {
    expect(readImageSize(png(1290, 2796))).toEqual({ width: 1290, height: 2796 });
    expect(readImageSize(jpeg(1320, 2868))).toEqual({ width: 1320, height: 2868 });
    expect(readImageSize(Buffer.from("nope"))).toBeNull();
  });
  it("accepts landscape, refuses a wrong size naming the accepted ones", () => {
    expect(sizeRefusal("APP_IPHONE_67", "a.png", png(2796, 1290))).toBeNull();
    const r = sizeRefusal("APP_IPHONE_67", "a.png", png(1206, 2622))!;
    expect(r).toContain("1206x2622");
    expect(r).toContain("1290x2796");
    expect(sizeRefusal("APP_IPHONE_67", "a.png", Buffer.from("junk"))).toBeNull();
    expect(sizeRefusal("APP_SOMETHING_NEW", "a.png", png(1, 1))).toBeNull();
  });
});

describe("upload_screenshots", () => {
  function fake(opts: { existing?: string[]; state?: string; errors?: unknown[] }) {
    const calls: { method: string; path: string }[] = [];
    const client = {
      get: async (path: string) => {
        calls.push({ method: "GET", path });
        if (path.endsWith("/appStoreVersions")) return { data: [{ id: "V", attributes: { versionString: "1.0", appStoreState: "PREPARE_FOR_SUBMISSION", platform: "IOS" } }] };
        if (path.endsWith("/appStoreVersionLocalizations")) return { data: [{ id: "L", attributes: { locale: "en-US" } }] };
        if (path.endsWith("/appScreenshotSets")) return { data: [{ id: "S", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }] };
        if (path.endsWith("/appScreenshots")) return { data: (opts.existing ?? []).map((id) => ({ id })) };
        if (path.startsWith("/v1/appScreenshots/")) return { data: { id: "N1", attributes: { assetDeliveryState: { state: opts.state ?? "COMPLETE", errors: opts.errors } } } };
        return { data: [] };
      },
      post: async (path: string) => (calls.push({ method: "POST", path }), { data: { id: "N1", attributes: { uploadOperations: [] } } }),
      patch: async (path: string) => (calls.push({ method: "PATCH", path }), null),
      del: async (path: string) => (calls.push({ method: "DELETE", path }), null),
    } as never;
    return { client, calls };
  }
  const file = (w: number, h: number) => {
    const p = join(mkdtempSync(join(tmpdir(), "ss-")), "1.png");
    writeFileSync(p, png(w, h));
    return p;
  };
  const poll = { attempts: 2, delayMs: 0 };

  it("refuses a bad size before any call", async () => {
    const f = fake({});
    const out = await uploadScreenshots(f.client, { app_id: "1", display_type: "APP_IPHONE_67", files: [file(1206, 2622)] }, "pro", poll);
    expect(out).toContain("does not accept");
    expect(f.calls).toHaveLength(0);
  });

  it("replace without confirm deletes nothing", async () => {
    const f = fake({ existing: ["O1", "O2"] });
    const out = await uploadScreenshots(f.client, { app_id: "1", display_type: "APP_IPHONE_67", files: [file(1290, 2796)], replace: true }, "pro", poll);
    expect(out).toContain("confirm: true");
    expect(f.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("replace with confirm deletes first, then uploads and reports COMPLETE", async () => {
    const f = fake({ existing: ["O1", "O2"] });
    const out = await uploadScreenshots(f.client, { app_id: "1", display_type: "APP_IPHONE_67", files: [file(1290, 2796)], replace: true, confirm: true }, "pro", poll);
    const writes = f.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(writes.slice(0, 2)).toEqual(["DELETE /v1/appScreenshots/O1", "DELETE /v1/appScreenshots/O2"]);
    expect(writes).toContain("POST /v1/appScreenshots");
    expect(out).toContain("Deleted 2");
    expect(out).toContain("COMPLETE");
  });

  it("reports a failed delivery instead of claiming success", async () => {
    const f = fake({ state: "FAILED", errors: [{ code: "IMAGE_ALPHA", description: "alpha channel" }] });
    const out = await uploadScreenshots(f.client, { app_id: "1", display_type: "APP_IPHONE_67", files: [file(1290, 2796)] }, "pro", poll);
    expect(out).toContain("FAILED");
    expect(out).toContain("alpha channel");
    expect(out).toContain("rejected");
    expect(out).not.toContain("finished processing");
  });

  it("says unconfirmed when still processing", async () => {
    const f = fake({ state: "UPLOAD_COMPLETE" });
    const out = await uploadScreenshots(f.client, { app_id: "1", display_type: "APP_IPHONE_67", files: [file(1290, 2796)] }, "pro", poll);
    expect(out).toContain("not confirmed");
  });
});

describe("set_age_rating", () => {
  function fake(current: Record<string, unknown>, rating?: string) {
    let patched: Record<string, unknown> | null = null;
    const client = {
      get: async (path: string) => {
        if (path.endsWith("/appInfos"))
          return {
            data: [{ id: "AI", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" }, relationships: { ageRatingDeclaration: { data: { id: "AR" } } } }],
            included: [{ type: "ageRatingDeclarations", id: "AR", attributes: current }],
          };
        if (path === "/v1/appInfos/AI") return { data: { id: "AI", attributes: rating ? { appStoreAgeRating: rating } : {} } };
        return { data: [] };
      },
      patch: async (_p: string, body: { data: { attributes: Record<string, unknown> } }) => ((patched = body.data.attributes), null),
    } as never;
    return { client, patched: () => patched };
  }

  it("lists defaults, warns on a fresh app, reads back the computed rating on the current scale", async () => {
    const f = fake({}, "THIRTEEN_PLUS");
    const out = await setAgeRating(f.client, { app_id: "1", declarations: { medicalOrTreatmentInformation: "INFREQUENT_OR_MILD" } }, "pro");
    expect(out).toContain("medicalOrTreatmentInformation = INFREQUENT_OR_MILD");
    expect(out).toContain("gambling = false (default written");
    expect(out).toContain("violenceRealistic = NONE (default written");
    expect(out).toContain("Warning");
    expect(out).toContain("THIRTEEN_PLUS");
    expect(out).toContain("13+/16+/18+");
    expect(out).not.toContain("12+");
    expect(Object.keys(f.patched()!).length).toBeGreaterThan(20);
  });

  it("no fresh-app warning when answers already exist; says so when no rating is exposed", async () => {
    const f = fake({ violenceRealistic: "NONE", gambling: false });
    const out = await setAgeRating(f.client, { app_id: "1", declarations: { gambling: true } }, "pro");
    expect(out).not.toContain("Warning");
    expect(out).toContain("kept current value");
    expect(out).toContain("did not return the computed rating");
  });
});
