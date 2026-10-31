import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  LISTED_SDKS,
  PLACEHOLDER_PLIST_VALUES,
  PURPOSE_KEY_PATTERN,
  PURPOSE_STRINGS,
  REQUIRED_REASON_CATEGORIES,
  SDK_PACKAGE_ALIASES,
  SIGN_IN_PATTERNS,
} from "./apple-lists.js";
import { findBuiltApp, listEmbeddedFrameworks, plistAsXml, scanExecutable } from "./binary-scan.js";
import { parsePlist, readManifest, type PlistValue } from "./plist.js";
import { containsFile, lineAt, readBounded, SOURCE_FILE, stripComments, walkProject, type ProjectFile } from "./project-files.js";
import { failedPart, okPart, type ApiUse, type ProjectInput, type ProjectManifest, type ProjectScan, type PurposeUse, type SdkUse } from "./types.js";

const MESSAGE_CHARS = 120;

/** Files that say a folder is an app project, even with no source in it yet. */
const PROJECT_MARKER = /^(project\.pbxproj|Package\.swift|project\.ya?ml|Podfile(\.lock)?|pubspec\.lock|app\.json|PrivacyInfo\.xcprivacy|Info\.plist)$/;

class NoProjectHere extends Error {}

const sdkByLowerName = new Map(LISTED_SDKS.map((s) => [s.toLowerCase(), s]));
const message = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, MESSAGE_CHARS);

