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
    return "No versions found for this app.";
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
      result += "Your app has been **approved** and is pending Apple's release.\n";
    } else if (state === "PENDING_DEVELOPER_RELEASE") {
      result += "Your app has been **approved** and is waiting for you to release it.\n";
    } else if (state === "READY_FOR_REVIEW") {
      result += "Your version is **ready for review** but has not been submitted yet.\n";
    }
  } else if (latestVersion.attributes.appStoreState === "READY_FOR_SALE") {
    result += "Your latest version is **live on the App Store**. No pending reviews.\n";
  } else if (latestVersion.attributes.appStoreState === "REJECTED") {
    result += "Your latest version was **rejected**. Check App Store Connect for rejection details.\n";
  } else if (latestVersion.attributes.appStoreState === "METADATA_REJECTED") {
    result += "Your latest version has a **metadata rejection**. Update metadata and resubmit.\n";
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
