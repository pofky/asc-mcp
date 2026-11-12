/**
 * Finishing setup inside the conversation (tasks/0004).
 *
 * A new install starts in setup mode, and the way out used to be: move the
 * downloaded .p8 with a terminal command, find a JSON config file the user had
 * never seen, add an Issuer ID to it, and restart the client. Installs went up
 * while trial starts went to zero (Nov 2026), which is the shape of a wall at
 * that step. `asc_connect` takes the one value nothing can discover, the Issuer
 * ID, does the rest on this machine, and the server unlocks in the running
 * session.
 *
 * What it saves is `~/.asc-mcp/credentials.json`: the Issuer ID, and the key's
 * path only when the key is not in Apple's standard folder. No secret is in it.
 * Environment variables always win over it, so an install configured the old
 * way behaves exactly as before.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { clearTokenCache, getToken } from "./auth.js";
import { discoverPrivateKey, keyIdFromPath } from "./setup.js";

/** Where Apple's page shows the Issuer ID and lets you create a key. */
export const INTEGRATIONS_URL = "https://appstoreconnect.apple.com/access/integrations/api";

const ISSUER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_FILE_RE = /^AuthKey_[A-Z0-9]{10}\.p8$/i;

// Each path is computed from homedir() at call time, not at import, so a test
// (or anything else) that points HOME somewhere else is honoured.
function standardKeyDir(): string {
  return join(homedir(), ".appstoreconnect", "private_keys");
}

export function credentialsPath(): string {
  return join(homedir(), ".asc-mcp", "credentials.json");
}

/** Folders a browser download of the key usually lands in. */
function downloadDirs(): string[] {
  return [join(homedir(), "Downloads"), join(homedir(), "Desktop")];
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(2)) : resolve(p);
}

/** A key file the client's own settings point at, if it exists and carries Apple's name. */
function envKeyPath(): string | undefined {
  const p = process.env.ASC_PRIVATE_KEY_PATH?.trim();
  return p && existsSync(expandHome(p)) && keyIdFromPath(p) ? expandHome(p) : undefined;
}

export function isIssuerId(value: string): boolean {
  return ISSUER_RE.test(value.trim());
}

interface SavedCredentials {
  issuerId?: string;
  privateKeyPath?: string;
}

function readSaved(): SavedCredentials | null {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), "utf-8")) as SavedCredentials;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fill ASC_ISSUER_ID and ASC_PRIVATE_KEY_PATH from credentials.json where the
 * environment leaves them unset or empty. A plugin or bundle with a blank field
 * passes an empty string, which counts as unset. Returns true if anything was
 * taken from the file.
 */
export function loadSavedCredentials(): boolean {
  const saved = readSaved();
  if (!saved) return false;
  let used = false;
  if (!process.env.ASC_ISSUER_ID?.trim() && typeof saved.issuerId === "string" && isIssuerId(saved.issuerId)) {
    process.env.ASC_ISSUER_ID = saved.issuerId.trim();
    used = true;
  }
  if (
    !process.env.ASC_PRIVATE_KEY_PATH?.trim() &&
    typeof saved.privateKeyPath === "string" &&
    existsSync(saved.privateKeyPath)
  ) {
    process.env.ASC_PRIVATE_KEY_PATH = saved.privateKeyPath;
    used = true;
  }
  return used;
}

function saveCredentials(creds: SavedCredentials): boolean {
  try {
    const path = credentialsPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    return true;
  } catch {
    return false;
  }
}

/** AuthKey_*.p8 files in the usual download folders. */
export function findDownloadedKeys(dirs = downloadDirs()): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) if (KEY_FILE_RE.test(f)) found.push(join(dir, f));
  }
  return found;
}

/**
 * Put a key into Apple's standard folder, the step the README asks people to do
 * with `mkdir -p` and `mv`. Never overwrites: a file of the same name already
 * there is the same key (the name carries the Key ID), so that one is used and
 * the download is left where it is.
 */
function fileKey(src: string): { path: string; movedFrom?: string; note?: string } {
  const dir = standardKeyDir();
  const dest = join(dir, basename(src));
  if (resolve(src) === resolve(dest)) return { path: dest };
  if (existsSync(dest)) {
    return { path: dest, note: `${dest} already existed, so it was used and ${src} was left in place.` };
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      renameSync(src, dest);
    } catch {
      // Different volume: rename cannot cross it.
      copyFileSync(src, dest);
      unlinkSync(src);
    }
    chmodSync(dest, 0o600);
    return { path: dest, movedFrom: src };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { path: src, note: `It could not be moved into ${dir} (${msg}), so it is used from ${src}.` };
  }
}

export interface LiveCheck {
  ok: boolean;
  status: number;
  /** Apps in the account, when Apple reports a total. */
  apps?: number;
  error?: string;
}

