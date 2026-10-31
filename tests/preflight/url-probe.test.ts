import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress, probeUrl, probeUrls } from "../../src/preflight/url-probe.js";

let server: Server;
let base: string;
const seenHeaders: Array<Record<string, unknown>> = [];
let bodyBytesSent = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHeaders.push({ ...req.headers });
    const page = (body: string) => {
      res.setHeader("content-type", "text/html");
      res.end(body);
    };
    switch (req.url) {
      case "/ok": return page(`<html><body>${"words ".repeat(100)}</body></html>`);
      case "/empty": return page("<html><body>hi</body></html>");
      case "/spa": return page(`<html><body><div id=root></div><script src="/app.js"></script></body></html>`);
      case "/parked": return page(`<html><body>This domain is for sale. ${"x ".repeat(200)}</body></html>`);
      case "/pdf": res.setHeader("content-type", "application/pdf"); return res.end("short");
      case "/404": res.statusCode = 404; return res.end();
      case "/500": res.statusCode = 500; return res.end();
      case "/403": res.statusCode = 403; return res.end();
      case "/429": res.statusCode = 429; return res.end();
      case "/redirect": res.statusCode = 302; res.setHeader("location", "/ok"); return res.end();
      case "/loop": res.statusCode = 302; res.setHeader("location", "/loop"); return res.end();
      case "/to-file": res.statusCode = 302; res.setHeader("location", "file:///etc/passwd"); return res.end();
      case "/to-loopback": res.statusCode = 302; res.setHeader("location", `${base}/ok`); return res.end();
      case "/slow": return void setTimeout(() => page("late"), 2000);
      case "/huge": {
        res.setHeader("content-type", "text/html");
        const chunk = Buffer.alloc(64 * 1024, "a");
        const send = () => {
          if (res.destroyed || bodyBytesSent > 64 * 1024 * 1024) return res.end();
          bodyBytesSent += chunk.length;
          res.write(chunk, () => setImmediate(send));
        };
        return send();
      }
      default: res.statusCode = 404; return res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

/** The test seam: only this suite's own loopback server is let through. */
const local = { allowAddress: (a: string) => a === "127.0.0.1" };

describe("probeUrl", () => {
  it("calls a page that answers live", async () => {
    expect(await probeUrl(`${base}/ok`, local)).toEqual({ kind: "live", status: 200, thin: false, parked: false });
  });
  it("follows a redirect", async () => {
    expect((await probeUrl(`${base}/redirect`, local)).kind).toBe("live");
  });
  it("calls a 404 dead, naming the status", async () => {
    const r = await probeUrl(`${base}/404`, local);
    expect(r).toEqual({ kind: "dead", detail: "it returned 404" });
  });
  it.each(["/403", "/429", "/500"])("does not call %s dead, because a site may just block robots", async (path) => {
    const r = await probeUrl(`${base}${path}`, local);
    expect(r.kind).toBe("inconclusive");
  });
  it("stops following a redirect loop", async () => {
    const r = await probeUrl(`${base}/loop`, local);
    expect(r.kind).toBe("dead");
    if (r.kind === "dead") expect(r.detail).toContain("redirects more than");
  });
  it("calls a slow answer inconclusive, within the time limit", async () => {
    const t = Date.now();
    const r = await probeUrl(`${base}/slow`, { ...local, timeoutMs: 200 });
    expect(r.kind).toBe("inconclusive");
    expect(Date.now() - t).toBeLessThan(1500);
  });
  it("reads a huge page only up to the cap, then hangs up", async () => {
    const r = await probeUrl(`${base}/huge`, local);
    expect(r.kind).toBe("live");
    expect(bodyBytesSent).toBeLessThan(16 * 1024 * 1024);
  });
  it("marks an empty page and a parked page, and leaves script-built pages and PDFs alone", async () => {
    expect(await probeUrl(`${base}/empty`, local)).toMatchObject({ thin: true });
    expect(await probeUrl(`${base}/parked`, local)).toMatchObject({ parked: true });
    expect(await probeUrl(`${base}/spa`, local)).toMatchObject({ thin: false });
    expect(await probeUrl(`${base}/pdf`, local)).toMatchObject({ thin: false });
  });
  it("returns no part of a body", async () => {
    const r = await probeUrl(`${base}/parked`, local);
    expect(JSON.stringify(r)).not.toContain("for sale");
  });
  it("sends no credentials and identifies itself", async () => {
    seenHeaders.length = 0;
    await probeUrl(`${base}/ok`, local);
    const headers = seenHeaders[0];
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(String(headers["user-agent"])).toContain("asc-mcp-preflight");
  });
  it("refuses other schemes, including through a redirect", async () => {
    expect((await probeUrl("ftp://example.com/x")).kind).toBe("dead");
    expect((await probeUrl("file:///etc/passwd")).kind).toBe("dead");
    expect((await probeUrl(`${base}/to-file`, local)).kind).toBe("dead");
  });
  it("calls text that is not a URL dead", async () => {
    expect((await probeUrl("not a url")).kind).toBe("dead");
  });
  it("does not request a URL carrying a password", async () => {
    seenHeaders.length = 0;
    const r = await probeUrl(`http://u:p@127.0.0.1:${(server.address() as AddressInfo).port}/ok`, local);
    expect(r.kind).toBe("inconclusive");
    expect(seenHeaders).toHaveLength(0);
  });
});

describe("the private address guard, with no test seam", () => {
  it("never requests loopback, however it is spelled", async () => {
    seenHeaders.length = 0;
    const port = (server.address() as AddressInfo).port;
    for (const host of ["127.0.0.1", "localhost", "2130706433", "0x7f.0.0.1", "127.1", "[::1]", "[::ffff:127.0.0.1]"]) {
      const r = await probeUrl(`http://${host}:${port}/ok`);
      expect(r.kind, host).not.toBe("live");
    }
    expect(seenHeaders).toHaveLength(0);
  });
  it("never follows a public-looking redirect into loopback", async () => {
    seenHeaders.length = 0;
    // First hop allowed by the seam, the second judged by the real guard: the
    // seam only ever admits the first request here.
    let hops = 0;
    const r = await probeUrl(`${base}/to-loopback`, {
      allowAddress: (a) => (hops++ === 0 ? a === "127.0.0.1" : !isPrivateAddress(a)),
    });
    expect(r.kind).toBe("inconclusive");
    expect(seenHeaders).toHaveLength(1);
  });
  it("calls the metadata address and the private ranges private", () => {
    for (const a of ["169.254.169.254", "10.0.0.1", "172.16.0.1", "192.168.1.1", "127.0.0.1", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "::7f00:1", "2002:7f00:1::"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["17.253.144.10", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });
});

describe("probeUrls", () => {
  it("loads each distinct URL once", async () => {
    seenHeaders.length = 0;
    const results = await probeUrls([`${base}/ok`, `${base}/ok`, `${base}/404`], local);
    expect(Object.keys(results)).toHaveLength(2);
    expect(seenHeaders).toHaveLength(2);
  });
});
