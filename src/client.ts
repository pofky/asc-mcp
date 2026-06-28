import { getToken } from "./auth.js";
import type { ASCConfig, ASCResponse } from "./types.js";

const BASE_URL = "https://api.appstoreconnect.apple.com";

/**
 * Low-level App Store Connect API client.
 * Handles authentication, pagination, and error mapping.
 */
export class ASCClient {
  constructor(private config: ASCConfig) {}

  /** Make an authenticated GET request to the ASC API. */
  async get<T>(path: string, params?: Record<string, string>): Promise<ASCResponse<T>> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const token = await getToken(
      this.config.keyId,
      this.config.issuerId,
      this.config.privateKeyPath,
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ASCAPIError(response.status, path, body);
    }

    return (await response.json()) as ASCResponse<T>;
  }

  /** Make an authenticated write request (POST/PATCH/DELETE) to the ASC API. */
  async write<T>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<ASCResponse<T> | null> {
    const token = await getToken(
      this.config.keyId,
      this.config.issuerId,
      this.config.privateKeyPath,
    );

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new ASCAPIError(response.status, path, errBody);
    }

    // 204 No Content (typical for DELETE / some PATCH) has no JSON body.
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as ASCResponse<T>;
  }

  post<T>(path: string, body: unknown) {
    return this.write<T>("POST", path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.write<T>("PATCH", path, body);
  }
  del<T>(path: string) {
    return this.write<T>("DELETE", path);
  }

  /** Fetch all pages of a paginated response. */
  async getAll<T>(path: string, params?: Record<string, string>, maxPages = 10): Promise<ASCResponse<T>> {
    const firstPage = await this.get<T>(path, params);

    if (!Array.isArray(firstPage.data)) {
      return firstPage;
    }

    const allData = [...firstPage.data];
    let nextUrl = firstPage.links?.next;
    let page = 1;

    while (nextUrl && page < maxPages) {
      const token = await getToken(
        this.config.keyId,
        this.config.issuerId,
        this.config.privateKeyPath,
      );

      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) break;

      const pageData = (await response.json()) as ASCResponse<T>;
      if (Array.isArray(pageData.data)) {
        allData.push(...pageData.data);
      }
      nextUrl = pageData.links?.next;
      page++;
    }

    return { ...firstPage, data: allData };
  }

  /**
   * Download a sales/trends report (returns TSV, not JSON).
   * Apple's reporting endpoints return gzipped TSV.
   */
  async getReport(params: Record<string, string>): Promise<string> {
    const url = new URL(`${BASE_URL}/v1/salesReports`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`filter[${key}]`, value);
    }

    const token = await getToken(
      this.config.keyId,
      this.config.issuerId,
      this.config.privateKeyPath,
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/a-gzip",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return "No report available for the requested date range.";
      }
      const body = await response.text();
      throw new ASCAPIError(response.status, "/v1/salesReports", body);
    }

    // Response is gzipped TSV
    const buffer = await response.arrayBuffer();
    const { gunzipSync } = await import("node:zlib");
    const decompressed = gunzipSync(Buffer.from(buffer));
    return decompressed.toString("utf-8");
  }
}

export class ASCAPIError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    const detail = tryParseErrorDetail(body);
    super(`ASC API error ${status} on ${path}: ${detail}`);
    this.name = "ASCAPIError";
  }
}

function tryParseErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed.errors?.[0]?.detail) {
      return parsed.errors[0].detail;
    }
    if (parsed.errors?.[0]?.title) {
      return parsed.errors[0].title;
    }
  } catch {
    // Not JSON
  }
  return body.slice(0, 200);
}
