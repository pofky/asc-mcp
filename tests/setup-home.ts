import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test file gets a home of its own.
 *
 * The server keeps state under ~/.asc-mcp (the saved license key, the last
 * license verdict, the preview count), and code under test writes there. Left
 * pointed at the real home, a test run would spend the developer's own preview
 * calls and could read their own license key into a test.
 */
const home = mkdtempSync(join(tmpdir(), "asc-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
