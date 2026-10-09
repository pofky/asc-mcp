import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clientConfigCandidatesForTest, injectLicenseKey, writeServerBlock } from "../src/setup.js";
import { saveLicenseKey, savedLicenseKey, savedLicenseKeyPath } from "../src/license.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");
const LAUNCH = { command: "npx", args: ["-y", "@pofky/asc-mcp"] };

/**
 * A trial key used to live only as long as the session that started it unless
 * this server's block sat at the top level of one of three config files. These
 * are the installs that fell outside that, each of which restarted on the free
 * tier with no sign a trial had ever existed.
 */
describe("a trial key reaches the config of the client that is actually in use", () => {
  it("finds a server added with `claude mcp add`, which lives under a project", () => {
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    const path = join(home, ".claude.json");
    writeFileSync(
      path,
      JSON.stringify({
        numStartups: 4,
        projects: {
          "/Users/dev/myapp": { mcpServers: { "appstore-connect": { ...LAUNCH, env: { ASC_ISSUER_ID: "i" } } } },
          "/Users/dev/other": { mcpServers: { unrelated: { command: "node", args: ["x.js"] } } },
        },
      }),
    );

    const { updated } = injectLicenseKey("ASC-KEY", [{ label: "Claude Code", path }]);
    expect(updated).toEqual([path]);

    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.projects["/Users/dev/myapp"].mcpServers["appstore-connect"].env).toEqual({
      ASC_ISSUER_ID: "i",
      ASC_LICENSE_KEY: "ASC-KEY",
    });
    expect(after.projects["/Users/dev/other"].mcpServers.unrelated.env).toBeUndefined();
    expect(after.numStartups).toBe(4);
  });

  for (const client of ["Cursor", "Windsurf", "Cline"]) {
    it(`finds a ${client} config at the path it offers for that client`, () => {
      const home = mkdtempSync(join(tmpdir(), "asc-home-"));
      const candidates = clientConfigCandidatesForTest("darwin", home);
      const target = candidates.find((c) => c.label === client)!;
      mkdirSync(dirname(target.path), { recursive: true });
      writeFileSync(target.path, JSON.stringify({ mcpServers: { asc: { ...LAUNCH, env: {} } } }));

      const { updated } = injectLicenseKey("ASC-KEY", candidates);
      expect(updated).toEqual([target.path]);
      expect(JSON.parse(readFileSync(target.path, "utf8")).mcpServers.asc.env.ASC_LICENSE_KEY).toBe("ASC-KEY");
    });
  }
});

/**
 * `init --write` on a machine where Claude Code holds the server under a
 * project. A second, top-level block would be shadowed by the project's one, so
 * the run would report success and the client would start the old block.
 */
describe("init --write with a server Claude Code keeps under a project", () => {
  it("updates that block instead of adding a top-level one beside it", () => {
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    const path = join(home, ".claude.json");
    writeFileSync(
      path,
      JSON.stringify({
        projects: { "/p": { mcpServers: { "appstore-connect": { ...LAUNCH, env: { ASC_LICENSE_KEY: "k" } } } } },
      }),
    );
    const status = writeServerBlock(path, { ASC_ISSUER_ID: "new" });
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.mcpServers).toBeUndefined();
    expect(after.projects["/p"].mcpServers["appstore-connect"].env).toEqual({
      ASC_LICENSE_KEY: "k",
      ASC_ISSUER_ID: "new",
    });
    expect(status).toContain("1 project");
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  it("still writes the top-level block when no project holds the server", () => {
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    const path = join(home, ".claude.json");
    writeFileSync(path, JSON.stringify({ projects: { "/p": { mcpServers: { other: { command: "node" } } } } }));
    writeServerBlock(path, { ASC_ISSUER_ID: "new" });
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.mcpServers["appstore-connect"].env).toEqual({ ASC_ISSUER_ID: "new" });
    expect(after.projects["/p"].mcpServers.other.env).toBeUndefined();
  });
});

