import type { ASCClient } from "./client.js";
import { EDITABLE_VERSION_STATES } from "./editable.js";

/**
 * An app can have more than one appInfo at once: the live record plus the one
 * belonging to the version being prepared. Apple returns the live record first,
 * so `limit: "1"` picks the locked one and every write against it fails with
 * 409 "The field 'name' can not be modified in the current state" (reported by
 * a customer on v1.8.2 for name/subtitle, and the same path carries
 * privacyPolicyUrl, categories and the age-rating declaration).
 *
 * Always resolve the appInfo through here.
 */
export interface AppInfoRecord {
  id: string;
  /** appStoreState if present, else the newer `state` attribute. */
  state: string | null;
  editable: boolean;
  raw: {
    id: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, { data?: { id?: string } }>;
  };
}

/**
 * `appStoreState` uses the version vocabulary (READY_FOR_SALE) and `state` the
 * newer appInfo vocabulary (READY_FOR_DISTRIBUTION). The editable states are
 * spelled the same in both, so one set covers either field.
 */
function isEditableState(state: string | null): boolean {
  return !!state && EDITABLE_VERSION_STATES.has(state);
}

/** States that mean "this is the record already on the store", not the draft. */
const LIVE_STATES = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"]);

export async function fetchAppInfos(
  client: ASCClient,
  appId: string,
  params: Record<string, string> = {},
): Promise<{ infos: AppInfoRecord[]; included?: Array<{ type: string; id: string; attributes?: Record<string, unknown> }> }> {
  const res = await client.get<Record<string, unknown>>(`/v1/apps/${appId}/appInfos`, {
    limit: "50",
    "fields[appInfos]": "appStoreState,state",
    ...params,
  });
  const raw = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean) as AppInfoRecord["raw"][];
  const infos = raw.map((r) => {
    const attrs = (r.attributes ?? {}) as { appStoreState?: string; state?: string };
    const state = attrs.appStoreState ?? attrs.state ?? null;
    return { id: r.id, state, editable: isEditableState(state), raw: r };
  });
  const included = (res as { included?: Array<{ type: string; id: string; attributes?: Record<string, unknown> }> })
    .included;
  return { infos, included };
}

/** The appInfo a write must target, or null when the app has no editable one. */
export function pickEditableAppInfo(infos: AppInfoRecord[]): AppInfoRecord | null {
  return infos.find((i) => i.editable) ?? null;
}

/**
 * The appInfo a read should describe: the draft if there is one, otherwise
 * whatever the app has. Preflight audits the submission in progress, so
 * reporting the live name while a rename is pending would be wrong.
 */
export function pickAuditAppInfo(infos: AppInfoRecord[]): AppInfoRecord | null {
  return (
    infos.find((i) => i.editable) ??
    infos.find((i) => !LIVE_STATES.has(i.state ?? "")) ??
    infos[0] ??
    null
  );
}

/** Why a write cannot proceed, naming the states actually present. */
export function noEditableAppInfoMessage(infos: AppInfoRecord[], what: string): string {
  if (!infos.length) {
    return `No appInfo found for this app, so ${what} cannot be set. Confirm the app_id is correct.`;
  }
  const states = infos.map((i) => i.state ?? "unknown").join(", ");
  return (
    `No editable appInfo for this app, so ${what} cannot be changed right now. ` +
    `Current appInfo state(s): ${states}. These fields are app-level, not version-level: ` +
    `Apple locks them while the app is in review or already live. ` +
    `Create or reopen an editable version (create_version), or wait for the current review to finish, then retry.`
  );
}
