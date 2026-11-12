import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connectAccount, credentialsPath, loadSavedCredentials, type LiveCheck } from "../src/connect.js";

/**
 * asc_connect moves a real file in the user's home and writes a config next to
 * it, so every case runs in the per-file temp HOME from setup-home.ts and the
 * Apple round trip is injected. What is checked is the user's disk afterwards.
 */
const ISSUER = "69a6de70-03db-47e3-e053-5b8c7c11a4d1";
const home = homedir();
const std = join(home, ".appstoreconnect", "private_keys");
const downloads = join(home, "Downloads");
const desktop = join(home, "Desktop");
const SAVED = { ...process.env };

const accept = async (): Promise<LiveCheck> => ({ ok: true, status: 200, apps: 3 });
const refuse = (status: number) => async (): Promise<LiveCheck> => ({ ok: false, status });

function key(dir: string, id = "ABCDE12345"): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `AuthKey_${id}.p8`);
  writeFileSync(p, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n");
  return p;
}

beforeEach(() => {
  for (const d of [join(home, ".appstoreconnect"), downloads, desktop, join(home, ".asc-mcp"), join(home, "elsewhere")]) {
    rmSync(d, { recursive: true, force: true });
  }
  delete process.env.ASC_ISSUER_ID;
  delete process.env.ASC_PRIVATE_KEY_PATH;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("asc_connect", () => {
  it("moves a downloaded key into Apple's folder, saves only the Issuer ID, and sets the env", async () => {
    const src = key(downloads);
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dest = join(std, "AuthKey_ABCDE12345.p8");
    expect(existsSync(src)).toBe(false);
    expect(existsSync(dest)).toBe(true);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    expect(r.config).toEqual({ keyId: "ABCDE12345", issuerId: ISSUER, privateKeyPath: dest });
    expect(r.apps).toBe(3);
    expect(r.notes.join(" ")).toContain(`moved from ${src}`);
    const saved = JSON.parse(readFileSync(credentialsPath(), "utf-8"));
    expect(saved).toEqual({ issuerId: ISSUER });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    expect(process.env.ASC_ISSUER_ID).toBe(ISSUER);
  });

  it("uses a key already in Apple's folder without moving anything", async () => {
    const p = key(std);
    const r = await connectAccount({ issuer_id: ` ${ISSUER} ` }, accept);
    expect(r.ok && r.config.privateKeyPath).toBe(p);
    expect(r.ok && r.notes).toEqual([]);
  });

  it("finds a key on the Desktop", async () => {
    key(desktop, "DESK000001");
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok && r.config.keyId).toBe("DESK000001");
  });

  it("refuses something that is not an Issuer ID before touching any file", async () => {
    const src = key(downloads);
    for (const bad of ["", "ABCDE12345", "6X9BD5ACW4", "not-a-uuid"]) {
      const r = await connectAccount({ issuer_id: bad }, accept);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toContain("not an Issuer ID");
    }
    expect(existsSync(src)).toBe(true);
    expect(existsSync(credentialsPath())).toBe(false);
  });

  it("asks which key when there are several downloads, and moves none", async () => {
    const a = key(downloads, "AAAAA11111");
    const b = key(desktop, "BBBBB22222");
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("key_path");
    expect(existsSync(a) && existsSync(b)).toBe(true);
  });

  it("takes key_path to pick one, with ~ expanded", async () => {
    key(downloads, "AAAAA11111");
    key(desktop, "BBBBB22222");
    const r = await connectAccount({ issuer_id: ISSUER, key_path: "~/Desktop/AuthKey_BBBBB22222.p8" }, accept);
    expect(r.ok && r.config.keyId).toBe("BBBBB22222");
    expect(existsSync(join(downloads, "AuthKey_AAAAA11111.p8"))).toBe(true);
  });

  it("says where to create a key when none exists", async () => {
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("appstoreconnect.apple.com/access/integrations/api");
  });

  it("leaves a key_path outside Downloads and Desktop where it is, and saves that path", async () => {
    const p = key(join(home, "elsewhere"), "KEEP000001");
    const r = await connectAccount({ issuer_id: ISSUER, key_path: p }, accept);
    expect(r.ok && r.config.privateKeyPath).toBe(p);
    expect(existsSync(p)).toBe(true);
    expect(existsSync(join(std, "AuthKey_KEEP000001.p8"))).toBe(false);
    expect(JSON.parse(readFileSync(credentialsPath(), "utf-8"))).toEqual({ issuerId: ISSUER, privateKeyPath: p });
  });

  it("refuses a key_path that does not carry Apple's name, since the Key ID is in it", async () => {
    mkdirSync(join(home, "elsewhere"), { recursive: true });
    const p = join(home, "elsewhere", "mykey.p8");
    writeFileSync(p, "x");
    const r = await connectAccount({ issuer_id: ISSUER, key_path: p }, accept);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("AuthKey_XXXXXXXXXX.p8");
  });

  it("on a 401 or 403 leaves the download where it was and saves nothing", async () => {
    const src = key(downloads);
    for (const [status, words] of [[401, "refused this Issuer ID"], [403, "App Manager"], [0, "Could not reach"]] as const) {
      const r = await connectAccount({ issuer_id: ISSUER }, refuse(status));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toContain(words);
      expect(!r.ok && r.message).toContain("Nothing was saved");
    }
    expect(existsSync(src)).toBe(true);
    expect(existsSync(credentialsPath())).toBe(false);
    expect(process.env.ASC_ISSUER_ID).toBeUndefined();
  });

  it("never overwrites a key of the same name already filed", async () => {
    const filed = key(std);
    writeFileSync(filed, "the original");
    const src = key(downloads);
    const r = await connectAccount({ issuer_id: ISSUER, key_path: src }, accept);
    expect(r.ok && r.config.privateKeyPath).toBe(filed);
    expect(readFileSync(filed, "utf-8")).toBe("the original");
    expect(existsSync(src)).toBe(true);
  });

  it("records the path of a key it could not file in Apple's folder", async () => {
    // A file where the folder should be makes mkdir fail.
    mkdirSync(join(home, ".appstoreconnect"), { recursive: true });
    writeFileSync(std, "not a folder");
    const src = key(downloads);
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok && r.config.privateKeyPath).toBe(src);
    expect(JSON.parse(readFileSync(credentialsPath(), "utf-8"))).toEqual({ issuerId: ISSUER, privateKeyPath: src });
    expect(process.env.ASC_PRIVATE_KEY_PATH).toBe(src);
  });
});

