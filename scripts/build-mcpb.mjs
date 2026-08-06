#!/usr/bin/env node
/**
 * Build the `.mcpb` bundle: a zip of the built server, its production
 * dependencies and a manifest, which Claude for macOS and Windows installs in
 * one click.
 *
 * This exists because the documented install path asks a user to find their
 * client's JSON config, paste a server block into it, know where their `.p8`
 * lives, and restart. Every one of those is a place to give up, and they all
 * happen before the product has done anything for them. With a bundle the user
 * picks the `.p8` with a native file picker and pastes one Issuer ID.
 *
 * The manifest is generated rather than committed so the version, description
 * and author can never drift from package.json. `npm run mcpb`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = join(root, "build", "mcpb");

if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("dist/index.js is missing. Run `npm run build` first.");
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// The built server, and the skills directory it installs from.
cpSync(join(root, "dist"), join(stage, "server"), { recursive: true });
cpSync(join(root, "skills"), join(stage, "skills"), { recursive: true });
for (const f of ["README.md", "LICENSE", "USER_GUIDE.md", "LIMITATIONS.md"]) {
  cpSync(join(root, f), join(stage, f));
}

/**
 * Production dependencies only, resolved by npm rather than copied from the
 * dev tree, so a transitive dev dependency cannot ride along into a file users
 * download.
 */
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, private: true, type: pkg.type, dependencies: pkg.dependencies },
    null,
    2,
  ),
);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], {
  cwd: stage,
  stdio: "inherit",
});

const manifest = {
  manifest_version: "0.3",
  name: "asc-mcp",
  display_name: "asc-mcp",
  version: pkg.version,
  description:
    "Ship an App Store release from your agent. An MCP server for App Store Connect: 41 tools for metadata, screenshots, builds, TestFlight, in-app purchases, submit and release.",
  author: { name: "Povilas Konopackas", url: "https://asc-mcp.pages.dev" },
  homepage: "https://asc-mcp.pages.dev",
  documentation: "https://github.com/pofky/asc-mcp/blob/master/USER_GUIDE.md",
  support: "https://github.com/pofky/asc-mcp/issues",
  license: "MIT",
  keywords: ["app-store-connect", "ios", "testflight", "app-store", "release"],
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        ASC_ISSUER_ID: "${user_config.asc_issuer_id}",
        ASC_PRIVATE_KEY_PATH: "${user_config.asc_private_key}",
        ASC_LICENSE_KEY: "${user_config.asc_license_key}",
        // Marks a one-click install. There is no server block in any client
        // config file for an extension, so the trial tool must point people at
        // the extension's own License key field rather than at JSON they will
        // never find.
        ASC_INSTALL: "mcpb",
      },
    },
  },
  // Claude Desktop renders `description` twice: as help text above the field AND
  // as the input's placeholder. A sentence written only as help reads as a
  // truncated instruction inside the box, and says the same thing twice on
  // screen. So each one below has to work in both roles, which means short, and
  // shaped like an example rather than a paragraph. Verified against the real
  // Configure dialog, not against the spec.
  user_config: {
    asc_issuer_id: {
      type: "string",
      title: "Issuer ID",
      description: "The UUID from App Store Connect > Integrations > Keys",
      required: true,
    },
    asc_private_key: {
      type: "file",
      title: "API private key (.p8)",
      // File fields get a native "File path" placeholder and a Browse button, so
      // this string is help text only and can afford the reassurance.
      //
      // No Key ID field on purpose: Apple names the download
      // AuthKey_XXXXXXXXXX.p8, so the server derives the Key ID from the
      // filename. Asking for it would mean retyping something the user just
      // pointed at with a file picker.
      description:
        "Your AuthKey_XXXXXXXXXX.p8 from Apple. Read on this machine only, never transmitted.",
      required: true,
    },
    asc_license_key: {
      type: "string",
      title: "License key (optional)",
      description: "Leave empty, then ask your agent for a free 7-day trial",
      sensitive: true,
      required: false,
    },
  },
  compatibility: {
    runtimes: { node: ">=18.0.0" },
  },
};

writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

execFileSync("npx", ["--yes", "@anthropic-ai/mcpb", "pack", stage, join(root, "build", `asc-mcp-${pkg.version}.mcpb`)], {
  cwd: root,
  stdio: "inherit",
});

const out = join(root, "build", `asc-mcp-${pkg.version}.mcpb`);
const bytes = readdirSync(join(root, "build")).includes(`asc-mcp-${pkg.version}.mcpb`)
  ? readFileSync(out).length
  : 0;
console.log(`\n${out}  (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
