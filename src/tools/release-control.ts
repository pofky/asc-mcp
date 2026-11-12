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
  const gate = requirePro(tier, "Releasing a version", "release_version");
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
  args: { app_id: string; action: PhasedAction; confirm?: boolean },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Managing phased release", "manage_phased_release");
  if (gate) return gate;

  // Every action here changes how a LIVE version reaches the public, and two of
  // them cannot be walked back. `complete` ends the staged rollout immediately
  // and pushes the version to 100% of users, which is the exact thing a phased
  // release exists to avoid; `start` begins the rollout clock on an approved
  // version. release_version and create_version both ask before far less, so an
  // agent tidying up a checklist must not be able to finish someone's careful
  // 7-day rollout on day two by itself.
  const EFFECT: Record<PhasedAction, string> = {
    start: "starts the staged rollout: Apple begins releasing this version to a growing share of users over 7 days",
    pause: "pauses the staged rollout, so no further users receive this version until it is resumed",
    resume: "resumes the staged rollout from where it was paused",
    complete:
      "ends the staged rollout NOW and releases this version to 100% of users immediately. This cannot be undone",
  };
  if (!args.confirm) {
    return (
      `This ${EFFECT[args.action]}.\n\n` +
      `App ${args.app_id}, action "${args.action}". Re-run with confirm: true to proceed.`
    );
  }

  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  // Phased release only applies to a version that is releasing or live. Taking
  // versions[0] when none matched let "start" target an unreleased version, so
  // refuse instead and say which states count.
  const PHASED_TARGET = ["PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE"];
  const candidates = versions.filter(Boolean);
  if (!candidates.length) {
    return "Nothing was changed: no version found for this app. The AI checks app_id with list_apps, then calls review_status.";
  }
  const version = candidates.find((v) => PHASED_TARGET.includes(v.attributes.appStoreState));
  if (!version) {
    const seen = candidates.map((v) => `v${v.attributes.versionString} is ${v.attributes.appStoreState}`).join(", ");
    return (
      `Nothing was changed: a phased release applies only to a version that Apple approved and is waiting for release (PENDING_DEVELOPER_RELEASE) or that is live (READY_FOR_SALE). Recent versions: ${seen}. ` +
      "The AI calls review_status to follow the version, and calls manage_phased_release again once it is approved."
    );
  }

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
    return `Nothing was changed: version ${version.attributes.versionString} has no phased release yet. The AI calls manage_phased_release with action "start" and confirm: true first.`;
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