describe("a key saved on this machine", () => {
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  afterEach(() => {
    process.env.HOME = realHome;
    process.env.USERPROFILE = realProfile;
  });
  function tempHome(): string {
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    return home;
  }

  it("round-trips, and only its owner can read the file", () => {
    const home = tempHome();
    expect(savedLicenseKey()).toBeUndefined();
    expect(saveLicenseKey("  ASC-KEY  ")).toBe(true);
    expect(savedLicenseKey()).toBe("ASC-KEY");
    expect(savedLicenseKeyPath().startsWith(home)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(savedLicenseKeyPath()).mode & 0o777).toBe(0o600);
    }
  });

  it("tightens a file that was left readable by others", () => {
    if (process.platform === "win32") return;
    const home = tempHome();
    mkdirSync(join(home, ".asc-mcp"));
    writeFileSync(savedLicenseKeyPath(), "{}", { mode: 0o644 });
    expect(saveLicenseKey("ASC-KEY")).toBe(true);
    expect(statSync(savedLicenseKeyPath()).mode & 0o777).toBe(0o600);
  });

  it("refuses a blank or unexpanded value, and reports a home it cannot write to", () => {
    const home = tempHome();
    expect(saveLicenseKey("")).toBe(false);
    expect(saveLicenseKey("${user_config.asc_license_key}")).toBe(false);
    expect(existsSync(savedLicenseKeyPath())).toBe(false);

    // A file where the folder should be: the write cannot succeed.
    writeFileSync(join(home, ".asc-mcp"), "not a folder");
    expect(saveLicenseKey("ASC-KEY")).toBe(false);
  });

  it("ignores a file that is not what this server wrote", () => {
    const home = tempHome();
    mkdirSync(join(home, ".asc-mcp"));
    writeFileSync(savedLicenseKeyPath(), "{ not json");
    expect(savedLicenseKey()).toBeUndefined();
    writeFileSync(savedLicenseKeyPath(), JSON.stringify({ key: 42 }));
    expect(savedLicenseKey()).toBeUndefined();
  });
});

/**
 * The part that matters to a user: the next session. Driven against the built
 * server with a stand-in licence server, because what is promised is which key
 * the restarted process sends for validation.
 */
describe("the next session, with no key in the client config", () => {
  beforeAll(() => {
    if (!existsSync(ENTRY)) throw new Error("dist/index.js is missing. Run `npm run build` first.");
  });

  let server: Server | undefined;
  afterEach(() => server?.close());

  /** Start the built server once and return the keys it asked the licence server about. */
  async function keysValidated(home: string, envKey?: string): Promise<string[]> {
    const seen: string[] = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/validate") seen.push(JSON.parse(body).key);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ valid: false, tier: "free", reason: "trial_expired" }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };

    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ASC_KEY_ID: "x",
        ASC_ISSUER_ID: "x",
        ASC_PRIVATE_KEY_PATH: "/dev/null",
        ASC_LICENSE_KEY: envKey,
        ASC_LICENSE_API_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }) + "\n",
    );
    child.stdin.end();
    await new Promise((resolve) => {
      child.on("close", resolve);
      setTimeout(() => {
        child.kill();
        resolve(null);
      }, 20_000);
    });
    return seen;
  }

  function homeWithSavedKey(key: string): string {
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    mkdirSync(join(home, ".asc-mcp"));
    writeFileSync(join(home, ".asc-mcp", "license.json"), JSON.stringify({ key }));
    return home;
  }

  it("validates the saved key, so an ended trial is recognised as one", async () => {
    expect(await keysValidated(homeWithSavedKey("ASC-SAVED"))).toEqual(["ASC-SAVED"]);
  }, 30_000);

  it("lets a key in the client config overrule the saved one", async () => {
    expect(await keysValidated(homeWithSavedKey("ASC-SAVED"), "ASC-FROM-CONFIG")).toEqual(["ASC-FROM-CONFIG"]);
  }, 30_000);

  it("asks about nothing when there is no key anywhere", async () => {
    expect(await keysValidated(mkdtempSync(join(tmpdir(), "asc-home-")))).toEqual([]);
  }, 30_000);
});

