import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this repo's own suite. Without an explicit include, vitest walks the
    // whole tree and picks up test files inside .claude/worktrees, so a run
    // would silently execute several copies of the suite at once and report a
    // test count that has nothing to do with this checkout.
    include: ["tests/**/*.test.ts"],
    // Absolute, because the licence worker runs its own suite from its own
    // folder under this same config.
    setupFiles: [fileURLToPath(new URL("./tests/setup-home.ts", import.meta.url))],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/.wrangler/**"],
  },
});
