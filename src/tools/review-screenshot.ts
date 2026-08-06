import { readFileSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders?: { name: string; value: string }[];
}
interface MediaAttrs {
  fileName: string;
  fileSize: number;
  uploadOperations?: UploadOperation[];
}

/** Reserve -> PUT chunks -> commit, for any ASC media resource. */
async function reserveUploadCommit(
  client: ASCClient,
  reserveType: string,
  reservePath: string,
  relationships: Record<string, unknown>,
  file: string,
): Promise<string | null> {
  const data = readFileSync(file);
  const fileName = basename(file);
  const fileSize = statSync(file).size;

  const reserve = await client.post<MediaAttrs>(reservePath, {
    data: { type: reserveType, attributes: { fileName, fileSize }, relationships },
  });
  if (!reserve || Array.isArray(reserve.data)) return `Reservation failed for ${fileName}.`;
  const id = reserve.data.id;
  const ops = reserve.data.attributes.uploadOperations ?? [];

  for (const op of ops) {
    const chunk = data.subarray(op.offset, op.offset + op.length);
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    const put = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!put.ok) return `Chunk upload failed for ${fileName} (HTTP ${put.status}).`;
  }

  const checksum = createHash("md5").update(data).digest("hex");
  await client.patch(`/${reservePath.split("/")[1]}/${reserveType}/${id}`, {
    data: { type: reserveType, id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
  });
  return null;
}

export interface ReviewScreenshotArgs {
  app_id: string;
  product_id: string;
  file: string;
}

/**
 * Upload the App Review screenshot a subscription or in-app purchase needs
 * before it can leave MISSING_METADATA. Resolves the product by product_id and
 * targets the correct review-screenshot resource automatically.
 */
export async function setIapReviewScreenshot(
  client: ASCClient,
  args: ReviewScreenshotArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Uploading an IAP review screenshot", "set_iap_review_screenshot");
  if (gate) return gate;

  if (!existsSync(args.file)) return `File not found: ${args.file}`;

  // Look for the product among subscriptions first, then one-time IAPs.
  const groupsRes = await client.get<Record<string, never>>(
    `/v1/apps/${args.app_id}/subscriptionGroups`,
    { include: "subscriptions", limit: "25" },
  );
  const subs = ((groupsRes as { included?: Array<{ type: string; id: string; attributes: { productId: string } }> }).included ?? [])
    .filter((x) => x.type === "subscriptions");
  const sub = subs.find((s) => s.attributes.productId === args.product_id);

  if (sub) {
    // Replace any existing screenshot to stay idempotent.
    const existing = await client.get<Record<string, never>>(
      `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`,
    ).catch(() => null);
    const existingId = existing && existing.data && !Array.isArray(existing.data) ? existing.data.id : null;
    if (existingId) await client.del(`/v1/subscriptionAppStoreReviewScreenshots/${existingId}`).catch(() => null);

    const err = await reserveUploadCommit(
      client,
      "subscriptionAppStoreReviewScreenshots",
      "/v1/subscriptionAppStoreReviewScreenshots",
      { subscription: { data: { type: "subscriptions", id: sub.id } } },
      args.file,
    );
    return err ?? `Review screenshot uploaded for subscription ${args.product_id}.`;
  }

  const iapsRes = await client.get<{ productId: string }>(
    `/v1/apps/${args.app_id}/inAppPurchasesV2`,
    { "fields[inAppPurchases]": "productId", limit: "100" },
  );
  const iaps = (Array.isArray(iapsRes.data) ? iapsRes.data : [iapsRes.data]).filter(Boolean);
  const iap = iaps.find((i) => i.attributes.productId === args.product_id);
  if (!iap) return `Product "${args.product_id}" not found among subscriptions or in-app purchases.`;

  const existing = await client.get<Record<string, never>>(
    `/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`,
  ).catch(() => null);
  const existingId = existing && existing.data && !Array.isArray(existing.data) ? existing.data.id : null;
  if (existingId) await client.del(`/v1/inAppPurchaseAppStoreReviewScreenshots/${existingId}`).catch(() => null);

  const err = await reserveUploadCommit(
    client,
    "inAppPurchaseAppStoreReviewScreenshots",
    "/v1/inAppPurchaseAppStoreReviewScreenshots",
    { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iap.id } } },
    args.file,
  );
  return err ?? `Review screenshot uploaded for in-app purchase ${args.product_id}.`;
}
