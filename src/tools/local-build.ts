import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

/** Run a binary with arg array (no shell), capture output, with a timeout. */
function run(
  cmd: string,
  cmdArgs: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      cmdArgs,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 20 * 60_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout || ""}${stderr || ""}`;
        resolve({ ok: !err, out });
      },
    );
  });
}

function tail(s: string, n = 1200): string {
  return s.length > n ? "..." + s.slice(-n) : s;
}

/**
 * Archive and export a signed .ipa via xcodebuild. Requires Xcode on the
 * user's Mac. Needs a scheme and an ExportOptions.plist (method app-store-connect).
 */
export async function buildAndArchive(
  args: {
    project_path: string;
    scheme: string;
    export_options_plist: string;
    workspace?: boolean;
    configuration?: string;
    output_dir?: string;
  },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Building and archiving", "build_and_archive");
  if (gate) return gate;

  const xcodebuild = await run("xcrun", ["-f", "xcodebuild"]);
  if (!xcodebuild.ok) {
    return "xcodebuild not found. Install Xcode and run `xcode-select --install`.";
  }
  if (!existsSync(args.project_path)) return `Project not found: ${args.project_path}`;
  if (!existsSync(args.export_options_plist)) {
    return `ExportOptions.plist not found: ${args.export_options_plist}`;
  }

  const outDir = args.output_dir || join(process.cwd(), "build");
  const archivePath = join(outDir, `${args.scheme}.xcarchive`);
  const projectFlag = args.workspace ? "-workspace" : "-project";

  const archive = await run("xcodebuild", [
    "archive",
    projectFlag, args.project_path,
    "-scheme", args.scheme,
    "-configuration", args.configuration || "Release",
    "-archivePath", archivePath,
    "-destination", "generic/platform=iOS",
    "-allowProvisioningUpdates",
  ]);
  if (!archive.ok) {
    return `Archive failed:\n${tail(archive.out)}`;
  }

  const exported = await run("xcodebuild", [
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportOptionsPlist", args.export_options_plist,
    "-exportPath", outDir,
  ]);
  if (!exported.ok) {
    return `Export failed:\n${tail(exported.out)}`;
  }

  const ipa = readdirSync(outDir).find((f) => f.endsWith(".ipa"));
  if (!ipa) return `Export reported success but no .ipa found in ${outDir}.`;
  return (
    `Built and exported ${ipa}\n` +
    `Path: ${join(outDir, ipa)}\n` +
    "Upload it with upload_binary (confirm:true)."
  );
}

/**
 * Upload a signed .ipa to App Store Connect via xcrun altool, authenticating
 * with the same API key. Outward-facing: requires confirm:true.
 */
export async function uploadBinary(
  config: { keyId: string; issuerId: string },
  args: { ipa_path: string; platform?: string; confirm?: boolean },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Uploading a binary", "upload_binary");
  if (gate) return gate;
  if (!args.confirm) {
    return "This uploads a binary to App Store Connect (outward-facing). Re-run with confirm: true.";
  }
  if (!existsSync(args.ipa_path)) return `IPA not found: ${args.ipa_path}`;

  const altool = await run("xcrun", ["-f", "altool"]);
  if (!altool.ok) return "altool not found. Install Xcode command line tools.";

  const platform = args.platform || "ios";
  const result = await run("xcrun", [
    "altool",
    "--upload-app",
    "-f", args.ipa_path,
    "-t", platform,
    "--apiKey", config.keyId,
    "--apiIssuer", config.issuerId,
  ]);
  if (!result.ok) {
    return `Upload failed:\n${tail(result.out)}`;
  }
  return (
    "Binary uploaded. Apple is now processing it (usually 5 to 30 min).\n" +
    "Run wait_for_build to block until it shows VALID (or list_builds to check once), then attach_build."
  );
}
