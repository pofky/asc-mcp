import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "../src/prompts.js";

function makeServer() {
  return new McpServer(
    { name: "test-asc-mcp", version: "0.0.0" },
    { capabilities: { tools: {}, prompts: {} } },
  );
}

describe("registerPrompts", () => {
  it("registers exactly 3 prompts with the expected names", () => {
    const server = makeServer();
    const out = registerPrompts(server);
    const names = out.map((p) => p.name).sort();
    expect(names).toEqual([
      "asc-first-app",
      "asc-rejection-audit",
      "asc-release-go-no-go",
      "asc-ship-release",
      "asc-start",
      "asc-weekly-review",
    ]);
  });

  it("every registered prompt has a non-empty description", () => {
    const server = makeServer();
    const out = registerPrompts(server);
    for (const p of out) {
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it("each prompt title is human-readable (not empty)", () => {
    const server = makeServer();
    const out = registerPrompts(server);
    for (const p of out) {
      expect(p.title.length).toBeGreaterThan(0);
    }
  });

  it("registering prompts does not throw", () => {
    const server = makeServer();
    expect(() => registerPrompts(server)).not.toThrow();
  });
});
