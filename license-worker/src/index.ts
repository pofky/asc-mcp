/**
 * License validation CF Worker for ASC MCP (@pofky/asc-mcp).
 *
 * Endpoints:
 *   POST /validate       - check a license key, return tier
 *   POST /webhook/polar  - Polar subscription webhook (create/cancel keys)
 *   GET  /health         - liveness check
 *   GET  /success        - post-checkout redirect
 *   GET  /key            - key retrieval form
 *   POST /key            - key lookup by email (rate-limited)
 */

interface Env {
  DB: D1Database;
  POLAR_WEBHOOK_SECRET: string;
  // Optional: Brevo transactional email. If BREVO_API_KEY is unset, the worker
  // simply skips emailing the key (self-service /key still works).
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  // Guards POST /admin/provision (manual activation + re-email).
  ADMIN_TOKEN?: string;
}

interface ValidateRequest {
  key: string;
}

// Simple in-memory rate limiter for /key lookups (per worker instance)
const keyLookupAttempts = new Map<string, { count: number; resetAt: number }>();
const KEY_LOOKUP_MAX = 5;
const KEY_LOOKUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS: only allow same-origin for HTML pages, open for /validate (MCP server calls it)
    const origin = request.headers.get("Origin") || "";
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Only /validate and /health need open CORS (called from local MCP server process)
    // HTML pages (/key, /success) are same-origin form submissions - no CORS needed
    if (url.pathname === "/validate" || url.pathname === "/health") {
      corsHeaders["Access-Control-Allow-Origin"] = "*";
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, ts: new Date().toISOString() }, corsHeaders);
      }

      if (url.pathname === "/validate" && request.method === "POST") {
        return await handleValidate(request, env, corsHeaders);
      }

      if (url.pathname === "/webhook/polar" && request.method === "POST") {
        return await handlePolarWebhook(request, env, corsHeaders);
      }

      if (url.pathname === "/admin/provision" && request.method === "POST") {
        return await handleAdminProvision(request, env, corsHeaders);
      }

      if (url.pathname === "/success") {
        return handleSuccess(corsHeaders);
      }

      if (url.pathname === "/key" && request.method === "GET") {
        return handleKeyPage(corsHeaders);
      }

      if (url.pathname === "/key" && request.method === "POST") {
        return await handleKeyLookup(request, env, corsHeaders);
      }

      if (url.pathname === "/privacy") {
        return handlePrivacy(corsHeaders);
      }

      if (url.pathname === "/terms") {
        return handleTerms(corsHeaders);
      }

      if (url.pathname === "/delete" && request.method === "POST") {
        return await handleDeleteRequest(request, env, corsHeaders);
      }

      if (url.pathname === "/delete" && request.method === "GET") {
        return handleDeletePage(corsHeaders);
      }

      return json({ error: "Not found" }, corsHeaders, 404);
    } catch (err) {
      console.error("Worker error");
      return json({ error: "Internal error" }, corsHeaders, 500);
    }
  },
};

async function handleValidate(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const body = (await request.json()) as ValidateRequest;

  if (!body.key || typeof body.key !== "string") {
    return json({ valid: false, tier: "free" }, headers, 400);
  }

  const row = await env.DB.prepare(
    "SELECT tier, expires_at, active FROM licenses WHERE key = ?",
  )
    .bind(body.key)
    .first<{ tier: string; expires_at: string | null; active: number }>();

  if (!row || !row.active) {
    return json({ valid: false, tier: "free" }, headers);
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return json({ valid: false, tier: "free", reason: "expired" }, headers);
  }

  return json(
    { valid: true, tier: row.tier, expires: row.expires_at },
    headers,
  );
}

const ACTIVE_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
]);
const CANCEL_EVENTS = new Set([
  "subscription.canceled",
  "subscription.revoked",
]);
// Statuses that mean the subscription is NOT usable even though an
// active-type event fired. Anything else (active, trialing, past_due,
// incomplete, or absent) is treated as active so a paying customer is
// never left without a key.
const DEAD_STATUSES = new Set([
  "canceled",
  "revoked",
  "incomplete_expired",
  "unpaid",
]);

/**
 * Decide whether a subscription should be active given the status on an
 * active-type Polar event. Exported for regression tests: this is the exact
 * logic that twice left paying customers at active=0. Anything that is not a
 * known-dead status (including an absent status, "active", "trialing",
 * "past_due", "incomplete") activates the license.
 */
