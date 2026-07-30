import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { EDITABLE_VERSION_STATES as EDITABLE } from "../editable.js";

interface BuildAttrs {
  version: string;
  processingState: string;
  uploadedDate: string;
  expired: boolean;
}
interface VersionAttrs {
  versionString: string;
  appStoreState: string;
}

/** List recent builds for an app with their processing state. */
export async function listBuilds(
  client: ASCClient,
  args: { app_id: string; limit?: number },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Listing builds");
  if (gate) return gate;

  const res = await client.get<BuildAttrs>("/v1/builds", {
    "filter[app]": args.app_id,
    sort: "-uploadedDate",
    "fields[builds]": "version,processingState,uploadedDate,expired",
    limit: String(Math.min(args.limit ?? 10, 50)),
  });
  const builds = Array.isArray(res.data) ? res.data : [res.data];
  if (!builds.length) {
    // filter[app] with a bogus id returns an empty list, not a 404, so "no
    // builds" would send someone off to re-upload a build for an app that does
    // not exist. Check which of the two it is.
    const appExists = await client
      .get(`/v1/apps/${args.app_id}`, { "fields[apps]": "name" })
      .then(() => true)
      .catch(() => false);
    return appExists
      ? "No builds found for this app. Upload one with upload_binary (or Xcode/Transporter) first."
      : `No app with id ${args.app_id} in this account. Run list_apps to get the right app_id.`;
  }
  const lines = builds.map((b) => {
    const a = b.attributes;
    const flag = a.expired ? " (expired)" : "";
    return `- Build ${a.version} [${b.id}]: ${a.processingState}${flag}, uploaded ${a.uploadedDate?.slice(0, 10) ?? "?"}`;
  });
  return `Builds for app ${args.app_id}:\n${lines.join("\n")}`;
}

/**
 * Poll until the newest build for an app finishes processing (state VALID),
 * so the ship flow can be one call instead of manual polling. Bounded by
 * max_wait_seconds; returns as soon as a VALID build appears or it times out.
 */
export async function waitForBuild(
  client: ASCClient,
  args: { app_id: string; max_wait_seconds?: number; poll_seconds?: number },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Waiting for a build");
  if (gate) return gate;

  const maxWait = Math.min(args.max_wait_seconds ?? 1800, 3600) * 1000;
  const poll = Math.max(args.poll_seconds ?? 30, 10) * 1000;
  const start = Date.now();
  let last = "";

  while (Date.now() - start < maxWait) {
    const res = await client.get<BuildAttrs>("/v1/builds", {
      "filter[app]": args.app_id,
      sort: "-uploadedDate",
      "fields[builds]": "version,processingState",
      limit: "1",
    });
    const builds = Array.isArray(res.data) ? res.data : [res.data];
    const newest = builds[0];
    if (!newest) {
      last = "no builds yet";
    } else {
      last = `${newest.attributes.version}: ${newest.attributes.processingState}`;
      if (newest.attributes.processingState === "VALID") {
        return `Build ${newest.attributes.version} is VALID and ready [${newest.id}]. Attach it with attach_build.`;
      }
      if (newest.attributes.processingState === "FAILED" || newest.attributes.processingState === "INVALID") {
        return `Build ${newest.attributes.version} processing ${newest.attributes.processingState}. Check App Store Connect for details.`;
      }
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return `Timed out after ${Math.round(maxWait / 1000)}s waiting for a VALID build. Last seen: ${last}.`;
}

/**
 * Attach a build to the editable App Store version. If no build_id is given,
 * picks the newest VALID (processed) build automatically.
 */
export async function attachBuild(
  client: ASCClient,
  args: { app_id: string; build_id?: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Attaching a build");
  if (gate) return gate;

  // Find the editable version.
  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const version = versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
  if (!version) {
    return "No editable version to attach a build to. Create one with create_version first.";
  }

  // Resolve build: explicit id, else newest processed (VALID) build.
  let buildId = args.build_id;
  let buildVersion = buildId ?? "";
  if (!buildId) {
    const res = await client.get<BuildAttrs>("/v1/builds", {
      "filter[app]": args.app_id,
      "filter[processingState]": "VALID",
      sort: "-uploadedDate",
      "fields[builds]": "version",
      limit: "1",
    });
    const builds = Array.isArray(res.data) ? res.data : [res.data];
    const newest = builds[0];
    if (!newest) {
      return "No processed (VALID) build available yet. Wait for processing or check list_builds.";
    }
    buildId = newest.id;
    buildVersion = newest.attributes.version;
  }

  await client.patch(`/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: buildId },
  });

  return (
    `Attached build ${buildVersion} [${buildId}] to version ${version.attributes.versionString}.\n` +
    "Run release_preflight, then submit_for_review."
  );
}
