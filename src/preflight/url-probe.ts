import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { PARKED_PAGE_MARKERS, THIN_PAGE_TEXT_CHARS } from "./rules.js";
import type { ProbeOutcome, ProbeResults } from "./types.js";

/**
 * The only code in preflight that requests a URL a developer's record supplied.
 * Those URLs are untrusted: this runs on the user's machine, next to whatever
 * that machine can reach. So http(s) only; each address is checked at the moment
 * of connecting, on every redirect hop, which also defeats a host that resolves
 * public first and private second; no cookies, tokens or licence key are sent;
 * and the body is reduced to two booleans, so a page cannot talk to the agent
 * reading the report.
 */

const MAX_REDIRECTS = 5;
/** Per URL, redirects included. Long enough for a slow host, short enough to bound a report. */
const TIMEOUT_MS = 8000;
const MAX_PARALLEL = 16;
/** Enough to tell an empty or parked page, and no more. */
const BODY_CAP_BYTES = 64 * 1024;
const USER_AGENT = "asc-mcp-preflight (+https://asc-mcp.pages.dev)";

/** Statuses that say the site chose not to answer a robot. A browser may do fine. */
const INCONCLUSIVE_STATUS = new Set([401, 403, 405, 406, 407, 408, 425, 429, 451]);

/** Every range not reachable as a public web page. */
function buildBlockList(): BlockList {
  const list = new BlockList();
  for (const [net, bits] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ] as const) list.addSubnet(net, bits, "ipv4");
  for (const [net, bits] of [
    ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["100::", 64],
  ] as const) list.addSubnet(net, bits, "ipv6");
  return list;
}
const BLOCKED = buildBlockList();

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family !== 6) return true;
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return BLOCKED.check(mapped[1], "ipv4");
  // The hex spelling of the same mapped range, ::ffff:7f00:1.
  const hex = address.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return BLOCKED.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
  }
  return BLOCKED.check(address, "ipv6");
}

export interface ProbeOptions {
  /**
   * Which addresses may be connected to. Only tests pass this, to reach their
   * own local server; it is deliberately an argument and not an environment
   * variable, so nothing in a user's setup can switch the guard off.
   */
  allowAddress?: (address: string) => boolean;
  timeoutMs?: number;
}

class RefusedAddress extends Error {}

type Hop =
  | { kind: "response"; res: IncomingMessage }
  | { kind: "error"; code: string; refused: boolean };

function requestOnce(url: URL, allow: (a: string) => boolean, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve) => {
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !allow(literal)) {
      resolve({ kind: "error", code: "REFUSED", refused: true });
      return;
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        signal,
        agent: false,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8" },
        // Every address is checked here, at connect time, so what was checked is
        // what gets connected to.
        lookup: (hostname: string, options: unknown, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
          dnsLookup(hostname, { all: true }, (err, addresses) => {
            if (err) return callback(err, "", 0);
            if (addresses.some((a) => !allow(a.address))) return callback(new RefusedAddress("private address"), "", 0);
            if ((options as { all?: boolean } | undefined)?.all) return callback(null, addresses);
            callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (res) => resolve({ kind: "response", res }),
    );
    req.on("error", (err) => {
      resolve({
        kind: "error",
        code: (err as NodeJS.ErrnoException).code ?? err.name,
        refused: err instanceof RefusedAddress,
      });
    });
    req.end();
  });
}

/** Reads at most the cap, keeps only two facts, and drops the connection. */
function inspectBody(res: IncomingMessage): Promise<{ thin: boolean; parked: boolean }> {
  return new Promise((resolve) => {
    const contentType = String(res.headers["content-type"] ?? "");
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      res.destroy();
      if (!/html/i.test(contentType)) return resolve({ thin: false, parked: false });
      const html = Buffer.concat(chunks).toString("utf8");
      const hasScript = /<script\b/i.test(html);
      const text = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      resolve({
        // A page built by scripts has little text until a browser runs them.
        thin: !hasScript && text.length < THIN_PAGE_TEXT_CHARS,
        parked: PARKED_PAGE_MARKERS.some((m) => m.test(text)),
      });
    };
    res.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= BODY_CAP_BYTES) finish();
    });
    res.on("end", finish);
    res.on("error", finish);
    res.on("close", finish);
  });
}

function outcomeForError(code: string, refused: boolean): ProbeOutcome {
  if (refused) return { kind: "inconclusive", detail: "it points at a private address, so it was not requested" };
  if (code === "ENOTFOUND") return { kind: "dead", detail: "the domain does not resolve" };
  if (code === "ECONNREFUSED") return { kind: "dead", detail: "the server refused the connection" };
  if (/CERT|SSL|TLS/i.test(code)) return { kind: "dead", detail: "its TLS certificate is not valid" };
  if (code === "AbortError" || code === "ABORT_ERR" || code === "ETIMEDOUT") return { kind: "inconclusive", detail: "it did not answer in time" };
  return { kind: "inconclusive", detail: `the connection failed (${code.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)})` };
}

/** Follows one URL to its answer. Never throws. */
export async function probeUrl(raw: string, options: ProbeOptions = {}): Promise<ProbeOutcome> {
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch (err) {
    return { kind: "dead", detail: `it is not a valid URL (${err instanceof Error ? err.name : "parse error"})` };
  }
  const allow = options.allowAddress ?? ((a: string) => !isPrivateAddress(a));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        return { kind: "dead", detail: `it uses ${current.protocol.replace(/[^a-z0-9+.:-]/gi, "").slice(0, 12)}, not a web address` };
      }
      if (current.username || current.password) {
        return { kind: "inconclusive", detail: "it carries a username or password, so it was not requested" };
      }
      const answer = await requestOnce(current, allow, controller.signal);
      if (answer.kind === "error") return outcomeForError(answer.code, answer.refused);
      const { res } = answer;
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        try {
          current = new URL(res.headers.location, current);
        } catch (err) {
          return { kind: "dead", detail: `it redirects to an invalid address (${err instanceof Error ? err.name : "parse error"})` };
        }
        continue;
      }
      if (status >= 200 && status < 300) {
        const { thin, parked } = await inspectBody(res);
        return { kind: "live", status, thin, parked };
      }
      res.destroy();
      if (INCONCLUSIVE_STATUS.has(status) || status >= 500) {
        return { kind: "inconclusive", detail: `it returned ${status}, which can mean the site blocks automated requests` };
      }
      return { kind: "dead", detail: `it returned ${status}` };
    }
    return { kind: "dead", detail: `it redirects more than ${MAX_REDIRECTS} times` };
  } finally {
    clearTimeout(timer);
  }
}

/** Each distinct URL once, however many locales share it. */
export async function probeUrls(urls: Iterable<string>, options: ProbeOptions = {}): Promise<ProbeResults> {
  const queue = [...new Set(urls)];
  const results: ProbeResults = {};
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const url = queue[next++];
      results[url] = await probeUrl(url, options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, worker));
  return results;
}