describe("a key the client already names", () => {
  it("is used where it is, not moved, and its path is not saved", async () => {
    const p = key(join(home, "elsewhere"));
    key(downloads, "OTHER00001");
    process.env.ASC_PRIVATE_KEY_PATH = p;
    const r = await connectAccount({ issuer_id: ISSUER }, accept);
    expect(r.ok && r.config.privateKeyPath).toBe(p);
    expect(existsSync(p)).toBe(true);
    expect(existsSync(join(downloads, "AuthKey_OTHER00001.p8"))).toBe(true);
    expect(JSON.parse(readFileSync(credentialsPath(), "utf-8"))).toEqual({ issuerId: ISSUER });
    expect(process.env.ASC_PRIVATE_KEY_PATH).toBe(p);
  });
});

describe("loading saved credentials at startup", () => {
  function save(obj: unknown) {
    mkdirSync(join(home, ".asc-mcp"), { recursive: true });
    writeFileSync(credentialsPath(), JSON.stringify(obj));
  }

  it("fills an unset Issuer ID", () => {
    save({ issuerId: ISSUER });
    expect(loadSavedCredentials()).toBe(true);
    expect(process.env.ASC_ISSUER_ID).toBe(ISSUER);
  });

  it("never overrides the client's own config", () => {
    save({ issuerId: ISSUER });
    process.env.ASC_ISSUER_ID = "11111111-2222-3333-4444-555555555555";
    expect(loadSavedCredentials()).toBe(false);
    expect(process.env.ASC_ISSUER_ID).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("ignores a saved key path that no longer exists, and a corrupt file", () => {
    save({ issuerId: ISSUER, privateKeyPath: "/nowhere/AuthKey_ABCDE12345.p8" });
    loadSavedCredentials();
    expect(process.env.ASC_PRIVATE_KEY_PATH).toBeUndefined();
    writeFileSync(credentialsPath(), "{nope");
    delete process.env.ASC_ISSUER_ID;
    expect(loadSavedCredentials()).toBe(false);
    expect(process.env.ASC_ISSUER_ID).toBeUndefined();
  });

  it("ignores a saved value that is not an Issuer ID", () => {
    save({ issuerId: "rm -rf /" });
    expect(loadSavedCredentials()).toBe(false);
  });
});