/** One authenticated request to Apple, the same one `asc_setup_check` makes. */
export async function liveCheck(keyId: string, issuerId: string, keyPath: string): Promise<LiveCheck> {
  try {
    clearTokenCache();
    const token = await getToken(keyId, issuerId, keyPath);
    const res = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json().catch(() => null)) as { meta?: { paging?: { total?: number } } } | null;
    const total = body?.meta?.paging?.total;
    return { ok: true, status: res.status, apps: typeof total === "number" ? total : undefined };
  } catch (err) {
    clearTokenCache();
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ConnectInput {
  issuer_id: string;
  key_path?: string;
}

export type ConnectResult =
  | {
      ok: true;
      config: { keyId: string; issuerId: string; privateKeyPath: string };
      apps?: number;
      /** Lines describing what happened to the user's files. */
      notes: string[];
      saved: boolean;
    }
  | { ok: false; message: string };

/**
 * Find the key, file it, prove the pair works against Apple, then save. Nothing
 * is saved unless Apple accepted the pair.
 */
export async function connectAccount(
  input: ConnectInput,
  check: typeof liveCheck = liveCheck,
): Promise<ConnectResult> {
  const issuerId = (input.issuer_id ?? "").trim();
  if (!isIssuerId(issuerId)) {
    return {
      ok: false,
      message:
        `That is not an Issuer ID. It is a UUID like 69a6de70-03db-47e3-e053-5b8c7c11a4d1, shown above the keys list at ${INTEGRATIONS_URL} (Integrations > App Store Connect API). ` +
        "It is not the Key ID (10 characters) or the Team ID. Nothing was changed.",
    };
  }

  // 1. Which key.
  let source: string | undefined;
  let pinned = false;
  let keepInPlace = false;
  if (input.key_path?.trim()) {
    const p = expandHome(input.key_path.trim());
    if (!existsSync(p)) {
      return { ok: false, message: `No file at ${p}. Nothing was changed.` };
    }
    if (!keyIdFromPath(p)) {
      return {
        ok: false,
        message: `${basename(p)} is not named the way Apple names a key (AuthKey_XXXXXXXXXX.p8, where the 10 characters are the Key ID). Rename it back to that, then try again. Nothing was changed.`,
      };
    }
    source = p;
    // Only a fresh download gets filed. A key the user keeps somewhere on
    // purpose may be referenced by path from other tools (fastlane, CI
    // scripts), so it is used where it is and that path is saved.
    const inDownloads = downloadDirs().some((d) => resolve(dirname(p)) === resolve(d));
    if (!inDownloads) keepInPlace = true;
  } else if (envKeyPath()) {
    // The client already names the key (a plugin or bundle file field, or
    // ASC_PRIVATE_KEY_PATH by hand) and only the Issuer ID was missing. That
    // file is used where it is: the user chose that place.
    source = envKeyPath();
    pinned = true;
  } else {
    const standard = discoverPrivateKey(standardKeyDir());
    if (standard) {
      source = standard.path;
    } else {
      const downloads = findDownloadedKeys();
      if (downloads.length > 1) {
        return {
          ok: false,
          message:
            `Found ${downloads.length} API keys: ${downloads.join(", ")}. Which one goes with this Issuer ID? Call asc_connect again with key_path set to it. Nothing was changed.`,
        };
      }
      source = downloads[0];
    }
  }
  if (!source) {
    return {
      ok: false,
      message:
        `No API key (.p8) found in ~/.appstoreconnect/private_keys, ~/Downloads or ~/Desktop. ` +
        `Create one at ${INTEGRATIONS_URL}: Generate API Key, any name, Access "App Manager" (or Admin), then Download. ` +
        "Apple lets you download it only once. Then call asc_connect again, or pass key_path if you saved it somewhere else. Nothing was changed.",
    };
  }
  const keyId = keyIdFromPath(source)!;

  // 2. Prove the pair before touching anything, so a wrong Issuer ID leaves the
  // user's files exactly as they were.
  const live = await check(keyId, issuerId, source);
  if (!live.ok) {
    const why =
      live.status === 401
        ? `Apple refused this Issuer ID with key ${keyId} (401). The Issuer ID is the one shown on the same page as that key; check it was copied whole, and that the key was not revoked.`
        : live.status === 403
          ? `Apple accepted the key but it may not read apps (403). Give key ${keyId} the App Manager or Admin role at ${INTEGRATIONS_URL}, or create a new one with that role.`
          : live.status === 0
            ? `Could not reach App Store Connect or sign with ${basename(source)}: ${live.error}. If the file was opened and saved by an editor, download a fresh key.`
            : `App Store Connect answered ${live.status}. That is usually on Apple's side; try again in a minute.`;
    return { ok: false, message: `${why} Nothing was saved.` };
  }

  // 3. File the key and save.
  const filed = pinned || keepInPlace ? ({ path: source } as ReturnType<typeof fileKey>) : fileKey(source);
  const notes: string[] = [];
  if (filed.movedFrom) notes.push(`Your key was moved from ${filed.movedFrom} to ${filed.path}, Apple's standard place for it.`);
  if (filed.note) notes.push(filed.note);
  const inStandard = dirname(resolve(filed.path)) === resolve(standardKeyDir());
  const saved = saveCredentials(inStandard || pinned ? { issuerId } : { issuerId, privateKeyPath: filed.path });

  process.env.ASC_ISSUER_ID = issuerId;
  if (pinned) {
    // Left as the client set it.
  } else if (!inStandard) process.env.ASC_PRIVATE_KEY_PATH = filed.path;
  else if (process.env.ASC_PRIVATE_KEY_PATH !== undefined && !process.env.ASC_PRIVATE_KEY_PATH.trim()) {
    delete process.env.ASC_PRIVATE_KEY_PATH;
  }

  return {
    ok: true,
    config: { keyId, issuerId, privateKeyPath: filed.path },
    apps: live.apps,
    notes,
    saved,
  };
}
