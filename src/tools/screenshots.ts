import { readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { pickEditableVersion } from "../editable.js";
import { requirePro } from "../gate.js";
import { resolveLocalization } from "../locale.js";
import { readImageSize } from "../image-size.js";

/**
 * Pixel sizes (portrait; landscape is the transpose) Apple accepts per display
 * type. Source: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 * A display type not listed here, or an image whose header cannot be read, is not checked locally: Apple decides.
 */
const IPHONE_LARGE: [number, number][] = [[1260, 2736], [1290, 2796], [1320, 2868]];
const IPHONE_65: [number, number][] = [[1284, 2778], [1242, 2688]];
const IPHONE_61: [number, number][] = [[1179, 2556], [1170, 2532], [1125, 2436], [1080, 2340]];
const IPAD_13: [number, number][] = [[2064, 2752], [2048, 2732]];
export const ACCEPTED_SIZES: Record<string, [number, number][]> = {
  APP_IPHONE_67: IPHONE_LARGE,
  APP_IPHONE_69: IPHONE_LARGE,
  APP_IPHONE_65: IPHONE_65,
  APP_IPHONE_61: IPHONE_61,
  APP_IPAD_PRO_3GEN_129: IPAD_13,
  APP_IPAD_PRO_129: IPAD_13,
  APP_IPAD_PRO_3GEN_11: [[1488, 2266], [1512, 2316], [1668, 2420], [1668, 2388], [1640, 2360]],
};

/** Refusal text naming the accepted sizes, or null when the file fits (or the type is unchecked). */
export function sizeRefusal(displayType: string, file: string, data: Buffer): string | null {
  const accepted = ACCEPTED_SIZES[displayType];
  if (!accepted) return null;
  const size = readImageSize(data);
  const list = accepted.map(([w, h]) => `${w}x${h}`).join(", ");
  // Unreadable header: let Apple decide rather than block on a parser gap.
  if (!size) return null;
  const ok = accepted.some(([w, h]) => (size.width === w && size.height === h) || (size.width === h && size.height === w));
  if (ok) return null;
  return (
    `${basename(file)} is ${size.width}x${size.height}, which ${displayType} does not accept, so nothing was uploaded. ` +
    `Accepted sizes (portrait or landscape): ${list}. The human or AI recaptures or resizes the screenshot, or picks the display_type that matches this size, then calls upload_screenshots again.`
  );
}

/** Delivery-state polling after commit. Overridable so tests run instantly. */
export interface DeliveryPoll { attempts: number; delayMs: number }
const DEFAULT_POLL: DeliveryPoll = { attempts: 6, delayMs: 2000 };


interface VersionAttrs {
  appStoreState: string;
  versionString: string;
  platform: string;
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


/**
 * What a stopped run leaves behind and what the AI does next. Earlier files in
 * the same call are already committed to Apple, so they must not be sent twice.
 * The set is found again by display type, so a second call adds to it.
 */
function stoppedNote(uploaded: string[], files: string[], failedFile: string, tool: string): string {
  const remaining = files.filter((f) => !uploaded.includes(basename(f)));
  return (
    (uploaded.length
      ? `Already uploaded before the failure: ${uploaded.join(", ")}. `
      : "Nothing was uploaded before the failure. ") +
    `${failedFile} may remain in the set as an incomplete entry, which the human deletes in App Store Connect > the app > the version > screenshots if it shows an error. ` +
    `The AI calls ${tool} again with only the files that are left (the set for this display_type is reused, so earlier uploads are not repeated): ${remaining.join(", ")}.`
  );
}

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
    platform?: string;
    /** Delete the screenshots already in this display type's set first. Outward-facing: needs confirm. */
    replace?: boolean;
    confirm?: boolean;
  },
  tier: Tier,
  poll: DeliveryPoll = DEFAULT_POLL,
): Promise<string> {
  const gate = requirePro(tier, "Uploading screenshots", "upload_screenshots");
  if (gate) return gate;

  if (!args.files?.length) {
    return 'No files provided. The AI calls upload_screenshots again with files as an array of absolute paths to PNG or JPEG files, in display order, for example ["/Users/name/shots/1.png", "/Users/name/shots/2.png"].';
  }
  const missing = args.files.filter((f) => !existsSync(f));
  if (missing.length) return `File(s) not found:\n- ${missing.join("\n- ")}`;
  // Check every file's pixel size before anything is reserved or deleted.
  for (const f of args.files) {
    const refusal = sizeRefusal(args.display_type, f, readFileSync(f));
    if (refusal) return refusal;
  }

  // 1. Find editable version + the requested localization.
  const versionsRes = await client.get<VersionAttrs>(
    `/v1/apps/${args.app_id}/appStoreVersions`,
    { "fields[appStoreVersions]": "versionString,appStoreState,platform", limit: "5" },
  );
  const versions = Array.isArray(versionsRes.data) ? versionsRes.data : [versionsRes.data];
  const { version, refusal } = pickEditableVersion(versions, args.platform);
  if (refusal) return refusal;
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
  let deleted = 0;
  if (args.replace && set) {
    const existingRes = await client.get<unknown>(`/v1/appScreenshotSets/${set.id}/appScreenshots`, { limit: "50" });
    const existing = (Array.isArray(existingRes.data) ? existingRes.data : [existingRes.data]).filter(Boolean);
    if (existing.length && !args.confirm) {
      return (
        `replace: true deletes the ${existing.length} screenshot(s) now in ${args.display_type} (${loc.attributes.locale}) before uploading ${args.files.length} new one(s). ` +
        "This changes what the App Store listing shows (outward-facing). Nothing was changed. Re-run with replace: true and confirm: true."
      );
    }
    for (const e of existing) {
      await client.del(`/v1/appScreenshots/${e.id}`);
      deleted++;
    }
  }
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
    if (!created || Array.isArray(created.data)) {
      return (
        `Apple did not create the screenshot set for ${args.display_type}, so nothing was uploaded. ` +
        "The AI checks that display_type is one Apple accepts (for example APP_IPHONE_67 or APP_IPAD_PRO_3GEN_129) and calls upload_screenshots again with the same files."
      );
    }
    set = { type: "appScreenshotSets", id: created.data.id, attributes: created.data.attributes } as never;
  }
  const setId = (set as { id: string }).id;

  const uploaded: string[] = [];
  const shotIds: Record<string, string> = {};
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
      return `Reservation failed for ${fileName}: Apple did not accept the upload request. ${stoppedNote(uploaded, args.files, fileName, "upload_screenshots")}`;
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
        return `Chunk upload failed for ${fileName} (HTTP ${put.status}). ${stoppedNote(uploaded, args.files, fileName, "upload_screenshots")}`;
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
    shotIds[fileName] = shotId;
  }

  // 3. Commit is accepted before Apple has processed the image. Poll briefly.
  const states: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (let n = 0; n < poll.attempts; n++) {
    let pending = 0;
    for (const [name, id] of Object.entries(shotIds)) {
      if (states[name] === "COMPLETE" || states[name] === "FAILED") continue;
      try {
        const r = await client.get<{ assetDeliveryState?: { state?: string; errors?: { code?: string; description?: string }[] } }>(`/v1/appScreenshots/${id}`, {
          "fields[appScreenshots]": "assetDeliveryState",
        });
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        const st = d?.attributes?.assetDeliveryState;
        states[name] = st?.state ?? "UNKNOWN";
        if (st?.errors?.length) errors[name] = st.errors.map((e) => e.description || e.code).join("; ");
      } catch {
        states[name] = "UNKNOWN";
      }
      if (states[name] !== "COMPLETE" && states[name] !== "FAILED") pending++;
    }
    if (!pending) break;
    if (n < poll.attempts - 1 && poll.delayMs > 0) await new Promise((r) => setTimeout(r, poll.delayMs));
  }
  const failed = uploaded.filter((f) => states[f] === "FAILED");
  const waiting = uploaded.filter((f) => states[f] !== "COMPLETE" && states[f] !== "FAILED");
  const head = deleted ? `Deleted ${deleted} existing screenshot(s). ` : "";
  let out =
    `${head}Committed ${uploaded.length} screenshot(s) to ${args.display_type} (${loc.attributes.locale}):\n` +
    uploaded.map((f) => `- ${f}: ${states[f] ?? "not checked"}${errors[f] ? ` (${errors[f]})` : ""}`).join("\n");
  if (failed.length) {
    out += `\n\nApple rejected ${failed.join(", ")}. The human deletes the failed entry in App Store Connect if it remains, the AI fixes the image (size, no alpha channel) and calls upload_screenshots again with only those files.`;
  } else if (waiting.length) {
    out += `\n\nApple had not finished processing ${waiting.join(", ")} after ${poll.attempts} checks. This is not confirmed yet: the AI calls release_preflight or list again later to see the state.`;
  } else {
    out += "\n\nApple finished processing all of them (COMPLETE).";
  }
  return out;
}
