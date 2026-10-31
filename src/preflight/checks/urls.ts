import { PLACEHOLDER_HOSTS, type RuleId } from "../rules.js";
import type { Finding, ProbeOutcome, ProbeResults, RecordSnapshot, Status, VersionSnapshot } from "../types.js";
import { termsLinksIn } from "./record.js";

const finding = (rule: RuleId, status: Status, saw: string, scope?: string): Finding => ({ rule, status, saw, scope });

/** A record field goes into a report an agent reads, so it is kept short and on one line. */
export function printableUrl(url: string): string {
  const clean = url.replace(/[^\x21-\x7e]/g, "");
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

function isPlaceholderHost(url: string): boolean {
  // A URL that will not parse has no host to match; the probe reports it.
  const host = url.trim().match(/^https?:\/\/(?:[^/@?#]*@)?([^/:?#]+)/i)?.[1];
  return host !== undefined && PLACEHOLDER_HOSTS.has(host.toLowerCase());
}

function judge(rule: RuleId, url: string, outcome: ProbeOutcome | undefined, scope: string, checkedAt: string): Finding {
  const shown = printableUrl(url);
  if (!outcome) return finding(rule, "unknown", `${shown} was not checked.`, scope);
  if (outcome.kind === "live") return finding(rule, "pass", `${shown} loads.`, scope);
  if (outcome.kind === "dead") return finding(rule, "fail", `${shown}: ${outcome.detail} (checked ${checkedAt}).`, scope);
  return finding(rule, "unknown", `${shown}: ${outcome.detail}. Open it in a browser and confirm.`, scope);
}

/** Every URL the record names that the rules below will look up. */
export function urlsToProbe(record: RecordSnapshot, versions: VersionSnapshot[]): string[] {
  const urls: string[] = [];
  const add = (u: string | null | undefined) => {
    if (u && u.trim() && !isPlaceholderHost(u)) urls.push(u.trim());
  };
  for (const v of versions) {
    if (!v.localizations.ok) continue;
    for (const l of v.localizations.value) {
      add(l.supportUrl);
      add(l.marketingUrl);
      termsLinksIn(l.description).forEach(add);
    }
  }
  if (record.appInfo.ok) record.appInfo.value.localizations.forEach((l) => add(l.privacyPolicyUrl));
  return urls;
}

function checkOne(rule: RuleId, url: string, probes: ProbeResults, scope: string, checkedAt: string): Finding {
  if (isPlaceholderHost(url)) return finding(rule, "fail", `${printableUrl(url)} is a placeholder address.`, scope);
  return judge(rule, url.trim(), probes[url.trim()], scope, checkedAt);
}

export function checkVersionUrls(v: VersionSnapshot, hasSubscriptions: boolean, probes: ProbeResults, checkedAt: string): Finding[] {
  if (!v.localizations.ok) {
    return (["url.support.set", "url.support.live", "url.marketing.live"] as RuleId[]).map((r) => finding(r, "unknown", (v.localizations as { reason: string }).reason));
  }
  const out: Finding[] = [];
  for (const l of v.localizations.value) {
    if (!l.supportUrl?.trim()) {
      out.push(finding("url.support.set", "fail", "No support URL.", l.locale));
    } else {
      out.push(finding("url.support.set", "pass", "Set.", l.locale));
      out.push(checkOne("url.support.live", l.supportUrl, probes, l.locale, checkedAt));
    }
    if (l.marketingUrl?.trim()) out.push(checkOne("url.marketing.live", l.marketingUrl, probes, l.locale, checkedAt));
    if (hasSubscriptions) {
      for (const link of termsLinksIn(l.description)) out.push(checkOne("url.terms.live", link, probes, l.locale, checkedAt));
    }
  }
  return out;
}

export function checkPrivacyUrls(record: RecordSnapshot, probes: ProbeResults, checkedAt: string): Finding[] {
  if (!record.appInfo.ok) return [finding("url.privacy.set", "unknown", record.appInfo.reason)];
  const out: Finding[] = [];
  for (const l of record.appInfo.value.localizations) {
    const url = l.privacyPolicyUrl?.trim();
    if (!url) {
      // Guideline 5.1.1(i) requires the link. Whether each extra language needs its
      // own is not something Apple states, so only the primary language is a failure.
      const primary = record.app.ok ? record.app.value.primaryLocale : null;
      const blocking = !primary || primary === l.locale;
      out.push(blocking
        ? finding("url.privacy.set", "fail", "No privacy policy URL.", l.locale)
        : finding("url.privacy.set", "warn", "No privacy policy URL in this language.", l.locale));
      continue;
    }
    out.push(finding("url.privacy.set", "pass", "Set.", l.locale));
    const live = checkOne("url.privacy.live", url, probes, l.locale, checkedAt);
    out.push(live);
    const outcome = probes[url];
    // Only whether a page is there. Never a view on what a policy says.
    if (live.status === "pass" && outcome?.kind === "live") {
      if (outcome.parked) out.push(finding("url.privacy.content", "warn", `${printableUrl(url)} looks like a parked domain.`, l.locale));
      else if (outcome.thin) out.push(finding("url.privacy.content", "warn", `${printableUrl(url)} has almost no text on it.`, l.locale));
      else out.push(finding("url.privacy.content", "pass", "The page has content.", l.locale));
    }
  }
  return out;
}
