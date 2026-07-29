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
