import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";
import { findBundleId } from "./bundle-id.js";

interface ProfileAttrs {
  name: string;
  uuid: string;
  profileContent: string;
  profileType: string;
}

/**
 * The downloaded profile is a CMS (PKCS7) blob that embeds an XML plist in
 * plaintext. Pull the fields we need without shelling out to `security`.
 */
function parseProfile(contentB64: string): { teamId?: string; name?: string; bundleId?: string } {
  const buf = Buffer.from(contentB64, "base64").toString("latin1");
  const start = buf.indexOf("<plist");
  const end = buf.indexOf("</plist>");
  if (start < 0 || end < 0) return {};
  const xml = buf.slice(start, end + 8);
  const teamId = xml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)?.[1];
  const name = xml.match(/<key>Name<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const appId = xml.match(/<key>application-identifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  // application-identifier is "TEAMID.com.bundle.id"; strip the team prefix.
  const bundleId = appId && teamId && appId.startsWith(teamId + ".") ? appId.slice(teamId.length + 1) : appId;
  return { teamId, name, bundleId };
}

export interface SetupSigningArgs {
  app_id: string;
  /** Where to write the generated ExportOptions.plist. Defaults to ./ExportOptions.plist. */
  output_plist?: string;
  /** Needed only when no App Store profile exists yet and one has to be created on the account. */
  confirm?: boolean;
}

interface CertAttrs {
  certificateType: string;
  displayName?: string;
  expirationDate?: string;
}

/** Cert types Apple uses for App Store distribution (the older IOS_DISTRIBUTION name is still returned for some). */
const DISTRIBUTION_CERT_TYPES = "DISTRIBUTION,IOS_DISTRIBUTION";

/**
 * Create the IOS_APP_STORE profile for a bundle id that has none, through
 * POST /v1/profiles, including every unexpired distribution certificate on the
 * account so whichever one is in the keychain can sign. Returns a message when
 * it stops, or null when the profile now exists.
 */
async function createAppStoreProfile(
  client: ASCClient,
  appBundle: string,
  confirm: boolean | undefined,
  now: Date,
): Promise<string | null> {
  const bundle = await findBundleId(client, appBundle);
  if (!bundle) {
    return `No IOS_APP_STORE profile for ${appBundle}, and the bundle id is not registered in the Developer account. The AI calls register_bundle_id for it, then setup_app_store_signing again.`;
  }
  const certRes = await client.getAll<CertAttrs>("/v1/certificates", {
    "filter[certificateType]": DISTRIBUTION_CERT_TYPES,
    "fields[certificates]": "certificateType,displayName,expirationDate",
    limit: "200",
  });
  const certs = (Array.isArray(certRes.data) ? certRes.data : [certRes.data])
    .filter(Boolean)
    .filter((c) => !c.attributes.expirationDate || new Date(c.attributes.expirationDate) > now);
  if (certs.length === 0) {
    return (
      `No IOS_APP_STORE profile for ${appBundle} and no unexpired distribution certificate on the account to put in one. ` +
      "The human creates an Apple Distribution certificate (Xcode > Settings > Accounts > Manage Certificates), then the AI calls setup_app_store_signing again."
    );
  }
  const name = `${appBundle} App Store`;
  if (!confirm) {
    return (
      `No IOS_APP_STORE profile exists for ${appBundle}. This creates one named "${name}" on your Apple Developer account, ` +
      `containing ${certs.length} distribution certificate(s) (${certs.map((c) => c.attributes.displayName ?? c.id).join(", ")}). Nothing was changed. ` +
      "The AI calls setup_app_store_signing again with the same arguments and confirm: true."
    );
  }
  await client.post("/v1/profiles", {
    data: {
      type: "profiles",
      attributes: { name, profileType: "IOS_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundle.id } },
        certificates: { data: certs.map((c) => ({ type: "certificates", id: c.id })) },
      },
    },
  });
  return null;
}

/**
 * Prepare an App Store binary export WITHOUT needing the cloud-signing
 * permission that many API keys lack. It downloads the app's existing
 * IOS_APP_STORE provisioning profiles (main app + extensions) from App Store
 * Connect, installs them where Xcode looks, and writes a manual-signing
 * ExportOptions.plist that build_and_archive can use directly.
 *
 * Prerequisite: an "Apple Distribution" certificate must already be in the
 * login keychain (created once in Xcode > Settings > Accounts > Manage
 * Certificates, or the Developer portal). Certificate creation is not exposed
 * to API keys.
 */
export async function setupAppStoreSigning(
  client: ASCClient,
  args: SetupSigningArgs,
  tier: Tier,
): Promise<string> {
  const gate = requirePro(tier, "Preparing App Store signing", "setup_app_store_signing");
  if (gate) return gate;

  // The app's bundle id is the prefix every profile we want must match.
  const appRes = await client.get<{ bundleId: string }>(`/v1/apps/${args.app_id}`, {
    "fields[apps]": "bundleId",
  });
  const app = Array.isArray(appRes.data) ? appRes.data[0] : appRes.data;
  const appBundle = (app as { attributes?: { bundleId?: string } })?.attributes?.bundleId;
  if (!appBundle) {
    return "Could not resolve the app's bundle id, so no profiles were installed. The AI checks app_id with list_apps and calls setup_app_store_signing again.";
  }

  const profRes = await client.getAll<ProfileAttrs>("/v1/profiles", {
    "fields[profiles]": "name,uuid,profileContent,profileType",
    limit: "200",
  });
  const profiles = (Array.isArray(profRes.data) ? profRes.data : [profRes.data]).filter(Boolean);

  const dir = join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");
  mkdirSync(dir, { recursive: true });

  const installed: Array<{ bundleId: string; name: string }> = [];
  let teamId: string | undefined;
  for (const p of profiles) {
    if (p.attributes.profileType !== "IOS_APP_STORE") continue;
    const meta = parseProfile(p.attributes.profileContent);
    if (!meta.bundleId) continue;
    // Keep the main app bundle and any extension under it (e.g. .GlasynWidget).
    if (meta.bundleId !== appBundle && !meta.bundleId.startsWith(appBundle + ".")) continue;
    teamId = teamId ?? meta.teamId;
    writeFileSync(join(dir, `${p.attributes.uuid}.mobileprovision`), Buffer.from(p.attributes.profileContent, "base64"));
    installed.push({ bundleId: meta.bundleId, name: p.attributes.name });
  }

  if (installed.length === 0) {
    const stop = await createAppStoreProfile(client, appBundle, args.confirm, new Date());
    if (stop) return stop;
    // Profile created: run again so it is downloaded, installed and mapped like any other.
    return setupAppStoreSigning(client, { ...args, confirm: false }, tier);
  }
  if (!teamId) {
    return (
      `Installed ${installed.length} profile(s) but could not read the team id from them, so no ExportOptions.plist was written. ` +
      "The human regenerates the App Store profile in the Apple Developer portal (Certificates, Identifiers & Profiles > Profiles), then the AI calls setup_app_store_signing again."
    );
  }

  const mappings = installed
    .map((m) => `    <key>${m.bundleId}</key><string>${m.name}</string>`)
    .join("\n");
  const plist =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n<dict>\n` +
    `  <key>method</key><string>app-store-connect</string>\n` +
    `  <key>teamID</key><string>${teamId}</string>\n` +
    `  <key>signingStyle</key><string>manual</string>\n` +
    `  <key>signingCertificate</key><string>Apple Distribution</string>\n` +
    `  <key>provisioningProfiles</key>\n  <dict>\n${mappings}\n  </dict>\n` +
    `  <key>manageAppVersionAndBuildNumber</key><false/>\n` +
    `  <key>uploadSymbols</key><true/>\n` +
    `</dict>\n</plist>\n`;

  const outPath = args.output_plist || join(process.cwd(), "ExportOptions.plist");
  writeFileSync(outPath, plist);

  return (
    `App Store signing ready (team ${teamId}).\n` +
    `Installed ${installed.length} profile(s): ${installed.map((m) => `${m.bundleId} -> "${m.name}"`).join(", ")}.\n` +
    `Wrote ExportOptions.plist: ${outPath}\n\n` +
    `Next: build_and_archive with export_options_plist set to this path, then upload_binary.`
  );
}
