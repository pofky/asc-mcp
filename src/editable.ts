/**
 * The single definition of which App Store version states are still editable
 * (metadata writable, build attachable, submittable). Previously each tool kept
 * its own copy and they drifted (INVALID_BINARY was in one but not the others),
 * so a rejected-binary version could be edited but not re-attached/submitted.
 * Import this everywhere instead of redefining.
 */
export const EDITABLE_VERSION_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  // Binary was rejected; the version is still editable so a new build can be
  // attached and the version resubmitted.
  "INVALID_BINARY",
]);

interface VersionLike {
  attributes: { appStoreState: string; platform?: string; versionString?: string };
}

/**
 * Which version a write is about. An app can have iOS and macOS versions in
 * progress at once, and each tool used to take the first it saw, so a fix for a
 * macOS finding could land on iOS and report success. With one platform in
 * progress this is that version, exactly as before; with more, the caller must say.
 */
export function pickEditableVersion<T extends VersionLike>(
  versions: T[],
  platform?: string,
): { version: T | null; refusal?: string } {
  const open = versions.filter((v) => v && EDITABLE_VERSION_STATES.has(v.attributes.appStoreState));
  const named = open.map((v) => `v${v.attributes.versionString ?? "?"} (${v.attributes.platform ?? "unknown platform"})`).join(", ");
  if (platform) {
    const match = open.find((v) => v.attributes.platform === platform);
    if (match) return { version: match };
    return open.length
      ? { version: null, refusal: `Nothing was changed: no version is in progress on ${platform}. In progress: ${named}.` }
      : { version: null };
  }
  if (new Set(open.map((v) => v.attributes.platform)).size > 1) {
    return { version: null, refusal: `Nothing was changed: this app has versions in progress on more than one platform: ${named}. Pass platform to say which one.` };
  }
  return { version: open[0] ?? null };
}
