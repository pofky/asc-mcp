import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A subscriber whose first license check got no answer, driven through the built
 * server. Once the server is back they are Pro in the same session: not counted
 * down free calls, and not offered a trial.
 */
const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
let up = false;
let server: Server;
let child: ChildProcess;
afterEach(() => {
  child?.kill();
  server?.close();
});

describe("a license server that comes back", () => {
  it("makes the subscriber Pro on the next call", async () => {
    server = createServer((_req, res) => {
      res.statusCode = up ? 200 : 503;
      res.setHeader("content-type", "application/json");
      res.end(up ? JSON.stringify({ valid: true, tier: "pro" }) : "{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const home = mkdtempSync(join(tmpdir(), "asc-outage-"));
    const key = join(home, "AuthKey_ABCDE12345.p8");
    writeFileSync(key, "not used before the gate");
    child = spawn("node", [ENTRY], {
      cwd: tmpdir(),
      env: {
        PATH: process.env.PATH,
        HOME: home,
        ASC_KEY_ID: "ABCDE12345",
        ASC_ISSUER_ID: "i",
        ASC_PRIVATE_KEY_PATH: key,
        ASC_LICENSE_KEY: "ASC-SUBSCRIBER",
        ASC_LICENSE_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buf = "";
    const waiting = new Map<number, (m: { result: { content: Array<{ text: string }> } }) => void>();
    child.stdout!.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        waiting.get(m.id)?.(m);
      }
    });
    let id = 0;
    const rpc = (method: string, params: unknown) =>
      new Promise<{ result: { content: Array<{ text: string }> } }>((r) => {
        waiting.set(++id, r);
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    const call = async (name: string, args: unknown) =>
      (await rpc("tools/call", { name, arguments: args })).result.content.map((c) => c.text).join("\n");

    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const during = await call("create_version", { app_id: "1", version_string: "2.0" });
    expect(during).toContain("could not be checked");
    expect(during).not.toContain("7 days");

    up = true;
    // The retry is rate limited, so the doctor's own check is what picks this up.
    await call("asc_setup_check", {});
    const after = await call("create_version", { app_id: "1", version_string: "2.0" });
    expect(after).not.toContain("requires Pro");
    expect(after).toContain("confirm");
  }, 30_000);
});
