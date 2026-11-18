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
    "Check the current App Store review status for an app. Shows whether the app is in review, waiting for review, approved, or rejected, which build the version carries, and each in-app purchase and subscription's review state, so you can see whether the products went with the version.",
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
        "versionString,platform,appStoreState,createdDate,build",
      include: "build",
      "fields[builds]": "version,processingState",
      limit: "5",
    },
  );
  const buildNumbers = buildsByVersion(versionsResponse as unknown as RawVersionsResponse);

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
  result += `**Created**: ${latestVersion.attributes.createdDate.split("T")[0]}\n`;
  const shown = activeVersions[0] ?? latestVersion;
  result += `**Build**: ${buildLine(buildNumbers.get(shown.id))}\n\n`;

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
      result += `- v${v.attributes.versionString} (${v.attributes.platform}): ${formatReviewState(v.attributes.appStoreState)}, build ${buildNumbers.get(v.id) ?? "none"}\n`;
    }
  }

  result += await productsSection(client, args.app_id, shown.attributes.appStoreState);
  return result;
}

interface RawVersionsResponse {
  data: Array<{ id: string; relationships?: { build?: { data?: { id: string } | null } } }> | { id: string; relationships?: { build?: { data?: { id: string } | null } } };
  included?: Array<{ type: string; id: string; attributes?: { version?: string; processingState?: string } }>;
}

/** Version id to its attached build number, from `include=build`. */
function buildsByVersion(res: RawVersionsResponse): Map<string, string> {
  const builds = new Map<string, string>();
  for (const b of res.included ?? []) {
    if (b.type === "builds" && b.attributes?.version) builds.set(b.id, b.attributes.version);
  }
  const out = new Map<string, string>();
  for (const v of Array.isArray(res.data) ? res.data : [res.data]) {
    const id = v?.relationships?.build?.data?.id;
    if (id) out.set(v.id, builds.get(id) ?? id);
  }
  return out;
}

function buildLine(build: string | undefined): string {
  return build
    ? `${build} attached`
    : "none attached. Apple will not review a version without a build: the AI calls list_builds, then attach_build.";
}

/** Product states that mean the product is not in any review right now. */
const NOT_SENT = new Set(["READY_TO_SUBMIT", "MISSING_METADATA", "WAITING_FOR_UPLOAD", "DEVELOPER_ACTIONS_NEEDED", "REJECTED"]);
/** Product states that mean the product went to review. */
const SENT = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_BINARY_APPROVAL"]);
const IN_QUEUE = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW"]);

interface ProductRow { productId: string; state: string; kind: string }

/**
 * Each in-app purchase and subscription with its review state. Without this,
 * "did the products go with the version?" needed a script: a version can sit in
 * review while its first products stay READY_TO_SUBMIT, and Apple then rejects
 * it under 3.1.1 for offering purchases it was not given to review.
 * Each read is best effort: a product list that cannot be read is named, never
 * reported as "no products".
 */
async function productsSection(client: ASCClient, appId: string, versionState: string): Promise<string> {
  const rows: ProductRow[] = [];
  const unread: string[] = [];
  try {
    const res = await client.get<{ productId: string; state: string }>(`/v1/apps/${appId}/inAppPurchasesV2`, {
      "fields[inAppPurchases]": "productId,state",
      limit: "200",
    });
    for (const i of (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean)) {
      rows.push({ productId: i.attributes.productId, state: i.attributes.state, kind: "in-app purchase" });
    }
  } catch {
    unread.push("in-app purchases");
  }
  try {
    const res = (await client.get<Record<string, never>>(`/v1/apps/${appId}/subscriptionGroups`, {
      include: "subscriptions",
      "fields[subscriptions]": "productId,state",
      limit: "50",
    })) as unknown as { included?: Array<{ type: string; attributes: { productId: string; state: string } }> };
    for (const s of (res.included ?? []).filter((x) => x.type === "subscriptions")) {
      rows.push({ productId: s.attributes.productId, state: s.attributes.state, kind: "subscription" });
    }
  } catch {
    unread.push("subscriptions");
  }

  if (rows.length === 0 && unread.length === 0) return "";
  let out = "\n### In-app purchases and subscriptions\n\n";
  for (const r of rows) out += `- ${r.productId} (${r.kind}): ${r.state}\n`;
  if (unread.length) out += `- Could not read ${unread.join(" or ")} just now; call review_status again before concluding there are none.\n`;

  if (IN_QUEUE.has(versionState)) {
    const left = rows.filter((r) => NOT_SENT.has(r.state));
    const went = rows.filter((r) => SENT.has(r.state));
    if (left.length) {
      out += `\n**Not in this review**: ${left.map((r) => r.productId).join(", ")}. The version is in review without them. If the app offers them, Apple can reject it (guideline 3.1.1). The AI calls cancel_submission with confirm: true once the human agrees, then submits again with the products; an app's first products are added to the version on the App Store Connect website.\n`;
    } else if (went.length) {
      out += `\nAll ${went.length} product(s) went to review with this version.\n`;
    }
  }
  return out;
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
