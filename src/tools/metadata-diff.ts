import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface VersionAttributes {
  versionString: string;
  platform: string;
  appStoreState: string;
}

interface LocalizationAttributes {
  locale: string;
  description: string | null;
  keywords: string | null;
  whatsNew: string | null;
  promotionalText: string | null;
  supportUrl: string | null;
  marketingUrl: string | null;
}

export const metadataDiffDefinition = {
  name: "metadata_diff",
  description:
    "Compare metadata between two app versions (e.g., live vs pending). Shows what changed in descriptions, keywords, promotional text, and 'What's New' across locales. Helps verify changes before submission.",
  inputSchema: {
    type: "object" as const,
    properties: {
      app_id: {
        type: "string",
        description: "Your App Store Connect app ID. Use list_apps to find it.",
      },
    },
    required: ["app_id"],
  },
};

async function getLocalizations(
  client: ASCClient,
  versionId: string,
): Promise<Map<string, LocalizationAttributes>> {
  const resp = await client.get<LocalizationAttributes>(
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    {
      "fields[appStoreVersionLocalizations]":
        "locale,description,keywords,whatsNew,promotionalText,supportUrl,marketingUrl",
      limit: "30",
    },
  );
  const locs = Array.isArray(resp.data) ? resp.data : [resp.data];
  const map = new Map<string, LocalizationAttributes>();
  for (const loc of locs) {
    map.set(loc.attributes.locale, loc.attributes);
  }
  return map;
}

function diffField(
  field: string,
  oldVal: string | null,
  newVal: string | null,
): string | null {
  const a = (oldVal || "").trim();
  const b = (newVal || "").trim();

  if (a === b) return null;

  if (!a && b) return `  + **${field}**: added (${b.length} chars)`;
  if (a && !b) return `  - **${field}**: REMOVED`;
  if (a.length !== b.length) {
    return `  ~ **${field}**: changed (${a.length} -> ${b.length} chars)`;
  }
  return `  ~ **${field}**: content changed (same length: ${a.length} chars)`;
}

export async function metadataDiff(
  client: ASCClient,
  args: { app_id: string },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Metadata diff", "metadata_diff");
  if (gate) return gate;

  // Get all versions
  const versionsResp = await client.get<VersionAttributes>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    {
      "fields[appStoreVersions]": "versionString,platform,appStoreState",
      limit: "10",
    },
  );

  const versions = Array.isArray(versionsResp.data)
    ? versionsResp.data
    : [versionsResp.data];

  if (versions.length < 2) {
    if (versions.length === 1) {
      return (
        `Only one version found (v${versions[0].attributes.versionString}, ${versions[0].attributes.appStoreState}).\n` +
        "Metadata diff requires at least two versions to compare.\n" +
        "Use release_preflight to audit the current version instead."
      );
    }
    return "No versions found for this app.";
  }

  // Find the right pair: ideally pending vs live
  const liveStates = ["READY_FOR_SALE"];
  const pendingStates = [
    "PREPARE_FOR_SUBMISSION",
    "READY_FOR_REVIEW",
    "WAITING_FOR_REVIEW",
    "IN_REVIEW",
    "DEVELOPER_REJECTED",
  ];

  const liveVersion = versions.find((v) =>
    liveStates.includes(v.attributes.appStoreState),
  );
  const pendingVersion = versions.find((v) =>
    pendingStates.includes(v.attributes.appStoreState),
  );

  // Fall back to comparing the two most recent versions
  const olderVersion = liveVersion || versions[1];
  const newerVersion = pendingVersion || versions[0];

  if (olderVersion.id === newerVersion.id) {
    return "Could not find two distinct versions to compare. Only one active version exists.";
  }

  let result = `## Metadata Diff\n\n`;
  result += `**Comparing**: v${olderVersion.attributes.versionString} (${olderVersion.attributes.appStoreState}) `;
  result += `-> v${newerVersion.attributes.versionString} (${newerVersion.attributes.appStoreState})\n\n`;

  // Fetch localizations for both
  let olderLocs: Map<string, LocalizationAttributes>;
  let newerLocs: Map<string, LocalizationAttributes>;

  try {
    olderLocs = await getLocalizations(client, olderVersion.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not fetch localizations for v${olderVersion.attributes.versionString}: ${msg}`;
  }

  try {
    newerLocs = await getLocalizations(client, newerVersion.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Could not fetch localizations for v${newerVersion.attributes.versionString}: ${msg}`;
  }

  // Compare each locale
  const allLocales = new Set([...olderLocs.keys(), ...newerLocs.keys()]);
  let totalChanges = 0;
  let localesWithChanges = 0;

  const fields: (keyof LocalizationAttributes)[] = [
    "description",
    "keywords",
    "whatsNew",
    "promotionalText",
    "supportUrl",
    "marketingUrl",
  ];

  for (const locale of [...allLocales].sort()) {
    const older = olderLocs.get(locale);
    const newer = newerLocs.get(locale);

    if (!older && newer) {
      result += `### ${locale} (NEW locale added)\n`;
      for (const field of fields) {
        const val = newer[field];
        if (val) {
          result += `  + **${field}**: ${String(val).length} chars\n`;
          totalChanges++;
        }
      }
      localesWithChanges++;
      result += "\n";
      continue;
    }

    if (older && !newer) {
      result += `### ${locale} (REMOVED)\n\n`;
      localesWithChanges++;
      totalChanges++;
      continue;
    }

    if (!older || !newer) continue;

    // Both exist, diff each field
    const diffs: string[] = [];
    for (const field of fields) {
      const d = diffField(field, older[field], newer[field]);
      if (d) {
        diffs.push(d);
        totalChanges++;
      }
    }

    if (diffs.length > 0) {
      result += `### ${locale} (${diffs.length} change${diffs.length > 1 ? "s" : ""})\n`;
      for (const d of diffs) {
        result += d + "\n";
      }
      result += "\n";
      localesWithChanges++;
    }
  }

  if (totalChanges === 0) {
    result += "**No metadata differences found** between these versions.\n";
    result += "The versions may differ only in binary/build, not metadata.\n";
  } else {
    result += `---\n`;
    result += `**Summary**: ${totalChanges} change${totalChanges > 1 ? "s" : ""} across ${localesWithChanges} locale${localesWithChanges > 1 ? "s" : ""} (${allLocales.size} total locales checked)\n`;
  }

  return result;
}
