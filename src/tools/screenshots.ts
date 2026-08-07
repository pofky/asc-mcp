import { readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { resolveLocalization } from "../locale.js";

interface VersionAttrs {
  appStoreState: string;
}
interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders?: { name: string; value: string }[];
}
interface ScreenshotAttrs {
  fileName: string;
  fileSize: number;
  uploadOperations?: UploadOperation[];
}
interface SetAttrs {
  screenshotDisplayType: string;
}

const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
]);

/**
 * Upload one or more screenshots to a version localization for a given device
 * display type. Implements Apple's 3-step flow: reserve (POST appScreenshots),
 * PUT each chunk to the returned upload URLs, then commit (PATCH uploaded:true
 * with the file's MD5 checksum).
 */
export async function uploadScreenshots(
  client: ASCClient,
  args: {
    app_id: string;
    display_type: string;
    files: string[];
    locale?: string;
  },
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Uploading screenshots", "upload_screenshots");
  if (gate) return gate;

  if (!args.files?.length) return "No files provided.";
  const missing = args.files.filter((f) => !existsSync(f));
  if (missing.length) return `File(s) not found:\n- ${missing.join("\n- ")}`;

  // 1. Find editable version + the requested localization.
  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "appStoreState", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const version = versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
  if (!version) return "No editable version. Create one with create_version first.";

  const locsRes = await client.get<{ locale: string }>(
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
    { "fields[appStoreVersionLocalizations]": "locale", limit: "50" },
  );
  const locs = Array.isArray(locsRes.data) ? locsRes.data : [locsRes.data];
  const picked = await resolveLocalization(client, args.app_id, locs, args.locale, "the editable version");
  if ("error" in picked) return picked.error;
  const loc = picked.loc;

  // 2. Get or create the screenshot set for this display type.
  const setsRes = await client.get<SetAttrs>(
    `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
    { "fields[appScreenshotSets]": "screenshotDisplayType", limit: "50" },
  );
  const sets = Array.isArray(setsRes.data) ? setsRes.data : [setsRes.data];
  let set = sets.find((s) => s.attributes.screenshotDisplayType === args.display_type);
  if (!set) {
    const created = await client.post<SetAttrs>("/v1/appScreenshotSets", {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: args.display_type },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: "appStoreVersionLocalizations", id: loc.id },
          },
        },
      },
    });
    if (!created || Array.isArray(created.data)) return "Failed to create screenshot set.";
    set = { type: "appScreenshotSets", id: created.data.id, attributes: created.data.attributes } as never;
  }
  const setId = (set as { id: string }).id;

  const uploaded: string[] = [];
  for (const file of args.files) {
    const data = readFileSync(file);
    const fileName = basename(file);
    const fileSize = statSync(file).size;

    // 2a. Reserve.
    const reserveRes = await client.post<ScreenshotAttrs>("/v1/appScreenshots", {
      data: {
        type: "appScreenshots",
        attributes: { fileName, fileSize },
        relationships: {
          appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } },
        },
      },
    });
    if (!reserveRes || Array.isArray(reserveRes.data)) {
      return `Reservation failed for ${fileName}.`;
    }
    const shotId = reserveRes.data.id;
    const ops = reserveRes.data.attributes.uploadOperations ?? [];

    // 2b. PUT each chunk.
    for (const op of ops) {
      const chunk = data.subarray(op.offset, op.offset + op.length);
      const headers: Record<string, string> = {};
      for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
      const put = await fetch(op.url, { method: op.method, headers, body: chunk });
      if (!put.ok) {
        return `Chunk upload failed for ${fileName} (HTTP ${put.status}).`;
      }
    }

    // 2c. Commit with checksum.
    const checksum = createHash("md5").update(data).digest("hex");
    await client.patch(`/v1/appScreenshots/${shotId}`, {
      data: {
        type: "appScreenshots",
        id: shotId,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    });
    uploaded.push(fileName);
  }

  return (
    `Uploaded ${uploaded.length} screenshot(s) to ${args.display_type} (${loc.attributes.locale}):\n` +
    uploaded.map((f) => `- ${f}`).join("\n")
  );
}
