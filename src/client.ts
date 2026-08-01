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
    const hint = friendlyHint(status, body);
    super(
      `ASC API error ${status} on ${path}: ${detail}` +
        (hint ? `\n\nWhat this usually means: ${hint}` : ""),
    );
    this.name = "ASCAPIError";
  }
}

/**
 * Translate Apple's terse HTTP errors into something a newcomer can act on.
 * Returns "" when the raw detail is already clear enough (e.g. validation 422s
 * carry their own message).
 */
function friendlyHint(status: number, body: string): string {
  switch (status) {
    case 401:
      return "Authentication failed. Your Issuer ID, Key ID, or .p8 likely don't match. Re-check the Issuer ID (UUID on the Integrations page) and that the .p8 matches the Key ID. Run `npx @pofky/asc-mcp doctor` to pinpoint it.";
    case 403:
      return "Your API key authenticated but lacks permission for this action. Its role is probably too low (needs App Manager or higher), or this specific capability (e.g. cloud signing, creating an app record) is not available to API keys at all. See `asc_guide topic:limitations`.";
    case 404:
      return "The resource wasn't found. Double-check the app_id / product_id (use `list_apps`), or the resource may not exist yet for this app.";
    case 409:
      // Apple overloads 409: STATE_ERROR really is a state conflict, but
      // ENTITY_ERROR.ATTRIBUTE.* is a rejected field value, and telling someone
      // to check the version state when Apple rejected their phone format sends
      // them the wrong way entirely.
      if (/ENTITY_ERROR\.ATTRIBUTE/.test(body)) {
        const field = body.match(/"pointer"\s*:\s*"\/data\/attributes\/(\w+)"/)?.[1];
        return (
          `Apple rejected the value${field ? ` for ${field}` : ""}, not the request. The detail above says what format it wants; fix that value and retry.`
        );
      }
      if (/ENTITY_ERROR\.RELATIONSHIP|ENTITY_ERROR\.ATTRIBUTE_REQUIRED|required/i.test(body) && !/STATE_ERROR/.test(body)) {
        return "Something the request needs is missing or points at the wrong resource. The detail above names it.";
      }
      return "State conflict: the version/product isn't in a state that allows this. For example, you can only edit/submit a version in PREPARE_FOR_SUBMISSION or a rejected state. Check current state with `app_details` or `review_status`.";
    case 429:
      return "Rate limited by Apple. Wait a minute and retry.";
    default:
      if (status >= 500) return "App Store Connect had a server-side error. This is on Apple's end; retry shortly.";
      return "";
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
