import type { ASCClient } from "../client.js";
import { checkApp, checkSubscriptionTerms, checkVersion } from "./checks/record.js";
import { checkProject, declaredDataTypes } from "./checks/project.js";
import { checkPrivacyUrls, checkVersionUrls, urlsToProbe } from "./checks/urls.js";
import { EDITABLE_VERSION_STATES } from "../editable.js";
import { explainFailure, gatherRecord } from "./gather.js";
import { readProjectInput } from "./project-scan.js";
import { platformLabel, renderReport, type ReportSection } from "./report.js";
import type { Finding, ProbeResults, ProjectInput, RecordSnapshot } from "./types.js";
import { probeUrls, type ProbeOptions } from "./url-probe.js";

export interface PreflightArgs {
  app_id: string;
  project_path?: string;
  platform?: string;
}

/** Test seams. The defaults are the real clock and the guarded probe. */
export interface PreflightDeps {
  now?: () => Date;
  probe?: ProbeOptions;
}

/** Every record read failed: there is nothing to report on, and no verdict to give. */
function appleIsDown(record: RecordSnapshot): string | null {
  const parts = [record.app, record.appInfo, record.hasManualPrice, record.iaps, record.subscriptions, record.hasCustomEula];
  const failed = parts.filter((p) => !p.ok) as Array<{ ok: false; reason: string }>;
  const versionsFailed = record.versions.every((v) => !v.localizations.ok && !v.build.ok && !v.review.ok);
  return failed.length === parts.length && versionsFailed ? failed[0].reason : null;
}

function manualSteps(record: RecordSnapshot, project: ProjectInput): string[] {
  const steps: string[] = [];
  const open = record.versions.some((v) => EDITABLE_VERSION_STATES.has(v.state));
  const noBuild = record.versions.some((v) => v.build.ok && !v.build.value);
  if (noBuild) {
    steps.push("Uploading a binary needs Xcode on your machine: setup_app_store_signing, build_and_archive, upload_binary, then attach_build.");
  }
  const ready = [record.iaps, record.subscriptions].flatMap((p) => (p.ok ? p.value : [])).filter((p) => p.state === "READY_TO_SUBMIT").map((p) => p.productId);
  if (ready.length && open) {
    steps.push(
      `iap.first_bundle: an app's first in-app purchases must be submitted with the version on the website, which Apple does not allow through its API. Open this version in App Store Connect, add ${ready.join(", ")} under "In-App Purchases and Subscriptions", then Add for Review and Submit. Once one has been approved, later ones submit through submit_for_review.`,
    );
  }
  const privacyUrl = `https://appstoreconnect.apple.com/apps/${record.appId}/distribution/privacy`;
  const types = declaredDataTypes(project);
  steps.push(
    types.length
      ? `privacy.checklist: your manifests declare these data types: ${types.join(", ")}. Confirm each is on the App Privacy page, which Apple's API cannot read: ${privacyUrl}`
      : `privacy.checklist: confirm the App Privacy page is complete, which Apple's API cannot read: ${privacyUrl} (set_privacy_nutrition has the steps).`,
  );
  steps.push(`If you distribute in the EU, confirm your trader status on the App Information page: https://appstoreconnect.apple.com/apps/${record.appId}/distribution/info (set_eu_trader_status has the steps).`);
  return steps;
}

/** One complete preflight: fetch, probe, scan, judge, write. */
export async function runPreflight(client: ASCClient, args: PreflightArgs, deps: PreflightDeps = {}): Promise<string> {
  const now = deps.now?.() ?? new Date();
  const checkedAt = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const today = now.toISOString().slice(0, 10);

  let record: RecordSnapshot;
  try {
    record = await gatherRecord(client, args.app_id, args.platform);
  } catch (err) {
    // Without the version list there is nothing to audit. The "Error" prefix is
    // what returns a free user's preview call (`safe` in src/index.ts).
    return `Error: could not read this app's versions, so no audit ran. ${explainFailure(err)}`;
  }
  if (!record.versions.length) {
    return args.platform
      ? `Error: this app has no ${platformLabel(args.platform)} version. Call release_preflight without platform, or create_version to start one.`
      : "Error: this app has no App Store versions yet, so there is nothing to audit. create_version starts one.";
  }
  const down = appleIsDown(record);
  if (down) return `Error: App Store Connect did not answer any of this audit's requests, so no verdict is given. ${down}`;

  const bundleId = record.app.ok ? record.app.value.bundleId : null;
  const [probes, project] = await Promise.all([
    probeUrls(urlsToProbe(record, record.versions), deps.probe) as Promise<ProbeResults>,
    readProjectInput(args.project_path, bundleId),
  ]);

  const primaryLocale = record.app.ok ? record.app.value.primaryLocale : null;
  const hasSubscriptions = record.subscriptions.ok && record.subscriptions.value.length > 0;
  const appWide: Finding[] = [...checkApp(record), ...checkPrivacyUrls(record, probes, checkedAt), ...checkProject(project)];
  const perVersion = record.versions.map((v) => ({
    v,
    findings: [
      ...checkVersion(v, primaryLocale, project, today, args.app_id),
      ...checkSubscriptionTerms(record, v),
      ...checkVersionUrls(v, hasSubscriptions, probes, checkedAt),
    ],
  }));

  const sections: ReportSection[] =
    perVersion.length === 1
      ? [{ findings: [...perVersion[0].findings, ...appWide] }]
      : [
          { title: "App-wide", findings: appWide },
          ...perVersion.map(({ v, findings }) => ({ title: `v${v.versionString} (${platformLabel(v.platform)})`, findings })),
        ];

  return renderReport({ record, sections, manualSteps: manualSteps(record, project), now });
}
