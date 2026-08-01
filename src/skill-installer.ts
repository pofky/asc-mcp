/**
 * `asc-mcp install-skill` and `asc-mcp uninstall-skill` subcommands.
 *
 * Copies (or removes) the bundled `asc-review-triage` Claude Skill to
 * ~/.claude/skills/asc-review-triage/ so Claude Desktop and Claude Code
 * auto-load it.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKILL_NAME = "asc-review-triage";

function targetDir(): string {
  return path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
}

function sourceDir(): string {
  // When compiled, __dirname maps to dist/. The skills/ dir ships at
  // the package root, one level up. CommonJS build uses __dirname.
  return path.resolve(__dirname, "..", "skills", SKILL_NAME);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirRecursive(src: string, dest: string): string[] {
  ensureDir(dest);
  const written: string[] = [];
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      written.push(...copyDirRecursive(s, d));
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      written.push(d);
    }
  }
  return written;
}

export function installSkill(): number {
  const src = sourceDir();
  const dest = targetDir();

  if (!fs.existsSync(src)) {
    console.error(`[asc-mcp] skill source not found at ${src}`);
    console.error("[asc-mcp] this is a packaging bug, please open an issue.");
    return 1;
  }

  try {
    console.log(`Installing ${SKILL_NAME} skill for Claude Desktop / Claude Code.`);
    console.log("");
    console.log(`Writing to ${dest}`);

    const homeClaude = path.join(os.homedir(), ".claude");
    const homeClaudeExisted = fs.existsSync(homeClaude);
    const skillsParentExisted = fs.existsSync(path.dirname(dest));

    ensureDir(dest);
    const written = copyDirRecursive(src, dest);

    console.log(`  ${homeClaudeExisted ? " " : "+"} ~/.claude/ ${homeClaudeExisted ? "already existed" : "created"}`);
    console.log(`  ${skillsParentExisted ? " " : "+"} ~/.claude/skills/ ${skillsParentExisted ? "already existed" : "created"}`);
    for (const f of written) {
      console.log(`  + ${path.relative(os.homedir(), f)}`);
    }
    console.log("");
    console.log("Done. The skill is now active.");
    console.log("");
    console.log("Next: in Claude Desktop or Claude Code, try asking");
    console.log('  "any bad reviews on my app lately?"');
    console.log("Claude will auto-load the skill and call the right tools.");
    console.log("");
    console.log("If Claude does not pick it up, restart the client once.");
    console.log("To remove: npx @pofky/asc-mcp uninstall-skill");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[asc-mcp] install failed: ${msg}`);
    return 1;
  }
}

export function uninstallSkill(): number {
  const dest = targetDir();
  if (!fs.existsSync(dest)) {
    console.log(`No ${SKILL_NAME} skill found at ${dest}. Nothing to do.`);
    return 0;
  }
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    console.log(`Removed ${dest}`);
    console.log("Restart Claude Desktop or Claude Code to unload the skill.");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[asc-mcp] uninstall failed: ${msg}`);
    return 1;
  }
}
