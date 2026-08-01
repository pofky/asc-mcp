import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVER_LAUNCH, writeServerBlock } from "../src/setup.js";

/**
 * The documented install path is `npx @pofky/asc-mcp init`, which never puts an
 * `asc-mcp` binary on PATH. A generated config that says `"command": "asc-mcp"`
 * therefore fails to start for every customer who did not also `npm i -g`.
 */
describe("generated MCP server config", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function scratch(): string {
    const d = mkdtempSync(join(tmpdir(), "asc-setup-"));
    dirs.push(d);
    return d;
  }

  it("launches through npx so it works without a global install", () => {
    expect(SERVER_LAUNCH.command).toBe("npx");
    expect(SERVER_LAUNCH.args).toEqual(["-y", "@pofky/asc-mcp"]);
  });

  it("writes a launchable block into a fresh config", () => {
    const path = join(scratch(), "claude_desktop_config.json");
    writeServerBlock(path, { ASC_ISSUER_ID: "abc" });

    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    expect(cfg.mcpServers["appstore-connect"]).toEqual({
      command: "npx",
      args: ["-y", "@pofky/asc-mcp"],
      env: { ASC_ISSUER_ID: "abc" },
    });
  });

  it("keeps other servers and backs up the original", () => {
    const path = join(scratch(), ".claude.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "foo" } }, theme: "dark" }));

    writeServerBlock(path, { ASC_ISSUER_ID: "abc", ASC_LICENSE_KEY: "ASC-X" });

    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    expect(cfg.mcpServers.other).toEqual({ command: "foo" });
    expect(cfg.theme).toBe("dark");
    expect(cfg.mcpServers["appstore-connect"].env.ASC_LICENSE_KEY).toBe("ASC-X");
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  it("leaves an unparseable config untouched", () => {
    const path = join(scratch(), "broken.json");
    writeFileSync(path, "{not json");

    const status = writeServerBlock(path, { ASC_ISSUER_ID: "abc" });

    expect(status).toContain("Could not parse");
    expect(readFileSync(path, "utf-8")).toBe("{not json");
  });
});
