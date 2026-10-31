import { RULES, RULESET_DATE, RULESET_STALE_AFTER_DAYS, SOURCES, ruleOf } from "./rules.js";
import type { Finding, RecordSnapshot, Status, VersionSnapshot } from "./types.js";

export const NOT_A_PREDICTION = "This is not a prediction of App Review's decision.";

const PLATFORM_LABEL: Record<string, string> = { IOS: "iOS", MAC_OS: "macOS", TV_OS: "tvOS", VISION_OS: "visionOS" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

const LABEL: Record<Status, string> = { fail: "FAIL", unknown: "UNKNOWN", warn: "WARN", pass: "PASS", skipped: "SKIPPED" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function verdictLine(all: Finding[]): string {
  // Counted as printed, so the number on top matches the blocks below it.
  const findings = merge(all);
  const fails = findings.filter((f) => f.status === "fail").length;
  const unknowns = findings.filter((f) => f.status === "unknown").length;
  const warns = findings.filter((f) => f.status === "warn").length;
  const unknownText = `${unknowns} could not be checked`;
  if (fails) return `BLOCKED: ${plural(fails, "failure")}${unknowns ? `, ${unknownText}` : ""}`;
  if (unknowns) return `NOT CONFIRMED: no failures, ${unknownText}`;
  const rules = new Set(findings.filter((f) => f.status !== "skipped").map((f) => f.rule)).size;
  const projectSkipped = findings.some((f) => f.status === "skipped" && f.scope === "project.*");
  return `NO BLOCKING ISSUES FOUND: ${plural(rules, "rule")} checked${warns ? `, ${plural(warns, "warning")}` : ""}${projectSkipped ? ", project files not checked" : ""}. ${NOT_A_PREDICTION}`;
}

/** Same result on many locales reads as one finding with a list of locales. */
function merge(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule}|${f.status}|${f.saw}`;
    const existing = seen.get(key);
    if (!existing) seen.set(key, { ...f });
    else if (f.scope && existing.scope && !existing.scope.split(", ").includes(f.scope)) existing.scope = `${existing.scope}, ${f.scope}`;
  }
  return [...seen.values()];
}

function block(f: Finding, platform?: string): string {
  const rule = ruleOf(f.rule);
  const lines = [`${LABEL[f.status]}  ${f.rule}${f.scope ? `  [${f.scope}]` : ""}`, `Saw:  ${f.saw}`];
  if (rule) {
    const source = SOURCES[rule.source];
    lines.push(`Rule: ${rule.clause} (${source.label}, verified ${source.verified})`);
    if (rule.fixTool && f.status !== "skipped") lines.push(`Fix:  ${rule.fixTool}${platform ? ` platform ${platform},` : ""}${rule.fixHint ? ` ${rule.fixHint}` : ""}`.replace(/,$/, ""));
  }
  return lines.join("\n");
}

function section(title: string, findings: Finding[], platform?: string): string {
  return findings.length ? `\n### ${title}\n\n${findings.map((f) => block(f, platform)).join("\n\n")}\n` : "";
}

/** Passes are a count per family, so a 30-locale app does not print hundreds of lines. */
function passSummary(findings: Finding[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const family = ruleOf(f.rule)?.family ?? "Other";
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  if (!counts.size) return "";
  return `\n### Passed\n\n${[...counts].map(([family, n]) => `${family}: ${n}`).join("\n")}\n`;
}

function skippedLines(findings: Finding[]): string {
  if (!findings.length) return "";
  return "\n" + findings.map((f) => `SKIPPED  ${f.scope ?? f.rule}  ${f.saw}`).join("\n") + "\n";
}

export function describeVersion(v: VersionSnapshot): string {
  const label = platformLabel(v.platform);
  if (v.auditingLive) return `No version is being prepared. This audits the live v${v.versionString} (${label}); create_version starts the next one.`;
  return `Auditing v${v.versionString} (${label}), state ${v.state}`;
}

function closingLine(record: RecordSnapshot, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const builds = record.versions.map((v) => `v${v.versionString}${v.build.ok && v.build.value ? ` build ${v.build.value.version}` : ""}`).join(", ");
  return `Checked ${stamp} UTC, ${builds}, rules ${RULESET_DATE}.`;
}

function staleNotice(now: Date): string {
  const days = (now.getTime() - Date.parse(`${RULESET_DATE}T00:00:00Z`)) / 86_400_000;
  return days > RULESET_STALE_AFTER_DAYS ? `\nRule set verified ${RULESET_DATE}, over ${RULESET_STALE_AFTER_DAYS} days ago. Update asc-mcp.\n` : "";
}

export interface ReportSection {
  /** Set when the app has more than one platform in the report. */
  title?: string;
  /** Named in each fix when versions are in progress on several platforms. */
  platform?: string;
  findings: Finding[];
}

export function renderReport(input: {
  record: RecordSnapshot;
  sections: ReportSection[];
  manualSteps: string[];
  now: Date;
}): string {
  const { record, sections, manualSteps, now } = input;
  const all = sections.flatMap((s) => s.findings);
  const name = record.app.ok ? record.app.value.name : `app ${record.appId}`;
  let out = `## Release Preflight: ${name}\n\n${verdictLine(all)}\n\n`;
  out += record.versions.map((v) => describeVersion(v)).join("\n") + "\n";
  out += staleNotice(now);
  for (const s of sections) {
    const merged = merge(s.findings);
    if (s.title) out += `\n## ${s.title}\n`;
    out += section("Failures", merged.filter((f) => f.status === "fail"), s.platform);
    out += section("Could not be checked", merged.filter((f) => f.status === "unknown"), s.platform);
    out += section("Warnings", merged.filter((f) => f.status === "warn"), s.platform);
    out += passSummary(merged.filter((f) => f.status === "pass"));
    out += skippedLines(merged.filter((f) => f.status === "skipped"));
  }
  if (manualSteps.length) {
    out += "\n### Manual steps Apple keeps on its website\n\n" + manualSteps.map((s) => `- ${s}`).join("\n") + "\n";
  }
  return `${out}\n---\n${closingLine(record, now)}\n`;
}

/** Exposed for the test that each rule's fix tool exists. */
export const ALL_RULE_IDS = Object.keys(RULES);
