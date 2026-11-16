#!/usr/bin/env node
// Dev-only stdio proxy: runs dist/index.js as a child and restarts it whenever
// dist/ is rebuilt, so a client session that dogfoods asc-mcp picks up
// each fix without a /mcp reconnect. The client keeps one connection; after a
// restart the proxy replays the client's initialize handshake to the new child
// (swallowing its reply) and sends notifications/tools/list_changed so the
// client re-reads the tool list. Not shipped in the npm package.
//
// Use in a client config: "command": "node", "args": ["<repo>/scripts/dev-reload.mjs"]
import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const ENTRY = join(DIST, "index.js");
// tsc writes dist/ file by file; wait for the burst to settle before restarting.
const SETTLE_MS = 800;
// Ids the proxy uses for its own replayed handshake; never sent by a client.
const REPLAY_ID = "__dev_reload_init__";

const log = (msg) => process.stderr.write(`[asc-mcp dev-reload] ${msg}\n`);
const toClient = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

let child = null;
let initRequest = null; // the client's initialize request, replayed on restart
let initialized = false; // client sent notifications/initialized
let ready = false; // child can take client traffic
let queue = []; // client lines held while the child restarts
const pending = new Set(); // client request ids the current child has not answered
let restartWanted = false;

function start(replay) {
  ready = !replay;
  const c = spawn(process.execPath, [ENTRY, ...process.argv.slice(2)], {
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  child = c;
  createInterface({ input: c.stdout }).on("line", (line) => {
    if (c !== child) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(line + "\n");
      return;
    }
    if (msg.id === REPLAY_ID) {
      if (initialized) c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      ready = true;
      for (const q of queue) send(q);
      queue = [];
      toClient({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      log("reloaded; client told the tool list changed");
      return;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      pending.delete(msg.id);
      if (restartWanted && pending.size === 0) restart();
    }
    process.stdout.write(line + "\n");
  });
  c.on("exit", (code, signal) => {
    if (c !== child) return;
    // A crash with requests in flight: answer them so the client is not left waiting.
    for (const id of pending) {
      toClient({ jsonrpc: "2.0", id, error: { code: -32603, message: `asc-mcp exited (${signal ?? code}); retry the call` } });
    }
    pending.clear();
    if (!stopping) {
      log(`child exited (${signal ?? code}); restarting`);
      start(Boolean(initRequest));
      if (initRequest) replayInit();
    }
  });
}

function replayInit() {
  child.stdin.write(JSON.stringify({ ...initRequest, id: REPLAY_ID }) + "\n");
}

function send(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    child.stdin.write(line + "\n");
    return;
  }
  if (msg.method === "initialize") initRequest = msg;
  if (msg.method === "notifications/initialized") initialized = true;
  if (msg.id !== undefined && msg.method) pending.add(msg.id);
  child.stdin.write(line + "\n");
}

let stopping = false;
function restart() {
  restartWanted = false;
  if (!existsSync(ENTRY)) {
    log("dist/index.js missing after rebuild; keeping the running server");
    return;
  }
  const old = child;
  child = null;
  stopping = true;
  old.kill();
  stopping = false;
  start(Boolean(initRequest));
  if (initRequest) replayInit();
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  if (ready && child) send(line);
  else queue.push(line);
});
process.stdin.on("end", () => {
  stopping = true;
  child?.kill();
  process.exit(0);
});

let timer = null;
watch(DIST, { recursive: true }, (_event, file) => {
  if (!file || !file.endsWith(".js")) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Never cut off a call in flight: restart once the child has answered it.
    if (pending.size > 0) {
      restartWanted = true;
      log("dist changed; restarting after the call in flight");
    } else restart();
  }, SETTLE_MS);
});

start(false);
