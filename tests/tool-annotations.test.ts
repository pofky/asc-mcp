import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_NAMES } from "../src/tool-meta.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> };
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Start the built server, list its tools, and return them with its stderr. */
async function listTools(
  env: Record<string, string | undefined>,
): Promise<{ tools: ListedTool[]; err: string }> {
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
        protocolVersion: "2025-06-18",
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
  await new Promise((resolve) => {
    child.on("close", resolve);
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 20_000);
  });

  for (const line of out.split("\n").filter(Boolean)) {
    try {
      const message = JSON.parse(line);
      if (message.id === 2) return { tools: message.result.tools, err };
    } catch {
      // Not a JSON-RPC frame.
    }
  }
  throw new Error(`no tools/list response. stderr: ${err}`);
}

/** Enough to leave setup mode. No licence, so nothing is sent anywhere. */
const FULL_MODE = {
  ASC_KEY_ID: "x",
  ASC_ISSUER_ID: "x",
  ASC_PRIVATE_KEY_PATH: "/dev/null",
  ASC_LICENSE_KEY: undefined,
};
const SETUP_MODE = {
  ASC_KEY_ID: undefined,
  ASC_ISSUER_ID: undefined,
  ASC_PRIVATE_KEY_PATH: undefined,
  ASC_LICENSE_KEY: undefined,
};

/**
 * Anthropic's directory refuses a tool that has no title, or that declares
 * neither `readOnlyHint` nor `destructiveHint`, and a client uses the hints to
 * decide what it may run without asking. These run against the built server,
 * because the wire format is the thing being promised.
 */
describe("tool annotations on the wire", () => {
  beforeAll(() => {
    // Fail, do not skip: a missing build would let this whole file pass empty.
    if (!existsSync(ENTRY)) throw new Error("dist/index.js is missing. Run `npm run build` first.");
  });

  for (const [mode, env] of [
    ["full mode", FULL_MODE],
    ["setup mode", SETUP_MODE],
  ] as const) {
    it(`${mode}: every tool has a title and exactly one of the two hints`, async () => {
      const { tools } = await listTools(env);
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(t.title, `${t.name} has no title`).toBeTruthy();
        expect(t.annotations?.title, `${t.name} has no annotations.title`).toBe(t.title);
        const readOnly = t.annotations?.readOnlyHint === true;
        const destructive = t.annotations?.destructiveHint === true;
        expect(readOnly !== destructive, `${t.name}: readOnly=${readOnly} destructive=${destructive}`).toBe(true);
        expect(t.name.length).toBeLessThanOrEqual(64);
      }
    }, 30_000);
  }

  it("full mode registers exactly the tools the table describes", async () => {
    const { tools } = await listTools(FULL_MODE);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  }, 30_000);

  /**
   * The check that does not restate the table. A tool that takes `confirm`, or
   * a file to upload, or says it creates, sets, submits or invites, changes
   * something, and must never be announced as safe to run unprompted.
   */
  it("no tool that takes confirm, or says it changes something, is read-only", async () => {
    const { tools } = await listTools(FULL_MODE);
    const changes = /^(Create|Set |Submit|Upload|Edit|Release|Attach|Assign|Invite|Control|Build, archive|Prepare|Start)/;
    // These two are named set_* but only return Apple's manual steps and a link.
    const guidanceOnly = /returns the exact steps \+ deep link/;
    for (const t of tools) {
      const takesConfirm = Boolean(t.inputSchema?.properties?.confirm);
      const saysItChanges = changes.test(t.description ?? "") && !guidanceOnly.test(t.description ?? "");
      if (takesConfirm || saysItChanges) {
        expect(t.annotations?.readOnlyHint, `${t.name} is announced read-only`).toBe(false);
        expect(t.annotations?.destructiveHint, `${t.name}`).toBe(true);
      }
    }
  }, 30_000);
});

/**
 * A plugin hands its settings over as template fields. An optional one left
 * blank arrives empty or as the unexpanded template, and neither is a value.
 */
describe("blank plugin settings", () => {
  it("an unexpanded licence key is the free tier, not a key that failed", async () => {
    const { tools, err } = await listTools({
      ...FULL_MODE,
      ASC_LICENSE_KEY: "${user_config.asc_license_key}",
    });
    expect(tools.length).toBe(TOOL_NAMES.length);
    expect(err).toContain("Free tier");
  }, 30_000);

  it("an unexpanded key path falls back to discovery instead of a path that does not exist", async () => {
    const { tools, err } = await listTools({
      ASC_KEY_ID: undefined,
      ASC_ISSUER_ID: "x",
      ASC_PRIVATE_KEY_PATH: "${user_config.asc_private_key}",
      ASC_LICENSE_KEY: "",
    });
    // HOME has no key to discover, so this lands in setup mode. With the
    // literal kept, it would have started in full mode pointing at nothing.
    expect(tools.map((t) => t.name).sort()).toEqual(["asc_guide", "asc_setup_check"]);
    expect(err).toContain("setup mode");
  }, 30_000);
});

/**
 * The copy quotes two numbers, in the trial tool, the gate, the instructions
 * and the plugin README: how many tools there are, and how many are free.
 * These tie both to what the server registers, so adding a tool fails here
 * until the copy is brought along.
 */
describe("the numbers the copy quotes", () => {
  it("the trial tool's 'all N tools' is the number registered", async () => {
    const { tools } = await listTools(FULL_MODE);
    const trial = tools.find((t) => t.name === "asc_start_trial");
    expect(trial?.description).toContain(`all ${tools.length} tools`);
  }, 30_000);

  it("the plugin README's free-tool count is the number of tools not marked Pro", async () => {
    const { tools } = await listTools(FULL_MODE);
    const free = tools.filter((t) => !/Pro feature\.$/.test(t.description ?? "")).length;
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const word = words[free];
    const readme = readFileSync(join(ROOT, "plugin", "README.md"), "utf8");
    expect(readme).toContain(`${word[0].toUpperCase()}${word.slice(1)} tools are free`);
    expect(readme).toContain(`the ${word} free tools`);
  }, 30_000);
});

describe("plugin folder", () => {
  it("is in step with package.json, the skill and the licence", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts", "sync-plugin.mjs"), "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
