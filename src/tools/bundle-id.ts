import { ASCAPIError, type ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

interface BundleIdAttrs {
  identifier: string;
  name: string;
  platform: string;
}

export interface RegisterBundleIdArgs {
  /** Reverse-DNS explicit id, e.g. app.example.ios. Wildcards are not accepted. */
  identifier: string;
  /** Name shown in the Developer portal. Apple allows letters, digits and spaces only. */
  name: string;
  platform?: "IOS" | "MAC_OS" | "UNIVERSAL";
  /** Apple capability types to turn on, e.g. PUSH_NOTIFICATIONS, ICLOUD. Already-on ones are left alone. */
  capabilities?: string[];
  confirm?: boolean;
}

/**
 * Capability types Apple's bundleIdCapabilities endpoint accepts, from the App
 * Store Connect API CapabilityType enum. App Groups need a group id Apple's API
 * cannot create, so APP_GROUPS turns the capability on but the group itself is
 * still made in the Developer portal (named in the reply).
 */
export const CAPABILITY_TYPES = [
  "ACCESS_WIFI_INFORMATION", "APPLE_ID_AUTH", "APPLE_PAY", "APP_ATTEST", "APP_GROUPS", "ASSOCIATED_DOMAINS",
  "AUTOFILL_CREDENTIAL_PROVIDER", "CLASSKIT", "COREMEDIA_HLS_LOW_LATENCY", "DATA_PROTECTION", "EXTENDED_VIRTUAL_ADDRESSING",
  "FONT_INSTALLATION", "GAME_CENTER", "HEALTHKIT", "HOMEKIT", "HOT_SPOT", "ICLOUD", "INCREASED_MEMORY_LIMIT", "IN_APP_PURCHASE",
  "INTER_APP_AUDIO", "MAPS", "MULTIPATH", "NETWORK_CUSTOM_PROTOCOL", "NETWORK_EXTENSIONS", "NFC_TAG_READING", "PERSONAL_VPN",
  "PUSH_NOTIFICATIONS", "SIRIKIT", "SYSTEM_EXTENSION_INSTALL", "USER_MANAGEMENT", "WALLET", "WEATHERKIT",
  "WIRELESS_ACCESSORY_CONFIGURATION",
] as const;

/**
 * Turn on the capabilities that are not on yet. Each POST is separate, so one
 * Apple refusal (a capability that needs settings this tool does not send) is
 * reported by name and never hides the ones that did go through.
 */
async function enableCapabilities(client: ASCClient, bundleResId: string, wanted: string[], identifier: string): Promise<string> {
  // Apple refuses `limit` on this relationship (400, found on a real account), and returns every capability at once.
  const res = await client.get<{ capabilityType: string }>(`/v1/bundleIds/${bundleResId}/bundleIdCapabilities`, {
    "fields[bundleIdCapabilities]": "capabilityType",
  });
  const on = new Set((Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean).map((c) => c.attributes.capabilityType));
  const already = wanted.filter((c) => on.has(c));
  const done: string[] = [];
  const failed: string[] = [];
  for (const cap of wanted.filter((c) => !on.has(c))) {
    try {
      await client.post("/v1/bundleIdCapabilities", {
        data: {
          type: "bundleIdCapabilities",
          attributes: { capabilityType: cap },
          relationships: { bundleId: { data: { type: "bundleIds", id: bundleResId } } },
        },
      });
      done.push(cap);
    } catch (err) {
      failed.push(`${cap} (${err instanceof ASCAPIError ? err.message : String(err)})`);
    }
  }
  let out = "";
  if (done.length) out += `Turned on for ${identifier}: ${done.join(", ")}.`;
  if (already.length) out += `${out ? " " : ""}Already on: ${already.join(", ")}.`;
  if (failed.length) out += `${out ? " " : ""}Apple refused: ${failed.join("; ")}. Those need settings this tool does not send; the human turns them on in the Developer portal (Certificates, Identifiers & Profiles > Identifiers > ${identifier}).`;
  if (done.includes("APP_GROUPS")) out += " App Groups is on, but the group itself is created in the Developer portal and assigned there; Apple's API cannot create it.";
  if (done.length) out += "\nAny existing App Store profile for this id is now invalid. The AI calls setup_app_store_signing with confirm: true to replace it, then also turns the capability on in Xcode (Signing & Capabilities) so the entitlement is in the build.";
  return out;
}

// Apple: an explicit App ID is reverse-DNS, letters digits hyphen and dot.
const IDENTIFIER_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// Apple rejects punctuation in the portal name.
const NAME_RE = /^[A-Za-z0-9 ]+$/;

/** Find an explicit bundle id by exact identifier (Apple's filter also matches prefixes). */
export async function findBundleId(
  client: ASCClient,
  identifier: string,
): Promise<{ id: string; attributes: BundleIdAttrs } | undefined> {
  const res = await client.getAll<BundleIdAttrs>("/v1/bundleIds", {
    "filter[identifier]": identifier,
    "fields[bundleIds]": "identifier,name,platform",
    limit: "200",
  });
  const rows = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
  return rows.find((r) => r.attributes.identifier === identifier);
}

/**
 * Register an explicit bundle id (App ID) in the Developer portal through
 * POST /v1/bundleIds, so a new app has an identifier before its app record
 * and its App Store provisioning profile. Idempotent: an id that exists is
 * returned, never an error. In-App Purchase is on by default for an explicit
 * id, so no capability call is made.
 */
export async function registerBundleId(
  client: ASCClient,
  args: RegisterBundleIdArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Registering a bundle id", "register_bundle_id");
  if (gate) return gate;

  const identifier = args.identifier.trim();
  const name = args.name.trim();
  const platform = args.platform ?? "IOS";
  if (!IDENTIFIER_RE.test(identifier)) {
    return `"${identifier}" is not an explicit bundle id (reverse-DNS such as app.example.ios; no wildcard). Nothing was registered. The AI calls register_bundle_id again with a valid identifier.`;
  }
  if (!NAME_RE.test(name)) {
    return `Name "${name}" has characters Apple rejects (letters, digits and spaces only). Nothing was registered. The AI calls register_bundle_id again with a plain name.`;
  }

  const caps = [...new Set((args.capabilities ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const unknown = caps.filter((c) => !(CAPABILITY_TYPES as readonly string[]).includes(c));
  if (unknown.length) {
    return `Unknown capability type: ${unknown.join(", ")}. Nothing was changed. Apple's names are: ${CAPABILITY_TYPES.join(", ")}. The AI calls register_bundle_id again with names from that list.`;
  }

  const existing = await findBundleId(client, identifier);
  if (existing && caps.length) {
    if (!args.confirm) {
      return `Bundle id ${identifier} is registered. Confirming turns on ${caps.join(", ")} for it (any already on are left alone). Turning a capability on invalidates the id's App Store profile, which setup_app_store_signing then replaces. Nothing was changed. The AI calls register_bundle_id again with the same arguments and confirm: true.`;
    }
    return (await enableCapabilities(client, existing.id, caps, identifier)) || `Nothing to change for ${identifier}.`;
  }
  if (existing) {
    return (
      `Bundle id ${identifier} is already registered (resource id ${existing.id}, name "${existing.attributes.name}", platform ${existing.attributes.platform}). Nothing was changed.\n` +
      `Next: the human creates the app record in App Store Connect (Apps > + > pick this bundle id; the API cannot), then the AI calls list_apps and setup_app_store_signing.`
    );
  }

  if (!args.confirm) {
    return (
      `Bundle id ${identifier} is not on this Apple Developer account. Whether another Apple developer account already owns it is only known when Apple creates it, because bundle ids are unique across all accounts. ` +
      `Confirming registers ${identifier} ("${name}", ${platform}) on your account${caps.length ? ` and turns on ${caps.join(", ")}` : ""}. ` +
      `An identifier can be deleted in the Developer portal until a build is uploaded under it, but never reused after that. Nothing was changed. ` +
      `The AI calls register_bundle_id again with the same arguments and confirm: true.`
    );
  }

  let res;
  try {
    res = await client.post<BundleIdAttrs>("/v1/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier, name, platform } },
    });
  } catch (err) {
    if (err instanceof ASCAPIError && err.status === 409 && /not available/i.test(err.body)) {
      return identifierTaken(client, identifier);
    }
    throw err;
  }
  const created = res && !Array.isArray(res.data) ? res.data : undefined;
  const capLine = caps.length && created ? (await enableCapabilities(client, created.id, caps, identifier)) + "\n" : "";
  return (
    `Registered bundle id ${identifier} ("${name}", ${platform})${created ? `, resource id ${created.id}` : ""}. In-App Purchase is on by default.\n` +
    capLine +
    `Next: the human creates the app record in App Store Connect (Apps > + > pick this bundle id; the API cannot). Then the AI calls list_apps for the app_id and setup_app_store_signing.`
  );
}

/** Longest shared reverse-DNS prefix (whole labels) of the ids, or "" when they share none. */
function commonPrefix(ids: string[]): string {
  if (ids.length === 0) return "";
  const parts = ids.map((i) => i.split("."));
  const first = parts[0];
  let n = 0;
  while (n < first.length - 1 && parts.every((p) => p.length > n + 1 && p[n] === first[n])) n++;
  return first.slice(0, n).join(".");
}

/** Reply for Apple's 409 "identifier is not available": another account owns it. Nothing was registered. */
async function identifierTaken(client: ASCClient, identifier: string): Promise<string> {
  let pattern = "";
  try {
    const res = await client.getAll<BundleIdAttrs>("/v1/bundleIds", { "fields[bundleIds]": "identifier", limit: "200" });
    const rows = (Array.isArray(res.data) ? res.data : [res.data]).filter(Boolean);
    const prefix = commonPrefix(rows.map((r) => r.attributes.identifier).filter((i) => !i.includes("*")));
    if (prefix) pattern = ` Your account's existing apps share the prefix ${prefix}, so ${prefix}.<appname> is a likely free choice.`;
  } catch {
    // The suggestion is a convenience; the refusal stands without it.
  }
  return (
    `Another Apple developer account already owns the identifier ${identifier} (bundle ids are unique across all accounts, so it can be free here and still taken). Nothing was registered.` +
    `${pattern} Pick a different reverse-DNS id under a domain or prefix you own. The app's Xcode project bundle id, the StoreKit configuration and any in-app purchase product ids built from it must follow the new id.\n` +
    `Next: the AI asks the human to choose the new bundle id, then calls register_bundle_id again with it (and confirm: true once they agree).`
  );
}
