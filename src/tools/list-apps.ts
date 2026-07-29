import type { ASCClient } from "../client.js";

interface AppAttributes {
  name: string;
  bundleId: string;
  sku: string;
  primaryLocale: string;
}

export const listAppsDefinition = {
  name: "list_apps",
  description:
    "List all apps in your App Store Connect account with name, bundle ID, and platform.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of apps to return (default 50, max 200)",
      },
    },
  },
};

export async function listApps(
  client: ASCClient,
  args: { limit?: number },
): Promise<string> {
  const limit = Math.min(args.limit ?? 50, 200);
  const response = await client.get<AppAttributes>("/v1/apps", {
    "fields[apps]": "name,bundleId,sku,primaryLocale",
    limit: String(limit),
  });

  const apps = Array.isArray(response.data) ? response.data : [response.data];

  if (apps.length === 0) {
    return "No apps found in your App Store Connect account.";
  }

  const lines = apps.map(
    (app) =>
      `- **${app.attributes.name}** (${app.attributes.bundleId}) - ID: ${app.id}`,
  );

  return `Found ${apps.length} app(s):\n\n${lines.join("\n")}`;
}
