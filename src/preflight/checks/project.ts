import { REQUIRED_REASON_CATEGORIES, type RequiredReasonCategory } from "../apple-lists.js";
import type { RuleId } from "../rules.js";
import type { Finding, ProjectInput, ProjectScan, Status } from "../types.js";

const finding = (rule: RuleId, status: Status, saw: string, scope?: string): Finding => ({ rule, status, saw, scope });
const AGAIN = " then the AI runs release_preflight again.";

const PROJECT_RULES: RuleId[] = ["manifest.present", "manifest.reasons", "sdk.manifest", "plist.purpose", "plist.placeholder"];

const categoryLabel = (c: string) => REQUIRED_REASON_CATEGORIES[c as RequiredReasonCategory]?.label ?? c;
const shortCategory = (c: string) => c.replace("NSPrivacyAccessedAPICategory", "");

function checkManifests(scan: ProjectScan): Finding[] {
  const out: Finding[] = [];
  const usable = scan.manifests.filter((m) => m.parsed.ok);
  for (const m of scan.manifests) {
    if (!m.parsed.ok) out.push(finding("manifest.present", "fail", `It does not parse: ${m.parsed.reason}. The human repairs it in Xcode (or replaces it with File > New > File > App Privacy),${AGAIN}`, m.path));
    else if (m.inProject === false) out.push(finding("manifest.present", "warn", "It exists, and the Xcode project does not mention it, so it may not reach the app.", m.path));
  }
  if (!usable.length && !scan.manifests.length) {
    const strong = scan.apis.filter((a) => a.strength === "strong");
    if (strong.length) out.push(finding("manifest.present", "fail", `No PrivacyInfo.xcprivacy, and this code uses ${strong.map((a) => categoryLabel(a.category)).join(", ")}. The human adds one in Xcode with File > New > File > App Privacy and ticks the app target,${AGAIN}`));
    else out.push(finding("manifest.present", "pass", "No manifest, and no use of a listed API was found."));
  } else if (usable.length && !out.some((f) => f.rule === "manifest.present")) {
    out.push(finding("manifest.present", "pass", `${usable.length} manifest(s) parsed.`));
  }

  const declared = new Map<string, string[]>();
  for (const m of usable) {
    if (!m.parsed.ok) continue;
    for (const [category, reasons] of Object.entries(m.parsed.value.accessed)) declared.set(category, [...(declared.get(category) ?? []), ...reasons]);
  }
  let reasonFindings = 0;
  for (const api of scan.apis) {
    if (declared.has(api.category)) continue;
    reasonFindings++;
    if (api.strength === "strong") out.push(finding("manifest.reasons", "fail", `${categoryLabel(api.category)} is used at ${api.where}, and ${shortCategory(api.category)} is not declared in a manifest. The human adds it with a reason code in PrivacyInfo.xcprivacy in Xcode,${AGAIN}`));
    else out.push(finding("manifest.reasons", "warn", `${api.where} looks like ${categoryLabel(api.category)} use, which would need declaring. If it is your own property, ignore this.`));
  }
  for (const [category, reasons] of declared) {
    const entry = REQUIRED_REASON_CATEGORIES[category as RequiredReasonCategory];
    if (!entry) {
      reasonFindings++;
      out.push(finding("manifest.reasons", "fail", `${category.slice(0, 80)} is not a category Apple lists. The human removes or corrects it in PrivacyInfo.xcprivacy in Xcode,${AGAIN}`));
      continue;
    }
    const allowed = entry.reasons as readonly string[];
    const invalid = reasons.filter((r) => !allowed.includes(r));
    if (!reasons.length) {
      reasonFindings++;
      out.push(finding("manifest.reasons", "fail", `${shortCategory(category)} is declared with no reason code. Apple's codes for it: ${allowed.join(", ")}. The human adds one in PrivacyInfo.xcprivacy in Xcode,${AGAIN}`));
    } else if (invalid.length) {
      reasonFindings++;
      out.push(finding("manifest.reasons", "fail", `${shortCategory(category)} declares ${invalid.map((r) => r.slice(0, 12)).join(", ")}, not one of Apple's codes for it: ${allowed.join(", ")}. The human corrects it in PrivacyInfo.xcprivacy in Xcode,${AGAIN}`));
    }
  }
  if (!reasonFindings) out.push(finding("manifest.reasons", "pass", `${scan.apis.length} API categor${scan.apis.length === 1 ? "y" : "ies"} in use, all declared with valid codes.`));
  return out;
}

