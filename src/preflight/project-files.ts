import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Bounded, read-only walk of a project. Stays under the root by never following
 * a symlink: `lstat` sees the link itself, so a link pointing out of the project
 * is skipped rather than read. Nothing here runs anything from the project.
 */

/** Generated or third-party folders. An SDK's own use is the SDK's own manifest to declare. */
const SKIP_DIRS = new Set([
  "node_modules", "Pods", "Carthage", "SourcePackages", "dist", "vendor", "android", "__pycache__", "venv",
]);
/** Build output under any name a project's scripts chose: build-release, DerivedData-ci. */
const BUILD_DIR = /^(build|derived_?data|archives?)([-_.].*)?$/i;
/** Test targets are not in the submitted binary. */
const TEST_DIR = /(Tests?|UITests?|Specs?)$|^Test|Testing$/;
/** Bundles and assets hold nothing a source scan reads. */
const OPAQUE_DIR = /\.(xcassets|xcarchive|app|framework|xcframework|bundle|lproj|xcworkspace)$/;

/** Bounds for a large monorepo. Hitting one is reported, since absence then proves nothing. */
export const SCAN_LIMITS = { maxFiles: 20_000, maxDepth: 12, maxFileBytes: 2 * 1024 * 1024, maxMillis: 20_000 } as const;

export const SOURCE_FILE = /\.(swift|m|mm|c|cc|cpp)$/;
const INTERESTING_FILE =
  /(\.(swift|m|mm|c|cc|cpp|xcprivacy|pbxproj|xcconfig|plist)|^Info\.plist|^project\.yml|^project\.yaml|^app\.json|^Package\.swift|^Package\.resolved|^Podfile|^Podfile\.lock|^Cartfile\.resolved|^pubspec\.lock)$/;

export interface ProjectFile {
  /** Absolute path, for reading. */
  path: string;
  /** Relative to the root, for printing. */
  rel: string;
  name: string;
}

export interface WalkResult {
  files: ProjectFile[];
  truncated: string | null;
}

export async function walkProject(root: string): Promise<WalkResult> {
  const files: ProjectFile[] = [];
  let truncated: string | null = null;
  let seen = 0;
  const started = Date.now();
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (Date.now() - started > SCAN_LIMITS.maxMillis) {
      truncated = `the scan stopped after ${SCAN_LIMITS.maxMillis / 1000} seconds`;
      return;
    }
    if (depth > SCAN_LIMITS.maxDepth) {
      truncated = `folders deeper than ${SCAN_LIMITS.maxDepth} levels were not read`;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Hidden folders go too. Xcode keeps project.pbxproj inside the .xcodeproj,
        // which is not skipped, because that file is wanted.
        if (SKIP_DIRS.has(entry.name) || BUILD_DIR.test(entry.name) || TEST_DIR.test(entry.name) || OPAQUE_DIR.test(entry.name) || entry.name.startsWith(".")) continue;
        await visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++seen > SCAN_LIMITS.maxFiles) {
        truncated = `the scan stopped at ${SCAN_LIMITS.maxFiles} files`;
        return;
      }
      if (INTERESTING_FILE.test(entry.name)) files.push({ path: full, rel: relative(root, full).split(sep).join("/"), name: entry.name });
    }
  };
  await visit(root, 0);
  return { files, truncated };
}

/**
 * Whether a file of this name sits anywhere under a folder. For an SDK's own
 * folder, where the manifest is usually inside a .bundle or .xcframework that the
 * source walk rightly skips. Symlinks are still not followed. Null when the
 * search ran out, because then "not found" would be a guess.
 */
export async function containsFile(dir: string, name: string): Promise<boolean | null> {
  let budget = SCAN_LIMITS.maxFiles;
  const visit = async (current: string, depth: number): Promise<boolean | null> => {
    if (depth > SCAN_LIMITS.maxDepth) return null;
    let incomplete = false;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (--budget < 0) return null;
      if (entry.isFile() && entry.name === name) return true;
      if (entry.isDirectory()) {
        const found = await visit(join(current, entry.name), depth + 1);
        if (found) return true;
        if (found === null) incomplete = true;
      }
    }
    return incomplete ? null : false;
  };
  return visit(dir, 0);
}

/** Reads a file only if it is a regular file within the size bound; otherwise null. */
export async function readBounded(path: string): Promise<string | null> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > SCAN_LIMITS.maxFileBytes) return null;
  return readFile(path, "utf8");
}

/** Removes comments so a mention in a note is not read as a use of the API. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
}

/** 1-based line of a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