export function computeActiveFlag(status?: string): 0 | 1 {
  return status && DEAD_STATUSES.has(status) ? 0 : 1;
}

export function classifyPolarEvent(
  type: string,
): "activate" | "cancel" | "ignore" {
  if (ACTIVE_EVENTS.has(type)) return "activate";
  if (CANCEL_EVENTS.has(type)) return "cancel";
  return "ignore";
}

async function handlePolarWebhook(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const rawBody = await request.text();

  const verified = await verifyPolarSignature(
    request.headers,
    rawBody,
    env.POLAR_WEBHOOK_SECRET,
  );
  if (!verified) {
    return json({ error: "Invalid signature" }, headers, 401);
  }

  const event = JSON.parse(rawBody) as {
    type: string;
    data: {
      id: string;
      status?: string;
      current_period_end?: string;
      customer?: { email?: string };
    };
  };

  console.log("polar webhook", event.type, "status:", event.data?.status);

  if (ACTIVE_EVENTS.has(event.type)) {
    const sub = event.data;
    const email = sub.customer?.email || "";
    const expiresAt = sub.current_period_end || null;
    // active=1 unless Polar reports a genuinely dead status. Earlier this
    // required status to be exactly "active"/"trialing", which left real
    // paying customers at active=0 (e.g. status "incomplete" while payment
    // settled), silently suppressing the license email too.
    const active = computeActiveFlag(sub.status);
    const licenseKey = generateLicenseKey();

    await env.DB.prepare(
      `INSERT INTO licenses (key, tier, email, polar_subscription_id, expires_at, active, created_at)
       VALUES (?, 'pro', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(polar_subscription_id) DO UPDATE SET
         email = excluded.email,
         expires_at = excluded.expires_at,
         active = excluded.active`,
    )
      .bind(licenseKey, email, sub.id, expiresAt, active)
      .run();

    // Email the key once, the first time the row is active. The key_emailed
    // flag makes this idempotent across created/active/updated retries.
    if (active && email) {
      const row = await env.DB.prepare(
        "SELECT key, key_emailed FROM licenses WHERE polar_subscription_id = ?",
      )
        .bind(sub.id)
        .first<{ key: string; key_emailed: number }>();

      if (row && !row.key_emailed) {
        const sent = await sendLicenseEmail(env, email, row.key);
        if (sent) {
          await env.DB.prepare(
            "UPDATE licenses SET key_emailed = 1 WHERE polar_subscription_id = ?",
          )
            .bind(sub.id)
            .run();
        }
      }
    }

    // Don't leak the license key in the response
    return json({ ok: true }, headers);
  }

  if (CANCEL_EVENTS.has(event.type)) {
    await env.DB.prepare(
      "UPDATE licenses SET active = 0 WHERE polar_subscription_id = ?",
    )
      .bind(event.data.id)
      .run();

    return json({ ok: true }, headers);
  }

  return json({ ok: true }, headers);
}

/**
 * Manual provisioning / re-email for an existing subscription, guarded by the
 * Polar webhook secret. Used to recover customers whose webhook landed before
 * the activation logic was correct. Activates the row and emails the key once.
 */
async function handleAdminProvision(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const auth = request.headers.get("x-admin-secret") || "";
  if (!env.ADMIN_TOKEN || auth !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, headers, 401);
  }

  const body = (await request.json()) as { subscription_id?: string };
  if (!body.subscription_id) {
    return json({ error: "subscription_id required" }, headers, 400);
  }

  const row = await env.DB.prepare(
    "SELECT key, email, key_emailed FROM licenses WHERE polar_subscription_id = ?",
  )
    .bind(body.subscription_id)
    .first<{ key: string; email: string | null; key_emailed: number }>();

  if (!row) {
    return json({ error: "Not found" }, headers, 404);
  }

  await env.DB.prepare(
    "UPDATE licenses SET active = 1 WHERE polar_subscription_id = ?",
  )
    .bind(body.subscription_id)
    .run();

  let emailed = Boolean(row.key_emailed);
  if (!emailed && row.email) {
    const sent = await sendLicenseEmail(env, row.email, row.key);
    if (sent) {
      await env.DB.prepare(
        "UPDATE licenses SET key_emailed = 1 WHERE polar_subscription_id = ?",
      )
        .bind(body.subscription_id)
        .run();
      emailed = true;
    }
  }

  return json({ ok: true, active: 1, emailed, email: row.email }, headers);
}

