import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { REQUIRED_REASON_CATEGORIES, type RequiredReasonCategory } from "./apple-lists.js";
import { parsePlist } from "./plist.js";

const run = promisify(execFile);

/** Bounds on tools reading a built app. `nm` on a large binary takes seconds, not minutes. */
const TOOL_TIMEOUT_MS = 20_000;
const TOOL_MAX_OUTPUT = 64 * 1024 * 1024;
/** Where Xcode-driven builds land inside a project, and how far down to look. */
const BUILD_OUTPUT_DIR = /^(build|derived_?data|archives?)([-_.].*)?$/i;
const BUILD_SEARCH_DEPTH = 6;

/**
 * The executable inside an app, named by its own Info.plist. An app folder with
 * no executable is what a failed or cleaned build leaves behind.
 */
async function executableOf(appPath: string): Promise<string | null> {
  const infoPath = [join(appPath, "Info.plist"), join(appPath, "Contents", "Info.plist")].find((p) => existsSync(p));
  if (!infoPath) return null;
  const info = parsePlist(await plistAsXml(infoPath));
  const name = typeof info === "object" && !Array.isArray(info) ? info.CFBundleExecutable : undefined;
  if (typeof name !== "string") return null;
  return [join(appPath, name), join(appPath, "Contents", "MacOS", name)].find((p) => existsSync(p)) ?? null;
}

/** How close a build is to what gets submitted. An archive is what gets uploaded. */
function buildRank(path: string): number {
  if (path.includes(".xcarchive")) return 2;
  return /Release-/.test(path) ? 1 : 0;
}

/** Finds the build closest to what gets submitted, newest first within a kind. */
export async function findBuiltApp(root: string): Promise<string | null> {
  if (root.endsWith(".app")) return root;
  const found: Array<{ path: string; mtime: number }> = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > BUILD_SEARCH_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.name.endsWith(".app")) {
        // Simulator builds carry different symbols, and test runners are not the app.
        if (/iphonesimulator|-Runner\.app$/i.test(full)) continue;
        if (await executableOf(full)) found.push({ path: full, mtime: (await stat(full)).mtimeMs });
        continue;
      }
      if (!/^(SourcePackages|Index\.noindex|Intermediates\.noindex|\.git|node_modules)$/.test(entry.name)) await visit(full, depth + 1);
    }
  };
  if (root.endsWith(".xcarchive")) await visit(root, 0);
  else {
    const top = await readdir(root, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && BUILD_OUTPUT_DIR.test(entry.name)) await visit(join(root, entry.name), 0);
    }
  }
  found.sort((a, b) => buildRank(b.path) - buildRank(a.path) || b.mtime - a.mtime);
  return found[0]?.path ?? null;
}

/** A property list as XML whichever format it is on disk. macOS only. */
export async function plistAsXml(path: string): Promise<string> {
  const { stdout } = await run("plutil", ["-convert", "xml1", "-o", "-", "--", path], { timeout: TOOL_TIMEOUT_MS, maxBuffer: TOOL_MAX_OUTPUT });
  return stdout;
}

/** Categories whose APIs the app's own executable imports. Reads symbols; runs nothing. */
export async function scanExecutable(appPath: string): Promise<RequiredReasonCategory[]> {
  const executable = await executableOf(appPath);
  if (!executable) throw new Error("its Info.plist names no executable that exists");
  const { stdout } = await run("nm", ["-u", "--", executable], { timeout: TOOL_TIMEOUT_MS, maxBuffer: TOOL_MAX_OUTPUT });
  const symbols = stdout.split("\n").map((l) => l.trim());
  const exact = new Set(symbols);
  const hits: RequiredReasonCategory[] = [];
  for (const [category, data] of Object.entries(REQUIRED_REASON_CATEGORIES)) {
    const fragments = ("symbolFragments" in data ? data.symbolFragments : []) as readonly string[];
    const used = (data.symbols as readonly string[]).some((s) => exact.has(s)) || symbols.some((sym) => fragments.some((f) => sym.includes(f)));
    if (used) hits.push(category as RequiredReasonCategory);
  }
  return hits;
}
/** Frameworks inside the app, each with whether it carries a privacy manifest. */
export async function listEmbeddedFrameworks(appPath: string, root: string): Promise<Array<{ name: string; hasManifest: boolean; rel: string }>> {
  const dir = join(appPath, "Frameworks");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.name.endsWith(".framework"))
    .map((e) => {
      const full = join(dir, e.name);
      const hasManifest = existsSync(join(full, "PrivacyInfo.xcprivacy")) || existsSync(join(full, "Resources", "PrivacyInfo.xcprivacy"));
      return { name: e.name.replace(/\.framework$/, ""), hasManifest, rel: relative(root, full).split(sep).join("/") };
    });
}
