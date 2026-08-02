import { execSync } from "child_process";
import type { Tier } from "../types.js";
import { UPGRADE_URL } from "../gate.js";

const WHATS_NEW_MAX = 4000;

export const releaseNotesDefinition = {
  name: "release_notes",
  description:
    "Extract git commits since the last tag and return them in a structured format for writing App Store 'What's New' release notes. The AI agent uses this output to draft user-facing release notes. Also validates against Apple's 4000-character limit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project_path: {
        type: "string",
        description:
          "Path to the git project directory. If omitted, uses the current working directory.",
      },
      since_tag: {
        type: "string",
        description:
          "Git tag to compare from (e.g. 'v1.0.0'). If omitted, uses the latest tag automatically.",
      },
      max_commits: {
        type: "number",
        description: "Maximum number of commits to include (default 50).",
      },
    },
    required: [] as string[],
  },
};

export async function releaseNotes(args: {
  project_path?: string;
  since_tag?: string;
  max_commits?: number;
}, tier: Tier): Promise<string> {
  if (tier !== "pro") {
    return (
      "Release notes generation requires a Pro license ($9/mo).\n" +
      "Get your license at: " + UPGRADE_URL + "\n\n" +
      "Set ASC_LICENSE_KEY in your MCP server config to unlock."
    );
  }
  const cwd = args.project_path || process.cwd();
  const maxCommits = args.max_commits || 50;

  // Check if this is a git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "Error: not a git repository. Run this tool from a git project directory.";
  }

  // Find the base tag to diff from
  let sinceTag = args.since_tag || "";
  if (!sinceTag) {
    try {
      sinceTag = execSync("git describe --tags --abbrev=0 HEAD 2>/dev/null", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      // No tags exist, use first commit
      sinceTag = "";
    }
  }

  // Get commits
  let gitLogCmd: string;
  if (sinceTag) {
    gitLogCmd = `git log ${sinceTag}..HEAD --oneline --no-merges --max-count=${maxCommits}`;
  } else {
    gitLogCmd = `git log --oneline --no-merges --max-count=${maxCommits}`;
  }

  let commits: string;
  try {
    commits = execSync(gitLogCmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "Error: could not read git log.";
  }

  if (!commits) {
    return sinceTag
      ? `No new commits since tag '${sinceTag}'.`
      : "No commits found in this repository.";
  }

  const commitLines = commits.split("\n");

  // Categorize commits by conventional commit type
  const categories: Record<string, string[]> = {
    features: [],
    fixes: [],
    improvements: [],
    other: [],
  };

  for (const line of commitLines) {
    // Remove the hash prefix
    const message = line.replace(/^[a-f0-9]+ /, "");
    const lower = message.toLowerCase();

    if (lower.startsWith("feat") || lower.startsWith("add")) {
      categories.features.push(message);
    } else if (
      lower.startsWith("fix") ||
      lower.startsWith("bug") ||
      lower.startsWith("patch")
    ) {
      categories.fixes.push(message);
    } else if (
      lower.startsWith("refactor") ||
      lower.startsWith("perf") ||
      lower.startsWith("improve") ||
      lower.startsWith("update") ||
      lower.startsWith("enhance")
    ) {
      categories.improvements.push(message);
    } else {
      categories.other.push(message);
    }
  }

  // Build structured output
  let result = `## Git History for Release Notes\n\n`;
  result += `**Since**: ${sinceTag || "(beginning of history)"}\n`;
  result += `**Commits**: ${commitLines.length}\n`;
  result += `**Character limit**: ${WHATS_NEW_MAX} chars for "What's New"\n\n`;

  if (categories.features.length > 0) {
    result += `### New Features (${categories.features.length})\n`;
    for (const c of categories.features) {
      result += `- ${c}\n`;
    }
    result += "\n";
  }

  if (categories.fixes.length > 0) {
    result += `### Bug Fixes (${categories.fixes.length})\n`;
    for (const c of categories.fixes) {
      result += `- ${c}\n`;
    }
    result += "\n";
  }

  if (categories.improvements.length > 0) {
    result += `### Improvements (${categories.improvements.length})\n`;
    for (const c of categories.improvements) {
      result += `- ${c}\n`;
    }
    result += "\n";
  }

  if (categories.other.length > 0) {
    result += `### Other Changes (${categories.other.length})\n`;
    for (const c of categories.other) {
      result += `- ${c}\n`;
    }
    result += "\n";
  }

  result += `---\n`;
  result += `**Instructions for the AI agent**: Use the commit list above to write user-facing "What's New" text for the App Store. Guidelines:\n`;
  result += `- Write for end users, not developers (no commit hashes, no technical jargon)\n`;
  result += `- Lead with the most impactful change\n`;
  result += `- Keep it under ${WHATS_NEW_MAX} characters\n`;
  result += `- Use short bullet points\n`;
  result += `- Do not mention internal refactors or build changes unless they affect the user\n`;

  return result;
}
