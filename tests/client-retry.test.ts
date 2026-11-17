import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth.js", () => ({ getToken: async () => "tok" }));

import { ASCAPIError, ASCClient, ASCWriteTimeoutError, setRetryPolicy } from "../src/client.js";
import { explainError } from "../src/errors.js";

const client = new ASCClient({ keyId: "k", issuerId: "i", privateKeyPath: "p" });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setRetryPolicy({ baseDelayMs: 0 });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setRetryPolicy();
  vi.unstubAllGlobals();
});

describe("reads retry transient failures", () => {
  it("GET 500 then 200 succeeds", async () => {
    fetchMock.mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(json(200, { data: [] }));
    await expect(client.get("/v1/apps")).resolves.toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("GET 500 three times surfaces the error", async () => {
    fetchMock.mockImplementation(async () => json(500, { errors: [{ detail: "boom" }] }));
    await expect(client.get("/v1/apps")).rejects.toBeInstanceOf(ASCAPIError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    fetchMock.mockImplementation(async () => json(404, {}));
    await expect(client.get("/v1/apps/x")).rejects.toBeInstanceOf(ASCAPIError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a timed-out GET is retried", async () => {
    fetchMock.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(json(200, { data: [1] }));
    await expect(client.get("/v1/apps")).resolves.toEqual({ data: [1] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("every request carries a timeout signal", async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await client.get("/v1/apps");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("a later page of getAll retries too", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: [1], links: { next: "https://x/next" } }))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { data: [2] }));
    const r = await client.getAll("/v1/apps");
    expect(r.data).toEqual([1, 2]);
  });

  it("429 with a short Retry-After is retried, without one it surfaces", async () => {
    fetchMock.mockResolvedValueOnce(json(429, {}, { "retry-after": "0" })).mockResolvedValueOnce(json(200, { data: [] }));
    await expect(client.get("/v1/apps")).resolves.toEqual({ data: [] });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(429, {}));
    await expect(client.get("/v1/apps")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 with a Retry-After beyond the cap surfaces at once", async () => {
    fetchMock.mockImplementation(async () => json(429, {}, { "retry-after": "300" }));
    await expect(client.get("/v1/apps")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("writes are never retried", () => {
  it("POST 500 is sent once and surfaces", async () => {
    fetchMock.mockImplementation(async () => json(500, {}));
    await expect(client.post("/v1/bundleIds", {})).rejects.toBeInstanceOf(ASCAPIError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a timed-out write says it may or may not have applied, and says what to do", async () => {
    fetchMock.mockRejectedValue(timeoutError());
    const err = await client.patch("/v1/appStoreVersions/1", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ASCWriteTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.message).toMatch(/may or may not have been applied/);
    const reply = explainError(err);
    expect(reply).toMatch(/matching read tool/);
    expect(reply).toMatch(/\n\nNext: /);
  });
});
