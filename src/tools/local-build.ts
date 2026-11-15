import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

/** The CFBundleVersion inside an .ipa, or null when it cannot be read. Used to tell wait_for_build which build to wait for. */
async function ipaBuildNumber(ipaPath: string): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "asc-ipa-"));
  try {
    const unzip = await run("unzip", ["-o", "-q", ipaPath, "Payload/*.app/Info.plist", "-d", dir], { timeoutMs: 60_000 });
    if (!unzip.ok || !existsSync(join(dir, "Payload"))) return null;
    const app = readdirSync(join(dir, "Payload")).find((f) => f.endsWith(".app"));
    if (!app) return null;
    const plist = await run("plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", join(dir, "Payload", app, "Info.plist")], { timeoutMs: 30_000 });
    const value = plist.out.trim();
    return plist.ok && /^\d+(\.\d+){0,2}$/.test(value) ? value : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    /**
     * Command to run before archiving, as an argument array (no shell), for
     * example ["xcodegen", "generate"] or ["tuist", "generate", "--no-open"].
     * Runs in the project's folder. Generated projects must be regenerated
     * after any project.yml or Project.swift change, or xcodebuild builds a
     * stale project.
     */
    pre_build_command?: string[];
  },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Building and archiving", "build_and_archive");
  if (gate) return gate;

  const xcodebuild = await run("xcrun", ["-f", "xcodebuild"]);
  if (!xcodebuild.ok) {
    return "xcodebuild not found. Install Xcode and run `xcode-select --install`.";
  }
  if (!existsSync(args.project_path)) {
    return (
      `Project not found: ${args.project_path}. Nothing was built. ` +
      "The AI calls build_and_archive again with project_path set to the full path of the .xcodeproj, or of the .xcworkspace together with workspace: true."
    );
  }
  if (!existsSync(args.export_options_plist)) {
    return (
      `ExportOptions.plist not found: ${args.export_options_plist}. Nothing was built. ` +
      "The AI calls setup_app_store_signing to create one, then calls build_and_archive again with export_options_plist set to the path it prints."
    );
  }

  if (args.pre_build_command?.length) {
    const [cmd, ...rest] = args.pre_build_command;
    const pre = await run(cmd, rest, { cwd: dirname(args.project_path) });
    if (!pre.ok) {
      return (
        `The pre-build command (${args.pre_build_command.join(" ")}) failed, so nothing was archived:\n${tail(pre.out)}\n\n` +
        "The human fixes the project definition or installs the tool, then the AI calls build_and_archive again."
      );
    }
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
    return (
      `Archive failed, so no .ipa was made:\n${tail(archive.out)}\n\n` +
      "If the log mentions signing or provisioning, the AI calls setup_app_store_signing and then build_and_archive again. " +
      "If it shows a code or build error, the human fixes it in Xcode, then the AI calls build_and_archive again."
    );
  }

  // Export into a folder made for this run, so the .ipa we return is the one
  // this export produced and never an older build left in output_dir.
  const exportDir = join(outDir, `export-${Date.now()}`);
  const exportStarted = Date.now() - 1000;
  // -allowProvisioningUpdates is harmless with the manual signing that
  // setup_app_store_signing writes (Xcode ignores it), and helps automatic signing.
  const exported = await run("xcodebuild", [
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportOptionsPlist", args.export_options_plist,
    "-exportPath", exportDir,
    "-allowProvisioningUpdates",
  ]);
  if (!exported.ok) {
    return (
      `Export failed. The archive was built but no .ipa was made:\n${tail(exported.out)}\n\n` +
      "This is usually a signing mismatch. The AI calls setup_app_store_signing to regenerate ExportOptions.plist, then build_and_archive again with the path it prints."
    );
  }

  const ipas = existsSync(exportDir)
    ? readdirSync(exportDir)
        .filter((f) => f.endsWith(".ipa"))
        .map((f) => ({ f, mtime: statSync(join(exportDir, f)).mtimeMs }))
        .filter((x) => x.mtime >= exportStarted)
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  if (!ipas.length) return `Export reported success but produced no .ipa in ${exportDir}.`;
  const ipa = ipas[0].f;
  return (
    `Built and exported ${ipa}\n` +
    `Path: ${join(exportDir, ipa)}\n` +
    (args.pre_build_command?.length
      ? `Ran ${args.pre_build_command.join(" ")} before building.\n`
      : "Note: build_and_archive builds the project file as it is on disk. A project generated by xcodegen or tuist must be generated first (pass pre_build_command, for example [\"xcodegen\", \"generate\"]), or the build is stale.\n") +
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
  if (!existsSync(args.ipa_path)) {
    return `IPA not found: ${args.ipa_path}. Nothing was uploaded. The AI runs build_and_archive first, then calls upload_binary with ipa_path set to the .ipa path it prints.`;
  }

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
    return (
      `Upload failed, so Apple has no new build:\n${tail(result.out)}\n\n` +
      "If the log says the bundle version was already used, the human raises the build number (CFBundleVersion) where the project defines it: in Xcode, in the project file, in a build setting such as CURRENT_PROJECT_VERSION (for a generated project, in project.yml or Project.swift, then regenerate), or in Info.plist. Then the AI runs build_and_archive and upload_binary again. " +
      "Otherwise the AI calls upload_binary again with confirm: true."
    );
  }
  const buildNumber = await ipaBuildNumber(args.ipa_path);
  return (
    `Binary uploaded${buildNumber ? ` (build ${buildNumber})` : ""}. Apple is now processing it (usually 5 to 30 min).\n` +
    (buildNumber
      ? `Run wait_for_build with build_number "${buildNumber}" (Apple lists a new upload only after a few minutes, so without it the newest listed build can be an older one), then attach_build with the build id it returns.`
      : "Run wait_for_build with build_number set to this upload's CFBundleVersion (Apple lists a new upload only after a few minutes, so without it the newest listed build can be an older one), then attach_build with the build id it returns.")
  );
}