function checkSdks(scan: ProjectScan): Finding[] {
  if (!scan.sdks.length) return [finding("sdk.manifest", "pass", "No SDK on Apple's list was found.")];
  const out: Finding[] = [];
  for (const sdk of scan.sdks) {
    if (sdk.manifest === "absent") out.push(finding("sdk.manifest", "fail", `Found through ${sdk.via} with no PrivacyInfo.xcprivacy in it. The human updates the SDK to a release that includes PrivacyInfo.xcprivacy,${AGAIN}`, sdk.name));
    else if (sdk.manifest === "not_on_disk") out.push(finding("sdk.manifest", "warn", `Found through ${sdk.via}. Its source is not in this folder, so its manifest could not be seen. Check the version you use includes one, or archive and re-run.`, sdk.name));
    else out.push(finding("sdk.manifest", "pass", "Carries a manifest.", sdk.name));
  }
  return out;
}

function checkPlist(scan: ProjectScan): Finding[] {
  const out: Finding[] = [];
  let bad = 0;
  for (const use of scan.purposes) {
    const present = use.keys.filter((k) => k in scan.purposeKeys);
    if (present.some((k) => scan.purposeKeys[k])) continue;
    bad++;
    out.push(present.length
      ? finding("plist.purpose", "fail", `${present[0]} is empty, and this code uses ${use.api} at ${use.where}. The human writes a specific purpose string for ${present[0]} in the target's Info tab in Xcode,${AGAIN}`)
      : finding("plist.purpose", "fail", `This code uses ${use.api} at ${use.where}, and no ${use.keys[0]} was found. The human adds a specific purpose string for ${use.keys[0]} in the target's Info tab in Xcode,${AGAIN}`));
  }
  if (!bad) out.push(finding("plist.purpose", "pass", scan.purposes.length ? "Each permission in use has its purpose string." : "No API that needs a purpose string was found."));
  for (const p of scan.placeholderKeys) out.push(finding("plist.placeholder", "fail", `${p.key.replace(/[^\w.-]/g, "").slice(0, 60)} holds a sample value. The human replaces it with the real value in Xcode (the target's Info tab or the file named here),${AGAIN}`, p.where));
  if (!scan.placeholderKeys.length) out.push(finding("plist.placeholder", "pass", "No sample values found."));
  return out;
}

/**
 * File and key names come from a folder that may have been cloned from anyone,
 * and an agent reads this report. One line each, printable, and short.
 */
const printable = (f: Finding): Finding => ({
  ...f,
  saw: f.saw.replace(/[^\x20-\x7e]/g, "").slice(0, 700),
  scope: f.scope?.replace(/[^\x20-\x7e]/g, "").slice(0, 120),
});

/** The project rules, or one line each saying why they did not run. */
export function checkProject(project: ProjectInput): Finding[] {
  if (!project.provided) return [finding("manifest.present", "skipped", "Pass project_path to check privacy manifests and purpose strings.", "project.*")];
  // The caller asked for these rules and they did not run, so it is not clean.
  if ("error" in project) return [finding("manifest.present", "unknown", `Project rules did not run. ${project.error}`, "project.*")];
  const scan = project.scan;
  const out = [...checkManifests(scan), ...checkSdks(scan), ...checkPlist(scan)];
  if (scan.truncated) {
    // A partial scan cannot vouch for what it did not read.
    for (const rule of PROJECT_RULES) out.push(finding(rule, "unknown", `The scan was partial: ${scan.truncated}.`));
  }
  if (scan.otherApp) out.push(finding("manifest.present", "unknown", scan.otherApp, "project.*"));
  if (scan.plistIssue) out.push(finding("plist.purpose", "unknown", scan.plistIssue));
  if (scan.binaryUnreadable) out.push(finding("manifest.reasons", "unknown", scan.binaryUnreadable, "built app"));
  if (scan.binarySkipped) out.push(finding("manifest.reasons", "skipped", scan.binarySkipped, "built app"));
  return out.map(printable);
}

/** Data types declared in the manifests, for the App Privacy page Apple's API cannot reach. */
export function declaredDataTypes(project: ProjectInput): string[] {
  // Another app's data types would make a wrong checklist for this one.
  if (!project.provided || !("scan" in project) || project.scan.otherApp) return [];
  const types = new Set<string>();
  for (const m of project.scan.manifests) {
    if (m.parsed.ok) m.parsed.value.collectedDataTypes.forEach((t) => types.add(t.replace("NSPrivacyCollectedDataType", "")));
  }
  return [...types].sort();
}
