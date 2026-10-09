import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseNotes } from "../src/tools/release-notes.js";

let repo: string;
let outside: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function commit(file: string, message: string) {
  writeFileSync(join(repo, file), message);
  git("add", file);
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-m", message);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "asc-rn-repo-"));
  outside = mkdtempSync(join(tmpdir(), "asc-rn-out-"));
  git("init", "-q");
  commit("a.txt", "chore: base");
  git("tag", "v1.0.0");
  commit("b.txt", "feat: dark mode");
  commit("c.txt", "fix: crash on launch");
  commit("d.txt", "docs: readme");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("release_notes shell safety", () => {
  it("does not execute a command smuggled in since_tag", async () => {
    const marker = join(outside, "pwned");
    const out = await releaseNotes(
      { project_path: repo, since_tag: `v1.0.0; touch ${marker} #` },
      "pro",
    );
    expect(existsSync(marker)).toBe(false);
    expect(out).toMatch(/^Error: since_tag/);
  });

  it.each([
    ["command substitution", "$(touch x)"],
    ["backticks", "`touch x`"],
    ["a space", "v1.0.0 HEAD"],
    ["a leading dash", "--output=x"],
    ["a pipe", "v1.0.0|cat"],
    ["a newline", "v1.0.0\ntouch x"],
  ])("rejects since_tag with %s", async (_label, tag) => {
    const out = await releaseNotes({ project_path: repo, since_tag: tag }, "pro");
    expect(out).toMatch(/^Error: since_tag/);
    expect(existsSync(join(repo, "x"))).toBe(false);
  });

  it("still lists the commits after a real tag", async () => {
    const out = await releaseNotes({ project_path: repo, since_tag: "v1.0.0" }, "pro");
    expect(out).toContain("**Commits**: 3");
    expect(out).toContain("feat: dark mode");
    expect(out).toContain("fix: crash on launch");
    expect(out).not.toContain("chore: base");
  });

  it("finds the latest tag when since_tag is omitted", async () => {
    const out = await releaseNotes({ project_path: repo }, "pro");
    expect(out).toContain("**Since**: v1.0.0");
  });

  it("reports an unknown tag instead of throwing", async () => {
    const out = await releaseNotes({ project_path: repo, since_tag: "v9.9.9" }, "pro");
    expect(out).toBe("Error: could not read git log.");
  });
});

describe("release_notes input bounds", () => {
  it.each([0, -1, Number.NaN, 2.5])("falls back to the default for max_commits %s", async (n) => {
    const out = await releaseNotes({ project_path: repo, since_tag: "v1.0.0", max_commits: n }, "pro");
    expect(out).toContain("**Commits**: 3");
  });

  it("honours a small max_commits", async () => {
    const out = await releaseNotes({ project_path: repo, since_tag: "v1.0.0", max_commits: 1 }, "pro");
    expect(out).toContain("**Commits**: 1");
  });

  it("accepts a huge max_commits by clamping it", async () => {
    const out = await releaseNotes({ project_path: repo, since_tag: "v1.0.0", max_commits: 1e9 }, "pro");
    expect(out).toContain("**Commits**: 3");
  });

  it("says so when project_path is not a directory", async () => {
    const out = await releaseNotes({ project_path: join(outside, "missing") }, "pro");
    expect(out).toMatch(/^Error: project_path/);
  });

  it("says so when the directory is not a git repository", async () => {
    const out = await releaseNotes({ project_path: outside }, "pro");
    expect(out).toBe("Error: not a git repository. Run this tool from a git project directory.");
  });
});

describe("no tool under src/ builds a shell command line", () => {
  // The injection above existed because one call site used the shell form. A
  // new one would be invisible to every other test here, so the source is read.
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );

  it("uses execFile with an argument vector, never exec or execSync", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = sources(src).filter((file) => /(?<![.\w])exec(Sync)?\s*\(/.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