/**
 * A subscriber who pasted a trial key into their client's own settings, then
 * fetches the paid key in-agent. The client's setting wins on the next start,
 * so "saved, survives a restart" would put a paying customer back on the
 * expired trial key with nothing telling them why.
 */
describe("fetching a paid key while an older key is set in the client", () => {
  beforeAll(() => {
    if (!existsSync(ENTRY)) throw new Error("dist/index.js is missing. Run `npm run build` first.");
  });

  let server: Server | undefined;
  afterEach(() => server?.close());

  /** Run asc_start_trial against a stand-in licence server that hands back PAID-KEY as a subscription. */
  async function fetchPaidKey(
    env: Record<string, string | undefined>,
    prepareHome: (home: string) => void = () => {},
  ): Promise<string> {
    server = createServer((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          req.url === "/trial"
            ? JSON.stringify({ key: "PAID-KEY", expires: null, days_remaining: 0, subscription: true })
            : JSON.stringify({ valid: false, tier: "free", reason: "trial_expired" }),
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const home = mkdtempSync(join(tmpdir(), "asc-home-"));
    prepareHome(home);

    const child = spawn(process.execPath, [ENTRY], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ASC_KEY_ID: "x",
        ASC_ISSUER_ID: "x",
        ASC_PRIVATE_KEY_PATH: "/dev/null",
        ASC_LICENSE_KEY: undefined,
        ASC_INSTALL: undefined,
        ASC_LICENSE_API_URL: `http://127.0.0.1:${port}`,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "asc_start_trial", arguments: { email: "dev@example.com" } },
    });
    const reply = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply. stdout: ${out}`)), 20_000);
      child.stdout.on("data", () => {
        for (const line of out.split("\n").filter(Boolean)) {
          try {
            const message = JSON.parse(line);
            if (message.id === 2) {
              clearTimeout(timer);
              resolve(message.result.content[0].text);
            }
          } catch {
            // A partial line; the next chunk completes it.
          }
        }
      });
    });
    child.kill();
    return reply;
  }

  it("says the client's key will win, and where to replace it, for a plugin install", async () => {
    const reply = await fetchPaidKey({ ASC_LICENSE_KEY: "OLD-TRIAL-KEY", ASC_INSTALL: "plugin" });
    expect(reply).toContain("PAID-KEY");
    expect(reply).toContain("A different key is set in your client's own settings");
    expect(reply).toContain("License key option in the asc-mcp plugin's settings");
    expect(reply).not.toContain("now in your config");
  }, 30_000);

  it("still warns a plugin install when some other client's config was rewritten", async () => {
    // The plugin's own key is out of reach of any config edit, so a Cursor
    // file taking the new key does not change which key this client starts on.
    const reply = await fetchPaidKey({ ASC_LICENSE_KEY: "OLD-TRIAL-KEY", ASC_INSTALL: "plugin" }, (home) => {
      mkdirSync(join(home, ".cursor"));
      writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { asc: { ...LAUNCH, env: {} } } }));
    });
    expect(reply).toContain(join(".cursor", "mcp.json"));
    expect(reply).toContain("A different key is set in your client's own settings");
    expect(reply).not.toContain("so it survives a restart");
  }, 30_000);

  it("says nothing of the kind when the client had no key", async () => {
    const reply = await fetchPaidKey({});
    expect(reply).toContain("PAID-KEY");
    expect(reply).toContain("so it survives a restart");
    expect(reply).not.toContain("A different key");
  }, 30_000);

  it("says nothing of the kind when the client already holds this key", async () => {
    const reply = await fetchPaidKey({ ASC_LICENSE_KEY: "PAID-KEY" });
    expect(reply).not.toContain("A different key");
  }, 30_000);
});
