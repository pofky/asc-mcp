import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface VersionAttrs {
  versionString: string;
  appStoreState: string;
}

/**
 * Manually release a version that App Review has approved
 * (state PENDING_DEVELOPER_RELEASE). Outward-facing: requires confirm:true.
 */
export async function releaseVersion(
  client: ASCClient,
  args: { app_id: string; confirm?: boolean },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Releasing a version");
  if (gate) return gate;
  if (!args.confirm) {
    return "This releases your approved app to the public App Store. Re-run with confirm: true.";
  }

  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const ready = versions.find(
    (v) => v.attributes.appStoreState === "PENDING_DEVELOPER_RELEASE",
  );
  if (!ready) {
    return "No version is waiting for developer release (state PENDING_DEVELOPER_RELEASE). Check review_status.";
  }

  await client.post("/v1/appStoreVersionReleaseRequests", {
    data: {
      type: "appStoreVersionReleaseRequests",
      relationships: {
        appStoreVersion: { data: { type: "appStoreVersions", id: ready.id } },
      },
    },
  });
  return `Released version ${ready.attributes.versionString} to the App Store.`;
}

type PhasedAction = "start" | "pause" | "resume" | "complete";
const PHASED_STATE: Record<PhasedAction, string> = {
  start: "ACTIVE",
  resume: "ACTIVE",
  pause: "PAUSED",
  complete: "COMPLETE",
};

/**
 * Control the 7-day phased rollout for the version that is releasing or live
 * (PENDING_DEVELOPER_RELEASE or READY_FOR_SALE), or start a new phased release
 * on it.
 */
export async function managePhasedRelease(
  client: ASCClient,
  args: { app_id: string; action: PhasedAction },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Managing phased release");
  if (gate) return gate;

  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  // Phased release only applies to a version that is releasing or live. Prefer
  // one in those states rather than blindly taking versions[0] (the API does
  // not guarantee ordering); fall back to the first version if none match.
  const PHASED_TARGET = ["PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"];
  const version =
    versions.find((v) => PHASED_TARGET.includes(v.attributes.appStoreState)) ?? versions[0];
  if (!version) return "No version found.";

  // Look up existing phased release on this version.
  const phasedRes = await client.get<{ phasedReleaseState: string }>(
    `/v1/appStoreVersions/${version.id}/appStoreVersionPhasedRelease`,
    { "fields[appStoreVersionPhasedReleases]": "phasedReleaseState" },
  ).catch(() => null);
  const existing = phasedRes && !Array.isArray(phasedRes.data) ? phasedRes.data : null;
  const targetState = PHASED_STATE[args.action];

  if (args.action === "start" && !existing) {
    await client.post("/v1/appStoreVersionPhasedReleases", {
      data: {
        type: "appStoreVersionPhasedReleases",
        attributes: { phasedReleaseState: "ACTIVE" },
        relationships: {
          appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
        },
      },
    });
    return `Started phased release for version ${version.attributes.versionString}.`;
  }

  if (!existing) {
    return "No phased release exists on the current version. Use action 'start' first.";
  }

  await client.patch(`/v1/appStoreVersionPhasedReleases/${(existing as { id: string }).id}`, {
    data: {
      type: "appStoreVersionPhasedReleases",
      id: (existing as { id: string }).id,
      attributes: { phasedReleaseState: targetState },
    },
  });
  return `Phased release set to ${targetState} for version ${version.attributes.versionString}.`;
}