function resolveInput(input: string): string {
  const expanded = input === "~" || input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

function scanSource(file: ProjectFile, text: string, apis: Map<string, ApiUse>, purposes: Map<string, PurposeUse>, signIn: { at: string | null }): void {
  const code = stripComments(text);
  const where = (index: number) => `${file.rel}:${lineAt(code, index)}`;
  for (const [category, data] of Object.entries(REQUIRED_REASON_CATEGORIES)) {
    const strong = data.source.map((p) => code.search(p)).find((i) => i >= 0);
    if (strong !== undefined) {
      if (apis.get(category)?.strength !== "strong") apis.set(category, { category, strength: "strong", where: where(strong) });
      continue;
    }
    if (apis.has(category)) continue;
    const weak = (data.weakSource as readonly RegExp[]).map((p) => code.search(p)).find((i) => i >= 0);
    if (weak !== undefined) apis.set(category, { category, strength: "weak", where: where(weak) });
  }
  for (const purpose of PURPOSE_STRINGS) {
    if (purposes.has(purpose.api)) continue;
    const at = code.search(purpose.pattern);
    if (at >= 0) purposes.set(purpose.api, { keys: purpose.keys, api: purpose.api, where: where(at) });
  }
  if (!signIn.at) {
    const at = SIGN_IN_PATTERNS.map((p) => code.search(p)).find((i) => i >= 0);
    if (at !== undefined) signIn.at = where(at);
  }
}

/** Records every purpose key in an Info.plist, and any sample value left in it. Never the values. */
function readInfoPlist(root: PlistValue, where: string, keys: Record<string, boolean>, placeholders: ProjectScan["placeholderKeys"]): void {
  if (typeof root !== "object" || root === null || Array.isArray(root)) return;
  for (const [key, value] of Object.entries(root)) {
    if (PURPOSE_KEY_PATTERN.test(key)) keys[key] = keys[key] || (typeof value === "string" && value.trim().length > 0);
    if (typeof value === "string" && PLACEHOLDER_PLIST_VALUES.some((p) => p.test(value))) placeholders.push({ key, where });
  }
}

/**
 * Purpose keys defined outside an Info.plist: Xcode's generated-plist build
 * settings (INFOPLIST_KEY_NSCameraUsageDescription = "...") and XcodeGen. The
 * text is checked for being non-empty and goes no further.
 */
function readBuildSettingKeys(text: string, keys: Record<string, boolean>): void {
  for (const m of text.matchAll(/\b(?:INFOPLIST_KEY_)?((?:NS[A-Za-z]+|NFCReader)UsageDescription)["']?\s*[:=]\s*(.*)/g)) {
    const value = m[2].replace(/[;,]\s*$/, "").replace(/^["']|["']$/g, "").trim();
    keys[m[1]] = keys[m[1]] || value.length > 0;
  }
}

/** The device family of the target building this bundle id, from project.pbxproj. */
function deviceFamilyFor(pbxproj: string, bundleId: string): boolean | null {
  let answer: boolean | null = null;
  for (const block of pbxproj.matchAll(/buildSettings = \{([\s\S]*?)\n\s*\};/g)) {
    const rawId = block[1].match(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/)?.[1];
    // XcodeGen projects often hold the id in a variable set elsewhere in the file.
    const variable = rawId?.match(/^\$[({](\w+)[)}]$/)?.[1];
    const id = variable ? pbxproj.match(new RegExp(`\\b${variable} = "?([\\w.-]+)"?;`))?.[1] : rawId;
    const family = block[1].match(/TARGETED_DEVICE_FAMILY = "?([\d,]+)"?;/)?.[1];
    if (id !== bundleId || !family) continue;
    const universal = family.split(",").includes("2");
    answer = (answer ?? false) || universal;
  }
  return answer;
}

/** Every bundle id a project file builds, with variables resolved where the file defines them. */
function bundleIdsIn(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER["']?\s*[:=]\s*"?([^";\n]+)"?/g)) {
    const raw = m[1].trim();
    const variable = raw.match(/^\$[({](\w+)[)}]$/)?.[1];
    const id = variable ? text.match(new RegExp(`\\b${variable}["']?\\s*[:=]\\s*"?([\\w.-]+)"?`))?.[1] : raw;
    if (id && !id.includes("$")) ids.push(id);
  }
  return ids;
}

const IMPORT_VIA = "an import in the source";

function dependenciesIn(file: ProjectFile, text: string): Array<{ name: string; via: string; repo: string }> {
  const out: Array<{ name: string; via: string; repo: string }> = [];
  const add = (raw: string, via: string) => {
    const lower = raw.toLowerCase();
    const listed = sdkByLowerName.get(lower) ?? SDK_PACKAGE_ALIASES[lower];
    if (listed) out.push({ name: listed, via, repo: raw });
  };
  if (file.name === "Podfile.lock") {
    const section = text.split(/^DEPENDENCIES:/m)[0];
    for (const m of section.matchAll(/^ {2}- "?([A-Za-z0-9_+.-]+)(?:\/[^\s"]*)?(?: \([^)]*\))?"?:?$/gm)) add(m[1], "Podfile.lock");
  } else if (file.name === "Podfile") {
    // A repo that does not commit its lock file has only this. Subspecs name the
    // real library: pod 'Firebase/Analytics' ships FirebaseAnalytics.
    for (const m of text.matchAll(/^\s*pod\s+['"]([A-Za-z0-9_+.-]+)(?:\/([A-Za-z0-9_+.-]+))?['"]/gm)) {
      add(m[1], "Podfile");
      if (m[2]) add(`${m[1]}${m[2]}`, "Podfile");
    }
  } else if (/\.(swift|m|mm)$/.test(file.name)) {
    // Last resort, for a vendored framework no dependency file mentions.
    for (const m of text.matchAll(/^\s*(?:@?import\s+(?:class\s+|struct\s+|enum\s+|func\s+)?|#import\s+<)([A-Za-z0-9_]+)/gm)) add(m[1], IMPORT_VIA);
  } else if (file.name === "Package.resolved") {
    for (const m of text.matchAll(/"identity"\s*:\s*"([^"]+)"/g)) add(m[1], "Package.resolved");
    for (const m of text.matchAll(/"(?:repositoryURL|location)"\s*:\s*"[^"]*\/([^"/]+?)(?:\.git)?"/g)) add(m[1], "Package.resolved");
  } else if (file.name === "project.pbxproj") {
    for (const m of text.matchAll(/repositoryURL = "[^"]*\/([^"/]+?)(?:\.git)?";/g)) add(m[1], "the Xcode project");
  } else if (file.name === "Package.swift") {
    for (const m of text.matchAll(/url:\s*"[^"]*\/([^"/]+?)(?:\.git)?"/g)) add(m[1], "Package.swift");
  } else if (file.name === "Cartfile.resolved") {
    for (const m of text.matchAll(/^\w+ "[^"]*\/([^"/]+?)(?:\.git)?"/gm)) add(m[1], "Cartfile.resolved");
  } else if (file.name === "pubspec.lock") {
    for (const m of text.matchAll(/^ {2}([a-z0-9_]+):$/gm)) add(m[1], "pubspec.lock");
  }
  return out;
}

/** Whether a dependency's source sits in this project with a manifest in it. */
async function sdkManifestOnDisk(root: string, name: string, repo: string): Promise<"present" | "absent" | "not_on_disk"> {
  const top = await readdir(root, { withFileTypes: true });
  const checkouts = top
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && /^(\.?build|derived_?data)([-_.].*)?$/i.test(e.name))
    .flatMap((e) => [join(root, e.name, "SourcePackages", "checkouts", repo), join(root, e.name, "checkouts", repo)]);
  const dir = [join(root, "Pods", name), ...checkouts].find((p) => existsSync(p));
  if (!dir) return "not_on_disk";
  const found = await containsFile(dir, "PrivacyInfo.xcprivacy");
  if (found === null) return "not_on_disk";
  return found ? "present" : "absent";
}

async function scanBuiltApp(root: string, scan: ProjectScan, apis: Map<string, ApiUse>, sdks: Map<string, SdkUse>): Promise<void> {
  if (process.platform !== "darwin") {
    scan.binarySkipped = "Built apps can only be read on a Mac.";
    return;
  }
  const app = await findBuiltApp(root);
  if (!app) {
    scan.binarySkipped = "No built app under this folder. Source and plist rules ran; run an archive to include SDK code linked statically.";
    return;
  }
  const rel = app.startsWith(root) ? app.slice(root.length).replace(/^\//, "") || basename(app) : basename(app);
  scan.builtApp = rel;
  try {
    for (const category of await scanExecutable(app)) {
      apis.set(category, { category, strength: "strong", where: `the built app ${rel}` });
    }
  } catch (err) {
    scan.binaryUnreadable = `The built app's symbols could not be read: ${message(err)}`;
  }
  try {
    const infoPath = [join(app, "Info.plist"), join(app, "Contents", "Info.plist")].find((p) => existsSync(p));
    if (infoPath) readInfoPlist(parsePlist(await plistAsXml(infoPath)), `${rel}/Info.plist`, scan.purposeKeys, scan.placeholderKeys);
    const manifestPath = join(app, "PrivacyInfo.xcprivacy");
    if (existsSync(manifestPath)) {
      const parsed = readManifest(await plistAsXml(manifestPath));
      scan.manifests.push({ path: `${rel}/PrivacyInfo.xcprivacy`, parsed: okPart(parsed), inProject: true });
    }
    for (const fw of await listEmbeddedFrameworks(app, root)) {
      const listed = sdkByLowerName.get(fw.name.toLowerCase());
      if (listed) sdks.set(listed, { name: listed, via: fw.rel, manifest: fw.hasManifest ? "present" : "absent" });
    }
  } catch (err) {
    scan.binaryUnreadable = `The built app could not be fully read: ${message(err)}`;
  }
}

/** Scans a project folder. Throws only for a path that cannot be read at all. */
async function scanProject(root: string, bundleId: string | null): Promise<ProjectScan> {
  const scan: ProjectScan = {
    root,
    manifests: [],
    apis: [],
    purposes: [],
    purposeKeys: {},
    sdks: [],
    placeholderKeys: [],
    runsOnIpad: null,
    signInSeenAt: null,
    builtApp: null,
    binarySkipped: null,
    binaryUnreadable: null,
    truncated: null,
    otherApp: null,
    plistIssue: null,
  };
  const { files, truncated } = await walkProject(root);
  scan.truncated = truncated;

  const apis = new Map<string, ApiUse>();
  const purposes = new Map<string, PurposeUse>();
  const sdks = new Map<string, SdkUse>();
  const signIn: { at: string | null } = { at: null };
  const dependencies = new Map<string, { via: string; repo: string }>();
  const projectFiles: string[] = [];
  const skippedLarge: string[] = [];
  const builtIds: string[] = [];

  for (const file of files) {
    const text = await readBounded(file.path);
    if (text === null) {
      skippedLarge.push(file.rel);
      continue;
    }
    if (SOURCE_FILE.test(file.name)) {
      scanSource(file, text, apis, purposes, signIn);
      for (const dep of dependenciesIn(file, text)) {
        if (!dependencies.has(dep.name)) dependencies.set(dep.name, dep);
      }
    } else if (file.name.endsWith(".xcprivacy")) {
      let parsed: ProjectManifest["parsed"];
      try {
        parsed = okPart(readManifest(text));
      } catch (err) {
        parsed = failedPart(message(err));
      }
      scan.manifests.push({ path: file.rel, parsed, inProject: null });
    } else if (file.name.endsWith(".plist")) {
      // Only an app's own Info.plist, including the older App-Info.plist naming.
      // GoogleService-Info.plist and the like are configuration, not this.
      if (/^([A-Za-z0-9 ]+-)?Info\.plist$/.test(file.name) && !/^GoogleService/.test(file.name)) {
        try {
          readInfoPlist(parsePlist(text), file.rel, scan.purposeKeys, scan.placeholderKeys);
        } catch (err) {
          scan.plistIssue ??= `${file.rel} could not be read (${message(err)})`;
        }
      }
    } else {
      if (file.name === "project.pbxproj" || /^project\.ya?ml$/.test(file.name) || file.name.endsWith(".xcconfig") || file.name === "app.json") {
        readBuildSettingKeys(text, scan.purposeKeys);
        projectFiles.push(text);
        builtIds.push(...bundleIdsIn(text));
      }
      if (file.name === "project.pbxproj" && bundleId) {
        const family = deviceFamilyFor(text, bundleId);
        if (family !== null) scan.runsOnIpad = (scan.runsOnIpad ?? false) || family;
      }
      for (const dep of dependenciesIn(file, text)) dependencies.set(dep.name, dep);
    }
  }
  if (skippedLarge.length) scan.truncated ??= `${skippedLarge.length} file(s) over the size limit were not read, such as ${skippedLarge[0]}`;

  // A manifest not added to a target never reaches the app. Xcode 16 folders and
  // XcodeGen add files without listing them, so silence there proves nothing.
  const listsFiles = projectFiles.some((t) => t.includes("archiveVersion")) && !projectFiles.some((t) => /PBXFileSystemSynchronizedRootGroup|^targets:/m.test(t));
  for (const manifest of scan.manifests) {
    manifest.inProject = listsFiles ? projectFiles.some((t) => t.includes(basename(manifest.path))) : null;
  }
  for (const [name, dep] of dependencies) sdks.set(name, { name, via: dep.via, manifest: await sdkManifestOnDisk(root, name, dep.repo) });

  await scanBuiltApp(root, scan, apis, sdks);

  // A folder with nothing to judge must not read as five passes.
  const foundProject = files.some((f) => SOURCE_FILE.test(f.name) || PROJECT_MARKER.test(f.name)) || scan.builtApp !== null;
  if (!foundProject && !truncated) throw new NoProjectHere();
  if (bundleId && builtIds.length && !builtIds.includes(bundleId)) {
    scan.otherApp = `This folder builds ${[...new Set(builtIds)].slice(0, 3).join(", ")}, and this app is ${bundleId}, so these results may belong to another app.`;
  }

  scan.apis = [...apis.values()];
  scan.purposes = [...purposes.values()];
  scan.sdks = [...sdks.values()];
  scan.signInSeenAt = signIn.at;
  return scan;
}

/** Turns the tool's optional argument into what the rules read. */
export async function readProjectInput(projectPath: string | undefined, bundleId: string | null): Promise<ProjectInput> {
  if (!projectPath?.trim()) return { provided: false };
  const root = resolveInput(projectPath.trim());
  let info;
  try {
    info = await stat(root);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return { provided: true, error: missing ? `Path not found: ${root}` : `Could not open ${root}: ${message(err)}` };
  }
  if (!info.isDirectory()) return { provided: true, error: `Not a folder: ${root}` };
  try {
    return { provided: true, scan: await scanProject(root, bundleId) };
  } catch (err) {
    if (err instanceof NoProjectHere) return { provided: true, error: `No Xcode project or source found in ${root}. Pass the folder holding the .xcodeproj.` };
    return { provided: true, error: `Could not read ${root}: ${message(err)}` };
  }
}