/**
 * Email a buyer their license key via Brevo's transactional API.
 * Returns true on success. No-ops (returns false) if BREVO_API_KEY is unset,
 * so the worker is safe to deploy before email is configured.
 */
async function sendLicenseEmail(
  env: Env,
  email: string,
  key: string,
): Promise<boolean> {
  if (!env.BREVO_API_KEY) return false;

  const senderEmail = env.BREVO_SENDER_EMAIL || "license@brewist.app";
  const senderName = env.BREVO_SENDER_NAME || "App Store Connect MCP";
  const safeKey = escapeHtml(key);

  const htmlContent = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
      <h1 style="font-size:20px">Your App Store Connect MCP Pro license</h1>
      <p>Thanks for subscribing. Here is your license key:</p>
      <div style="background:#f4f4fb;border:1px solid #ddd;border-radius:8px;padding:16px;font-family:monospace;font-size:18px;letter-spacing:1px;text-align:center">${safeKey}</div>
      <p>Add it to your MCP server config alongside your App Store Connect credentials:</p>
      <pre style="background:#f4f4fb;border-radius:8px;padding:14px;overflow-x:auto;font-size:13px">"ASC_LICENSE_KEY": "${safeKey}"</pre>
      <p><strong>Next step:</strong> save your config and restart your agent (Claude Code, Cursor, Windsurf, etc.), then ask it to "list my App Store Connect apps" to confirm Pro is active.</p>
      <p style="color:#666;font-size:14px">You can also retrieve this key any time at <a href="https://asc-mcp-license.remewdy.workers.dev/key">the license page</a>. Keep it private; it unlocks Pro tools on your machine.</p>
      <p style="color:#666;font-size:14px">Questions or trouble? Just reply to this email.</p>
    </div>`;

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email }],
        subject: "Your App Store Connect MCP Pro license key",
        htmlContent,
      }),
    });
    if (!res.ok) {
      console.error("Brevo send failed", res.status);
      return false;
    }
    return true;
  } catch {
    console.error("Brevo send error");
    return false;
  }
}

/**
 * Verify a Polar webhook using the Standard Webhooks spec
 * (https://www.standardwebhooks.com). Polar signs `${id}.${timestamp}.${body}`
 * with HMAC-SHA256 using the base64 secret (whsec_ prefix), and sends the
 * result base64-encoded as space-delimited `v1,<sig>` entries.
 */
async function verifyPolarSignature(
  reqHeaders: Headers,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const id = reqHeaders.get("webhook-id");
  const timestamp = reqHeaders.get("webhook-timestamp");
  const sigHeader = reqHeaders.get("webhook-signature");
  if (!id || !timestamp || !sigHeader || !secret) return false;

  // Replay protection: reject timestamps more than 5 minutes from now.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > 300) return false;

  // Polar's validateEvent base64-encodes the secret string then hands it to the
  // Standard Webhooks lib, which base64-decodes it back -- so the HMAC key is
  // simply the raw UTF-8 bytes of the full secret (e.g. "polar_whs_...").
  const secretBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  // Header may carry multiple space-delimited signatures (key rotation).
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && sig != null && timingSafeEqual(sig, expected);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function generateLicenseKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const segments = 4;
  const segLen = 5;
  const parts: string[] = [];
  const bytes = new Uint8Array(segments * segLen);
  crypto.getRandomValues(bytes);

  for (let s = 0; s < segments; s++) {
    let part = "";
    for (let i = 0; i < segLen; i++) {
      part += chars[bytes[s * segLen + i] % chars.length];
    }
    parts.push(part);
  }
  return `ASC-${parts.join("-")}`;
}

function handleSuccess(headers: Record<string, string>): Response {
  return html(`
    <h1>Thanks for subscribing!</h1>
    <p>Your Pro license is ready. Enter the email you used at checkout to retrieve your license key:</p>
    <form method="POST" action="/key">
      <input type="email" name="email" placeholder="you@example.com" required
        style="padding:10px;font-size:16px;width:300px;border:1px solid #555;border-radius:6px;background:#1a1a2e;color:#fff">
      <button type="submit"
        style="padding:10px 20px;font-size:16px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:8px">
        Get License Key
      </button>
    </form>
  `, headers);
}

function handleKeyPage(headers: Record<string, string>): Response {
  return html(`
    <h1>Retrieve Your License Key</h1>
    <p>Enter the email you used when purchasing App Store Connect MCP Pro:</p>
    <form method="POST" action="/key">
      <input type="email" name="email" placeholder="you@example.com" required
        style="padding:10px;font-size:16px;width:300px;border:1px solid #555;border-radius:6px;background:#1a1a2e;color:#fff">
      <button type="submit"
        style="padding:10px 20px;font-size:16px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:8px">
        Look Up Key
      </button>
    </form>
  `, headers);
}

async function handleKeyLookup(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  // Rate limit by IP
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const entry = keyLookupAttempts.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= KEY_LOOKUP_MAX) {
      return html(
        "<h1>Too many attempts</h1><p>Please wait 15 minutes before trying again.</p>",
        headers,
        429,
      );
    }
    entry.count++;
  } else {
    keyLookupAttempts.set(ip, { count: 1, resetAt: now + KEY_LOOKUP_WINDOW_MS });
  }

  const formData = await request.formData();
  const email = formData.get("email") as string;

  if (!email) {
    return html("<h1>Email required</h1><p><a href='/key'>Try again</a></p>", headers, 400);
  }

  const row = await env.DB.prepare(
    "SELECT key, tier, active FROM licenses WHERE email = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email)
    .first<{ key: string; tier: string; active: number }>();

  if (!row) {
    return html(`
      <h1>No active license found</h1>
      <p>No active Pro license found for <strong>${escapeHtml(email)}</strong>.</p>
      <p>If you just purchased, it may take a minute for the webhook to process. <a href="/key">Try again</a>.</p>
      <p>Still nothing after a few minutes? Email <a href="mailto:povkonop@gmail.com?subject=ASC%20MCP%20Pro%20license">povkonop@gmail.com</a> with the email you checked out with and we will sort it out quickly.</p>
      <p>Need to subscribe? <a href="https://buy.polar.sh/polar_cl_Ta3OxEA1EbRyYNPFtSsRXgYWBCCtjwMxlbAeW35RLuu">Get Pro</a></p>
    `, headers);
  }

  return html(`
    <h1>Your License Key</h1>
    <div style="background:#1a1a2e;padding:20px;border-radius:8px;border:1px solid #333;margin:20px 0;font-family:monospace;font-size:20px;letter-spacing:2px;text-align:center">
      ${escapeHtml(row.key)}
    </div>
    <p>Add this to your MCP server configuration:</p>
    <pre style="background:#1a1a2e;padding:15px;border-radius:8px;overflow-x:auto">"ASC_LICENSE_KEY": "${escapeHtml(row.key)}"</pre>
    <p><strong>Next step:</strong> save your config and restart your agent (Claude Code, Cursor, Windsurf, etc.) so it reloads with the key. Then ask it to "list my App Store Connect apps" to confirm Pro is active.</p>
    <p style="color:#888;font-size:14px">Keep this key private. It unlocks Pro tools on your machine.</p>
  `, headers);
}

function handlePrivacy(headers: Record<string, string>): Response {
  return html(`
    <h1>Privacy Policy</h1>
    <p><em>Last updated: April 13, 2026</em></p>

    <h2>What we collect</h2>
    <p>When you purchase a Pro license, we store:</p>
    <ul>
      <li>Your email address (from the checkout provider)</li>
      <li>A generated license key</li>
      <li>Your subscription ID (for managing renewals and cancellations)</li>
    </ul>
    <p>When you use the free MCP server, we store nothing. The server runs locally on your machine.</p>

    <h2>What we don't collect</h2>
    <ul>
      <li>Your Apple API credentials (.p8 key, Key ID, Issuer ID) never leave your machine</li>
      <li>No App Store Connect data passes through our servers</li>
      <li>No analytics, telemetry, or tracking</li>
      <li>No cookies</li>
    </ul>

    <h2>How your data flows</h2>
    <p>The MCP server runs locally. It talks directly to Apple's API from your computer. The only network call to our infrastructure is a single license key validation check on startup, which sends only the license key string.</p>

    <h2>Data storage</h2>
    <p>License data is stored on Cloudflare D1 (EU region). Cloudflare acts as our infrastructure provider under their <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">Data Processing Agreement</a>.</p>

    <h2>Payment processing</h2>
    <p>Payments are handled by <a href="https://polar.sh">Polar.sh</a>, who acts as Merchant of Record. We never see your credit card details. Polar's privacy policy applies to the checkout process.</p>

    <h2>Data retention</h2>
    <p>Active subscription data is kept while your subscription is active. After cancellation, your email and license data are deleted within 90 days.</p>

    <h2>Your rights (GDPR)</h2>
    <p>You can request access to, correction of, or deletion of your personal data at any time. To delete your data, visit <a href="/delete">/delete</a> or email us.</p>

    <h2>Contact</h2>
    <p>For privacy questions: povkonop@gmail.com</p>

    <p style="color:#888;font-size:13px;margin-top:40px">This project is not affiliated with, endorsed by, or sponsored by Apple Inc. Apple, App Store, App Store Connect, TestFlight, iOS, and macOS are trademarks of Apple Inc.</p>
  `, headers);
}

function handleTerms(headers: Record<string, string>): Response {
  return html(`
    <h1>Terms of Service</h1>
    <p><em>Last updated: April 13, 2026</em></p>

    <h2>What this is</h2>
    <p>App Store Connect MCP Server is a developer tool that connects AI coding agents to Apple's App Store Connect API. It runs locally on your machine.</p>

    <h2>Requirements</h2>
    <ul>
      <li>A valid Apple Developer Program membership</li>
      <li>An App Store Connect API key that you create and control</li>
      <li>Compliance with Apple's Developer Program License Agreement</li>
    </ul>

    <h2>Free and Pro tiers</h2>
    <p>Three tools are free with no account needed. Pro tools (customer reviews, sales reports) require a $9/month subscription managed through <a href="https://polar.sh">Polar.sh</a>.</p>

    <h2>Subscriptions</h2>
    <p>Pro subscriptions are billed monthly through Polar. You can cancel anytime through Polar's subscription management. Polar's terms of service apply to the payment process.</p>

    <h2>No warranty</h2>
    <p>This tool is provided as-is. We make no guarantees about uptime of the license validation server, accuracy of data from Apple's API, or compatibility with future API changes. You are responsible for verifying any data before acting on it.</p>

    <h2>Limitation of liability</h2>
    <p>To the maximum extent permitted by law, total liability is limited to the amount you paid in the 3 months before the event giving rise to the claim.</p>

    <h2>Your responsibilities</h2>
    <ul>
      <li>Keep your Apple API credentials (.p8 file) secure</li>
      <li>Keep your license key private</li>
      <li>Comply with Apple's terms when using data from their API</li>
    </ul>

    <h2>Changes</h2>
    <p>We may update these terms with reasonable notice. Continued use after changes constitutes acceptance.</p>

    <h2>Contact</h2>
    <p>Questions: povkonop@gmail.com</p>

    <p style="color:#888;font-size:13px;margin-top:40px">This project is not affiliated with, endorsed by, or sponsored by Apple Inc. Apple, App Store, App Store Connect, TestFlight, iOS, and macOS are trademarks of Apple Inc.</p>
  `, headers);
}

function handleDeletePage(headers: Record<string, string>): Response {
  return html(`
    <h1>Delete Your Data</h1>
    <p>Enter the email associated with your license to delete all your data from our systems.</p>
    <form method="POST" action="/delete">
      <input type="email" name="email" placeholder="you@example.com" required
        style="padding:10px;font-size:16px;width:300px;border:1px solid #555;border-radius:6px;background:#1a1a2e;color:#fff">
      <button type="submit"
        style="padding:10px 20px;font-size:16px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:8px">
        Delete My Data
      </button>
    </form>
    <p style="color:#888;font-size:13px;margin-top:20px">This will permanently delete your email and license key from our database. Your subscription (if active) should be canceled separately through Polar.</p>
  `, headers);
}

async function handleDeleteRequest(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const formData = await request.formData();
  const email = formData.get("email") as string;

  if (!email) {
    return html("<h1>Email required</h1><p><a href='/delete'>Try again</a></p>", headers, 400);
  }

  await env.DB.prepare("DELETE FROM licenses WHERE email = ?").bind(email).run();

  return html(`
    <h1>Data Deleted</h1>
    <p>All license data associated with <strong>${escapeHtml(email)}</strong> has been removed from our systems.</p>
    <p>If you have an active Polar subscription, please cancel it separately at <a href="https://polar.sh">polar.sh</a>.</p>
  `, headers);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(body: string, extraHeaders: Record<string, string>, status = 200): Response {
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Store Connect MCP</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;background:#0d0d1a;color:#e0e0e0}
a{color:#818cf8}h1{color:#fff}pre{color:#a5b4fc}</style></head><body>${body}</body></html>`;
  return new Response(page, {
    status,
    headers: { "Content-Type": "text/html;charset=utf-8", ...extraHeaders },
  });
}

function json(
  data: unknown,
  extraHeaders: Record<string, string>,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
