import type { ASCClient } from "../client.js";

interface AppAttributes {
  name: string;
  bundleId: string;
  sku: string;
  primaryLocale: string;
  contentRightsDeclaration?: string;
}

interface VersionAttributes {
  versionString: string;
  platform: string;
  appStoreState: string;
  createdDate: string;
  releaseType?: string;
  earliestReleaseDate?: string;
}

export const appDetailsDefinition = {
  name: "app_details",
  description:
    "Get detailed information about an app including its latest version, build status, and release state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description:
          "The App Store Connect app ID (numeric string). Use list_apps to find it.",
      },
    },
    required: ["app_id"],
  },
};

export async function appDetails(
  client: ASCClient,
  args: { app_id: string },
): Promise<string> {
  const appResponse = await client.get<AppAttributes>(
    `/v1/apps/${args.app_id}`,
    {
      "fields[apps]": "name,bundleId,sku,primaryLocale,contentRightsDeclaration",
    },
  );

  const app = Array.isArray(appResponse.data)
    ? appResponse.data[0]
    : appResponse.data;

  // Fetch latest versions
  const versionsResponse = await client.get<VersionAttributes>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    {
      "fields[appStoreVersions]":
        "versionString,platform,appStoreState,createdDate,releaseType,earliestReleaseDate",
      limit: "5",
    },
  );

  const versions = Array.isArray(versionsResponse.data)
    ? versionsResponse.data
    : [versionsResponse.data];

  let result = `## ${app.attributes.name}\n\n`;
  result += `- **Bundle ID**: ${app.attributes.bundleId}\n`;
  result += `- **SKU**: ${app.attributes.sku}\n`;
  result += `- **Primary Locale**: ${app.attributes.primaryLocale}\n`;
  result += `- **App ID**: ${app.id}\n\n`;

  if (versions.length > 0) {
    result += `### Recent Versions\n\n`;
    for (const v of versions) {
      const state = formatState(v.attributes.appStoreState);
      result += `- **v${v.attributes.versionString}** (${v.attributes.platform}) - ${state}`;
      if (v.attributes.createdDate) {
        result += ` - created ${v.attributes.createdDate.split("T")[0]}`;
      }
      result += "\n";
    }
  } else {
    result += "No versions found.\n";
  }

  return result;
}

function formatState(state: string): string {
  const stateMap: Record<string, string> = {
    ACCEPTED: "Accepted",
    DEVELOPER_REJECTED: "Developer Rejected",
    DEVELOPER_REMOVED_FROM_SALE: "Removed from Sale",
    IN_REVIEW: "In Review",
    INVALID_BINARY: "Invalid Binary",
    METADATA_REJECTED: "Metadata Rejected",
    PENDING_APPLE_RELEASE: "Pending Apple Release",
    PENDING_CONTRACT: "Pending Contract",
    PENDING_DEVELOPER_RELEASE: "Pending Developer Release",
    PREPARE_FOR_SUBMISSION: "Prepare for Submission",
    PREORDER_READY_FOR_SALE: "Preorder Ready for Sale",
    PROCESSING_FOR_APP_STORE: "Processing for App Store",
    READY_FOR_REVIEW: "Ready for Review",
    READY_FOR_SALE: "Ready for Sale",
    REJECTED: "Rejected",
    REPLACED_WITH_NEW_VERSION: "Replaced with New Version",
    WAITING_FOR_EXPORT_COMPLIANCE: "Waiting for Export Compliance",
    WAITING_FOR_REVIEW: "Waiting for Review",
  };
  return stateMap[state] || state;
}
