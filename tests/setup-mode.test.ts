import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");

/**
 * A client with no credentials configured used to see "server disconnected":
 * the process exited before the MCP handshake, so the two tools that exist to
 * fix exactly that problem were unreachable. It must connect instead.
 */
async function handshake(env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env, HOME: join(ROOT, "tests", "no-such-home") },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  child.stdin.write(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  child.stdin.end();

  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  const code: number | null = await new Promise((resolve) => {
    child.on("close", resolve);
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 20_000);
  });

  const messages = out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { code, err, messages };
}

describe("setup mode (no credentials)", () => {
  it.skipIf(!existsSync(ENTRY))(
    "completes the MCP handshake and offers the two tools that fix setup",
    async () => {
      const { err, messages } = await handshake({
        ASC_KEY_ID: undefined,
        ASC_ISSUER_ID: undefined,
        ASC_PRIVATE_KEY_PATH: undefined,
      });

      const list = messages.find((m) => m.id === 2);
      expect(list, `no tools/list response. stderr: ${err}`).toBeDefined();
      const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
      expect(names).toEqual(["asc_guide", "asc_setup_check"]);

      // The reason has to reach the user, who only ever sees the client's log.
      expect(err).toContain("setup mode");
      expect(err).toContain("asc-mcp init");
    },
    30_000,
  );

  /**
   * SERVER_VERSION used to be a hand-maintained literal, so 1.8.6 shipped
   * announcing itself as 1.8.5 in every handshake and every stderr banner.
   */
  it.skipIf(!existsSync(ENTRY))(
    "announces the published package version",
    async () => {
      const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
        version: string;
      };
      const { err, messages } = await handshake({});

      const init = messages.find((m) => m.id === 1);
      expect(init?.result?.serverInfo?.version).toBe(pkg.version);
      expect(err).toContain(`asc-mcp ${pkg.version}`);
    },
    30_000,
  );
});
