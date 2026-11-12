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
  if (args.limit !== undefined && !(args.limit >= 1)) return "Error: limit must be between 1 and 200.";
  const limit = Math.min(args.limit ?? 50, 200);
  const response = await client.get<AppAttributes>("/v1/apps", {
    "fields[apps]": "name,bundleId,sku,primaryLocale",
    limit: String(limit),
  });

  const apps = Array.isArray(response.data) ? response.data : [response.data];

  if (apps.length === 0) {
    return "No apps found in your App Store Connect account. Either this API key belongs to a different team than the app, or no app record exists yet. Apps cannot be created through the API: the human creates the app in App Store Connect > Apps > + > New App, or makes an API key in the right team. Then the AI calls list_apps again.";
  }

  // SKU is already in the response, and it is the identifier Sales and Trends
  // reports key on, so a user reconciling revenue needs it. It was fetched and
  // then dropped, while the docs promised it.
  const lines = apps.map((app) => {
    const sku = app.attributes.sku ? `, SKU: ${app.attributes.sku}` : "";
    return `- **${app.attributes.name}** (${app.attributes.bundleId}) - ID: ${app.id}${sku}`;
  });

  return `Found ${apps.length} app(s):\n\n${lines.join("\n")}`;
}
