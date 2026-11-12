import type { ASCClient } from "../client.js";

interface VersionAttributes {
  versionString: string;
  platform: string;
  appStoreState: string;
  createdDate: string;
}

interface SubmissionAttributes {
  state: string;
  submittedDate: string;
}

export const reviewStatusDefinition = {
  name: "review_status",
  description:
    "Check the current App Store review status for an app. Shows whether the app is in review, waiting for review, approved, or rejected.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description:
          "The App Store Connect app ID. Use list_apps to find it.",
      },
    },
    required: ["app_id"],
  },
};

export async function reviewStatus(
  client: ASCClient,
  args: { app_id: string },
): Promise<string> {
  // Get all versions sorted by newest first
  const versionsResponse = await client.get<VersionAttributes>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    {
      "fields[appStoreVersions]":
        "versionString,platform,appStoreState,createdDate",
      limit: "5",
    },
  );

  const versions = Array.isArray(versionsResponse.data)
    ? versionsResponse.data
    : [versionsResponse.data];

  if (versions.length === 0) {
    return "No versions found for this app. The AI checks app_id with list_apps; if it is right, the AI calls create_version (with confirm: true) to start the first version.";
  }

  const reviewStates = [
    "WAITING_FOR_REVIEW",
    "IN_REVIEW",
    "PENDING_APPLE_RELEASE",
    "PENDING_DEVELOPER_RELEASE",
    "READY_FOR_REVIEW",
  ];

  const activeVersions = versions.filter((v) =>
    reviewStates.includes(v.attributes.appStoreState),
  );
  const latestVersion = versions[0];

  let result = `## Review Status for App ${args.app_id}\n\n`;
  result += `**Latest version**: v${latestVersion.attributes.versionString} (${latestVersion.attributes.platform})\n`;
  result += `**State**: ${formatReviewState(latestVersion.attributes.appStoreState)}\n`;
  result += `**Created**: ${latestVersion.attributes.createdDate.split("T")[0]}\n\n`;

  if (activeVersions.length > 0) {
    const active = activeVersions[0];
    const state = active.attributes.appStoreState;

    if (state === "IN_REVIEW") {
      result += "Your app is **currently being reviewed** by Apple. Typical review time is 24-48 hours.\n";
    } else if (state === "WAITING_FOR_REVIEW") {
      result += "Your app is **in the review queue**. It has not been picked up by a reviewer yet.\n";
    } else if (state === "PENDING_APPLE_RELEASE") {
      result += "Your app has been **approved** and is pending Apple's release. Apple publishes it on its own, so nobody needs to act. The AI can call review_status again later to see it go live.\n";
    } else if (state === "PENDING_DEVELOPER_RELEASE") {
      result += "Your app has been **approved** and is waiting for you to release it. To publish it, the AI calls release_version with confirm: true, but only when the human wants it live now.\n";
    } else if (state === "READY_FOR_REVIEW") {
      result += "Your version is **ready for review** but has not been submitted yet. To send it, the AI calls submit_for_review with confirm: true, once the human agrees.\n";
    }
  } else if (latestVersion.attributes.appStoreState === "READY_FOR_SALE") {
    result += "Your latest version is **live on the App Store**. No pending reviews.\n";
  } else if (latestVersion.attributes.appStoreState === "REJECTED") {
    result += "Your latest version was **rejected**. Apple's API does not return the reasons: the human reads them in App Store Connect > the app > App Review (Resolution Center). Then the AI fixes what it can (update_version_metadata, or a new build with attach_build) and calls submit_for_review with confirm: true.\n";
  } else if (latestVersion.attributes.appStoreState === "METADATA_REJECTED") {
    result += "Your latest version has a **metadata rejection**. The human reads the flagged fields in App Store Connect > the app > App Review (Resolution Center), because Apple's API does not return them. Then the AI fixes them with update_version_metadata, runs release_preflight, and calls submit_for_review with confirm: true.\n";
  } else if (latestVersion.attributes.appStoreState === "PREPARE_FOR_SUBMISSION") {
    result += "Your latest version is **not submitted yet**. The AI runs release_preflight, fixes what it reports, and then calls submit_for_review with confirm: true.\n";
  } else if (latestVersion.attributes.appStoreState === "DEVELOPER_REJECTED") {
    result += "Your latest version was **withdrawn from review** and is still editable. When it is ready, the AI runs release_preflight and calls submit_for_review with confirm: true.\n";
  } else if (latestVersion.attributes.appStoreState === "INVALID_BINARY") {
    result += "Apple rejected this version's **binary**. The human reads the reason in Apple's email or in App Store Connect > the app > App Review. After the fix in Xcode, the AI runs build_and_archive and upload_binary with a higher build number, waits with wait_for_build, attaches the new build with attach_build, and calls submit_for_review with confirm: true.\n";
  }

  // Show all recent versions
  if (versions.length > 1) {
    result += "\n### All Recent Versions\n\n";
    for (const v of versions) {
      result += `- v${v.attributes.versionString} (${v.attributes.platform}): ${formatReviewState(v.attributes.appStoreState)}\n`;
    }
  }

  return result;
}

function formatReviewState(state: string): string {
  const emoji: Record<string, string> = {
    WAITING_FOR_REVIEW: "Waiting for Review",
    IN_REVIEW: "In Review",
    PENDING_APPLE_RELEASE: "Approved - Pending Release",
    PENDING_DEVELOPER_RELEASE: "Approved - Pending Your Release",
    READY_FOR_SALE: "Live",
    REJECTED: "Rejected",
    METADATA_REJECTED: "Metadata Rejected",
    PREPARE_FOR_SUBMISSION: "Preparing",
    READY_FOR_REVIEW: "Ready for Review (not submitted)",
  };
  return emoji[state] || state;
}
