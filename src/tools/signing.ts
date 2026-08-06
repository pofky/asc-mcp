import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ASCClient } from "../client.js";
import type { Tier } from "../types.js";
import { requirePro } from "../gate.js";

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
  if (!appBundle) return "Could not resolve the app's bundle id.";

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
    return (
      `No IOS_APP_STORE provisioning profiles found for ${appBundle}.\n` +
      "Create one in the Developer portal (Certificates, Identifiers & Profiles > Profiles > +, " +
      "App Store distribution) or let Xcode generate it once via Product > Archive > Distribute App. " +
      "Profile creation is not available to API keys."
    );
  }
  if (!teamId) return "Installed profiles but could not read the team id from them.";

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
