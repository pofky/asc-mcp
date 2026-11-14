import type { ASCClient } from "../client.js";
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
  confirm?: boolean;
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

  const existing = await findBundleId(client, identifier);
  if (existing) {
    return (
      `Bundle id ${identifier} is already registered (resource id ${existing.id}, name "${existing.attributes.name}", platform ${existing.attributes.platform}). Nothing was changed.\n` +
      `Next: the human creates the app record in App Store Connect (Apps > + > pick this bundle id; the API cannot), then the AI calls list_apps and setup_app_store_signing.`
    );
  }

  if (!args.confirm) {
    return (
      `This registers bundle id ${identifier} ("${name}", ${platform}) on your Apple Developer account. ` +
      `An identifier can be deleted in the Developer portal until a build is uploaded under it, but never reused after that. Nothing was changed. ` +
      `The AI calls register_bundle_id again with the same arguments and confirm: true.`
    );
  }

  const res = await client.post<BundleIdAttrs>("/v1/bundleIds", {
    data: { type: "bundleIds", attributes: { identifier, name, platform } },
  });
  const created = res && !Array.isArray(res.data) ? res.data : undefined;
  return (
    `Registered bundle id ${identifier} ("${name}", ${platform})${created ? `, resource id ${created.id}` : ""}. In-App Purchase is on by default.\n` +
    `Next: the human creates the app record in App Store Connect (Apps > + > pick this bundle id; the API cannot). Then the AI calls list_apps for the app_id and setup_app_store_signing.`
  );
}
