import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseInitArgs } from "../src/setup.js";

/**
 * The documented install path is a coding agent running
 * `npx @pofky/asc-mcp init --write`, and an agent has no terminal. Until
 * 2026-08-31 that case printed one line of advice and wrote nothing, even when
 * the .p8 had been found and ASC_ISSUER_ID was already set, so the user ended
 * up with no server block and a failure that looked like the package.
 *
 * These drive the built CLI with stdin piped, which is the only way to
 * reproduce a non-TTY run honestly.
 */
describe("init in a non-interactive shell", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), "asc-init-"));
    dirs.push(d);
    return d;
  }

  /** Run the compiled CLI with stdin piped, so process.stdin.isTTY is false. */
  function runInit(home: string, env: Record<string, string>, args: string[] = []) {
    try {
      return execFileSync(process.execPath, [join(process.cwd(), "dist/index.js"), "init", ...args], {
        cwd: home,
        env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
        input: "",
        encoding: "utf-8",
      });
    } catch (err) {
      // A run that cannot finish exits non-zero on purpose. Its output is
      // exactly what this suite is asserting about, so keep it.
      return String((err as { stdout?: string }).stdout ?? "");
    }
  }

  const KEY_ENV = {
    ASC_KEY_ID: "ABCDE12345",
    ASC_PRIVATE_KEY_PATH: "/keys/AuthKey_ABCDE12345.p8",
  };

  it("prints a complete, paste-ready block when everything is known", () => {
    const out = runInit(scratch(), { ...KEY_ENV, ASC_ISSUER_ID: "issuer-uuid" });
    const block = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    expect(block.mcpServers["appstore-connect"].env).toEqual({
      ASC_KEY_ID: "ABCDE12345",
      ASC_ISSUER_ID: "issuer-uuid",
      ASC_PRIVATE_KEY_PATH: "/keys/AuthKey_ABCDE12345.p8",
    });
  });

  it("writes the block into the one config that exists", () => {
    const home = scratch();
    const path = join(home, ".claude.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

    runInit(home, { ...KEY_ENV, ASC_ISSUER_ID: "issuer-uuid" }, ["--write"]);

    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    expect(cfg.mcpServers["appstore-connect"].env.ASC_ISSUER_ID).toBe("issuer-uuid");
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  it("writes where --config points, even with no config there yet", () => {
    const home = scratch();
    const path = join(home, "picked.json");

    runInit(home, { ...KEY_ENV, ASC_ISSUER_ID: "issuer-uuid" }, ["--write", "--config", path]);

    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    expect(cfg.mcpServers["appstore-connect"].env.ASC_ISSUER_ID).toBe("issuer-uuid");
  });

  it("takes the Issuer ID from a flag, so nothing has to be in the environment", () => {
    const out = runInit(scratch(), KEY_ENV, ["--issuer", "flag-uuid"]);
    expect(out).toContain('"ASC_ISSUER_ID": "flag-uuid"');
  });

  it("names what is missing instead of inventing it", () => {
    const out = runInit(scratch(), {});
    expect(out).toContain("Still needed");
    expect(out).toContain("--issuer");
    // Nothing paste-ready, because a config with a guessed Issuer ID is worse
    // than no config at all: it fails at Apple's auth with a confusing error.
    expect(out).not.toContain("mcpServers");
  });

  it("refuses to choose when several client configs exist", () => {
    const home = scratch();
    writeFileSync(join(home, ".claude.json"), "{}");
    writeFileSync(join(home, ".mcp.json"), "{}");

    const out = runInit(home, { ...KEY_ENV, ASC_ISSUER_ID: "issuer-uuid" }, ["--write"]);

    expect(out).toContain("More than one client config exists");
    expect(JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8"))).toEqual({});
  });
});

describe("parseInitArgs", () => {
  it("reads every value the interactive flow would ask for", () => {
    expect(
      parseInitArgs([
        "node", "asc-mcp", "init", "--write",
        "--issuer", "u", "--key-id", "K", "--key-path", "/p.p8",
        "--license", "ASC-1", "--config", "/c.json",
      ]),
    ).toEqual({
      write: true, issuerId: "u", keyId: "K", keyPath: "/p.p8",
      licenseKey: "ASC-1", configPath: "/c.json",
    });
  });

  it("does not swallow the next flag as a value", () => {
    const opts = parseInitArgs(["node", "asc-mcp", "init", "--issuer", "--write"]);
    expect(opts.issuerId).toBeUndefined();
    expect(opts.write).toBe(true);
  });
});
