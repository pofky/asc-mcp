/**
 * License validation CF Worker for ASC MCP (@pofky/asc-mcp).
 *
 * Endpoints:
 *   POST /validate       - check a license key, return tier
 *   POST /webhook/polar  - Polar subscription webhook (create/cancel keys)
 *   POST /trial          - mint a 7-day Pro trial (in-agent, no card)
 *   GET  /go             - counted redirect to checkout (buy-intent attribution)
 *   GET  /health         - liveness check
 *   GET  /success        - post-checkout redirect
 *   GET  /key            - key retrieval form
 *   POST /key            - key lookup by email (rate-limited)
 *   GET  /admin/stats    - intent + trial funnel (ADMIN_TOKEN)
 *   POST /delete         - request deletion; emails a signed confirmation link
 *   GET  /delete/confirm - the signed link; this is what actually deletes
 */

import {
  CHECKOUT_URL,
  TRIAL_DAYS,
  isValidToolName,
  isValidFingerprint,
  isValidEmail,
  trialExpiry,
  daysRemaining,
  buildCheckoutUrl,
  isLicenseUsable,
  computeActiveFlag,
  shouldBeActive,
  classifyPolarEvent,
  webhookSecrets,
  resolveProductId,
  isOwnProduct,
  ACTIVE_EVENTS,
  CANCEL_EVENTS,
  IMMEDIATE_REVOKE_EVENTS,
  verifyPolarSignature,
  candidateKeys,
  pickLookupRow,
  timingSafeEqual,
  signDeleteToken,
  verifyDeleteToken,
  DELETE_TOKEN_TTL_MS,
  type LookupRow,
} from "./logic.js";


interface Env {
  DB: D1Database;
  POLAR_WEBHOOK_SECRET: string;
  // Second Polar organization's webhook signing secret. Set during the move to
  // a dedicated org, when the old org still delivers renewals and
  // cancellations for the grandfathered subscriptions. Unset otherwise.
  POLAR_WEBHOOK_SECRET_2?: string;
  // Polar's sandbox instance, for verifying the checkout -> webhook -> email ->
  // validate chain with a test card against this exact deployed code. Temporary
  // by design: DELETE IT once a verification run is finished, so a sandbox
  // signature can never mint a real licence.
  POLAR_WEBHOOK_SECRET_SANDBOX?: string;
  // Extra asc-mcp product ids beyond the two built in, comma-separated. Used to
  // admit the sandbox mirror product during a verification run.
  POLAR_EXTRA_PRODUCT_IDS?: string;
  // Optional: Brevo transactional email. If BREVO_API_KEY is unset, the worker
  // simply skips emailing the key (self-service /key still works).
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  // Guards POST /admin/provision (manual activation + re-email).
  ADMIN_TOKEN?: string;
  // Guards POST /admin/announce (product announcement to an existing customer).
  ANNOUNCE_TOKEN?: string;
  // Signs the emailed confirmation link for GDPR deletion. Falls back to
  // ADMIN_TOKEN; with neither, /delete refuses instead of deleting unverified.
  DELETE_SECRET?: string;
}

interface ValidateRequest {
  key: string;
}

// Simple in-memory rate limiter, per worker instance. Shared by /key lookups and
// /trial. Not a hard guarantee across instances; the real anti-abuse guarantee
// for trials is the unique index on the Apple-account fingerprint.
const keyLookupAttempts = new Map<string, { count: number; resetAt: number }>();
const KEY_LOOKUP_MAX = 5;
const KEY_LOOKUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A trial request gets a larger allowance than a key lookup. Retrying a trial is
 * a normal thing for an agent to do (the user mistypes an address, the first
 * call raced a restart), and the real guarantee against repeat trials is the
 * unique index on the Apple-account fingerprint, not this counter. Locking
 * someone out of starting a trial for fifteen minutes is a lost customer; five
 * extra rows in a Map is nothing.
 */
const TRIAL_MAX = 10;

/** Returns false when this IP has exhausted its allowance for `scope`. */
function rateLimit(request: Request, scope: string): boolean {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = `${scope}:${ip}`;
  const max = scope === "trial" ? TRIAL_MAX : KEY_LOOKUP_MAX;
  const now = Date.now();
  const entry = keyLookupAttempts.get(bucket);

  if (entry && now < entry.resetAt) {
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  }
  keyLookupAttempts.set(bucket, { count: 1, resetAt: now + KEY_LOOKUP_WINDOW_MS });
  return true;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS: only allow same-origin for HTML pages, open for /validate (MCP server calls it)
    const origin = request.headers.get("Origin") || "";
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Only /validate and /health need open CORS (called from local MCP server process)
    // HTML pages (/key, /success) are same-origin form submissions - no CORS needed
    //
    // /trial is deliberately NOT here. It is called by a Node process on the
    // user's machine, which has no origin and needs no CORS header at all.
    // Granting the wildcard only enabled one thing: any web page a user visits
    // silently POSTing a trial request in their browser, charged to their IP.
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

      if (url.pathname === "/trial" && request.method === "POST") {
        return await handleTrial(request, env, corsHeaders);
      }

      if (url.pathname === "/go") {
        return handleGo(url, ctx, env);
      }

      if (url.pathname === "/admin/stats" && request.method === "GET") {
        return await handleAdminStats(request, env, corsHeaders);
      }

      if (url.pathname === "/admin/provision" && request.method === "POST") {
        return await handleAdminProvision(request, env, corsHeaders);
      }

      if (url.pathname === "/admin/announce" && request.method === "POST") {
        return await handleAdminAnnounce(request, env, corsHeaders);
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

      if (url.pathname === "/delete/confirm" && request.method === "GET") {
        return await handleDeleteConfirm(url, env, corsHeaders);
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
  let body: ValidateRequest;
  try {
    body = (await request.json()) as ValidateRequest;
  } catch {
    // Otherwise this falls to the catch-all as a 500, which reads as "our
    // licence server is down" to anyone debugging their setup.
    return json({ valid: false, tier: "free", error: "bad_request" }, headers, 400);
  }

  if (!body.key || typeof body.key !== "string") {
    return json({ valid: false, tier: "free" }, headers, 400);
  }

  type ValidateRow = {
    tier: string;
    expires_at: string | null;
    active: number;
    source: string | null;
    canceled_at: string | null;
  };

  // `source` and `canceled_at` are post-launch columns. If this build ever reaches production
  // ahead of the migration, selecting it throws "no such column", the outer
  // handler turns that into a 500, and the client treats a 500 as "not valid"
  // and drops to the free tier. That is every paying customer silently losing
  // access because of a deploy ordering mistake. One fallback query is a cheap
  // price for making that impossible.
  let row: ValidateRow | null;
  try {
    row = await env.DB.prepare(
      "SELECT tier, expires_at, active, source, canceled_at FROM licenses WHERE key = ?",
    )
      .bind(body.key)
      .first<ValidateRow>();
  } catch {
    console.error("validate: falling back to pre-migration columns");
    const legacy = await env.DB.prepare(
      "SELECT tier, expires_at, active FROM licenses WHERE key = ?",
    )
      .bind(body.key)
      .first<Omit<ValidateRow, "source" | "canceled_at">>();
    row = legacy ? { ...legacy, source: null, canceled_at: null } : null;
  }

  if (!row) {
    return json({ valid: false, tier: "free" }, headers);
  }

  const verdict = isLicenseUsable(row, new Date());
  if (!verdict.usable) {
    return json({ valid: false, tier: "free", reason: verdict.reason }, headers);
  }

  return json(
    {
      valid: true,
      tier: row.tier,
      expires: row.expires_at,
      ...(row.source === "trial" ? { trial: true } : {}),
      ...(verdict.grace ? { grace: true } : {}),
    },
    headers,
  );
}







/** Sandbox or future product ids, comma-separated. Empty in a normal prod run. */
function extraProductIds(env: Env): string[] {
  return (env.POLAR_EXTRA_PRODUCT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    webhookSecrets(env),
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

  if (!isOwnProduct(event.data as unknown as Record<string, unknown>, extraProductIds(env))) {
    console.log("ignoring event for another product in this organization");
    return json({ ok: true, note: "not an asc-mcp product" }, headers);
  }

  if (ACTIVE_EVENTS.has(event.type)) {
    const sub = event.data;
    const email = sub.customer?.email || "";
    const expiresAt = sub.current_period_end || null;
    // active=1 unless Polar reports a genuinely dead status. Earlier this
    // required status to be exactly "active"/"trialing", which left real
    // paying customers at active=0 (e.g. status "incomplete" while payment
    // settled), silently suppressing the license email too.
    const active = shouldBeActive(sub.status, expiresAt, new Date());
    const licenseKey = generateLicenseKey();

    // An explicit reinstatement clears the "renewal is off" mark; nothing else
    // does, so a stray `updated` cannot quietly restore the grace window on a
    // subscription the customer has already cancelled.
    const reinstates =
      event.type === "subscription.uncanceled" || event.type === "subscription.resumed";

    // `WHERE revoked_at IS NULL` is the whole P0 fix. Polar retries deliveries
    // and does not guarantee ordering, so a `subscription.updated` carrying the
    // pre-cancellation status ("active", period end in the future) could arrive
    // after `subscription.revoked` and overwrite active=0 back to 1: someone
    // whose access had been revoked got a working key again. Revocation is
    // recorded on the row and is terminal for that subscription id. A customer
    // who genuinely comes back gets a new Polar subscription, so a new row and a
    // new key; reviving a revoked id is a support action, not an automatic one.
    await env.DB.prepare(
      `INSERT INTO licenses (key, tier, email, polar_subscription_id, expires_at, active, created_at)
       VALUES (?, 'pro', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(polar_subscription_id) DO UPDATE SET
         email = excluded.email,
         expires_at = excluded.expires_at,
         active = excluded.active,
         canceled_at = CASE WHEN ? = 1 THEN NULL ELSE canceled_at END
       WHERE revoked_at IS NULL`,
    )
      .bind(licenseKey, email, sub.id, expiresAt, active, reinstates ? 1 : 0)
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
    if (IMMEDIATE_REVOKE_EVENTS.has(event.type)) {
      // Stamp the revocation as well as switching the row off. The timestamp is
      // what makes it stick against a later replay of an active-type event.
      await env.DB.prepare(
        `UPDATE licenses
            SET active = 0,
                revoked_at = COALESCE(revoked_at, datetime('now'))
          WHERE polar_subscription_id = ?`,
      )
        .bind(event.data.id)
        .run();
      return json({ ok: true }, headers);
    }

    // Scheduled cancellation: leave the licence usable and let the paid period
    // run out. Refresh the expiry if Polar sent one, so it ends exactly when
    // the customer's paid time does.
    //
    // canceled_at is also stamped, which switches off the late-renewal grace
    // window for this row (see isLicenseUsable). Grace exists for a renewal
    // webhook that is late; once renewal is off there is no renewal coming, and
    // handing every cancelling customer four extra free days was pure leakage.
    const endsAt = event.data.current_period_end || null;
    await env.DB.prepare(
      `UPDATE licenses
          SET canceled_at = COALESCE(canceled_at, datetime('now')),
              expires_at = COALESCE(?, expires_at)
        WHERE polar_subscription_id = ?`,
    )
      .bind(endsAt, event.data.id)
      .run();

    return json({ ok: true, note: "cancellation scheduled, access kept until period end" }, headers);
  }

  return json({ ok: true }, headers);
}

/**
 * Bump a daily aggregate counter. Stores a day bucket, a kind and a tool name,
 * and nothing else: no IP, no user agent, no identifier. Failures are swallowed
 * because a analytics write must never be able to break a buy link.
 */
async function recordIntent(env: Env, kind: string, tool: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO intent_events (day, kind, tool, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, kind, tool) DO UPDATE SET count = count + 1`,
    )
      .bind(day, kind, tool)
      .run();
  } catch {
    console.error("intent write failed");
  }
}

/**
 * Counted redirect to checkout. This is the only demand signal we collect, and
 * it is collected from a link the user deliberately opened, not from a beacon
 * inside the MCP process. See the privacy note in PRD-0001.
 *
 * The redirect target is the CHECKOUT_URL constant with validated parameters
 * appended, so no input reaches the Location header.
 */
function handleGo(url: URL, ctx: ExecutionContext, env: Env): Response {
  const raw = url.searchParams.get("tool");
  const tool = isValidToolName(raw) ? raw : "unknown";
  // Counting must not add latency to, or be able to fail, the path to payment.
  ctx.waitUntil(recordIntent(env, "checkout_click", tool));
  return Response.redirect(
    buildCheckoutUrl(tool === "unknown" ? undefined : tool),
    302,
  );
}

interface TrialRequest {
  fingerprint?: string;
  email?: string;
  tool?: string;
}

/**
 * The single refusal, used for every reason a trial cannot start.
 *
 * Branching the message told an unauthenticated caller whether a given email
 * belonged to a paying subscriber, which with a handful of customers is a
 * meaningful disclosure. One message covers all of it and still tells a real
 * user the two things they can do.
 */
function trialRefused(email: string) {
  return {
    error: "trial_unavailable",
    message:
      `No new trial is available for ${email}. If you already have Pro, get your key at ` +
      "https://asc-mcp-license.remewdy.workers.dev/key , using the address you checked out with " +
      "if that is a different one. If your trial has ended, Pro is $9/month.",
    checkout_url: buildCheckoutUrl("trial_unavailable", email),
  };
}

/**
 * Ceiling on trials created in one UTC day.
 *
 * Every trial sends mail through Brevo, whose free tier is 300 a day, and the
 * per-IP limiter lives in one isolate's memory so it does not bind across
 * Cloudflare PoPs. Without a hard cap, a distributed script could exhaust the
 * mail quota, which would take down the licence emails paying customers depend
 * on and put the sender domain's reputation at risk. Well above any plausible
 * real day: 30 trials a day would be a very good problem.
 */
const TRIALS_PER_DAY_MAX = 60;

async function trialsCreatedToday(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM licenses WHERE source = 'trial' AND created_at >= datetime('now','start of day')",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Mint a 7-day Pro trial, no card, called by the MCP server on the user's
 * machine when they ask their agent to start a trial.
 *
 * The abuse anchor is `fingerprint`: a salted SHA-256 of the user's App Store
 * Connect Issuer ID, hashed on their machine. Getting a second one means paying
 * Apple for a second developer account, which is a $99/year answer to a $9/month
 * question. Email is a second, independent anchor.
 *
 * Uniqueness is enforced by two partial unique indexes rather than by a
 * check-then-insert, because D1 gives no transaction across statements and two
 * concurrent calls would otherwise both pass the check and both insert.
 */
async function handleTrial(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  let body: TrialRequest;
  try {
    body = (await request.json()) as TrialRequest;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON." }, headers, 400);
  }

  if (!isValidFingerprint(body.fingerprint)) {
    return json(
      { error: "bad_request", message: "fingerprint must be a 64-character SHA-256 hex digest." },
      headers,
      400,
    );
  }
  if (!isValidEmail(body.email)) {
    return json(
      { error: "bad_request", message: "A valid email is required so we can send you the key." },
      headers,
      400,
    );
  }
  // Rate limiting sits AFTER validation on purpose. Charging the budget for
  // malformed input meant an agent that sent a bad address twice could lock its
  // user out of starting a trial for fifteen minutes, which is the opposite of
  // what this endpoint is for. Only well-formed requests, the ones that reach
  // the database, count against it.
  if (!rateLimit(request, "trial")) {
    return json(
      { error: "rate_limited", message: "Too many trial requests. Wait 15 minutes and try again." },
      headers,
      429,
    );
  }

  const fingerprint = body.fingerprint;
  const email = body.email.trim().toLowerCase();
  const tool = isValidToolName(body.tool) ? body.tool : null;
  const now = new Date();

  // Paying customers are checked FIRST, before the trial lookup.
  //
  // Someone who converts mid-trial holds both rows. If the fingerprint branch
  // ran first it would keep handing back the trial key, that key is what ends up
  // in their config, and the day the trial expires a paying subscriber loses
  // access with a message telling them to buy the thing they already bought.
  //
  // The key itself is not returned: this endpoint takes an unauthenticated
  // email, so it must never become a way to read someone else's licence.
  const paid = await env.DB.prepare(
    "SELECT key, expires_at FROM licenses WHERE email = ? AND source = 'polar' AND active = 1",
  )
    .bind(email)
    .first<{ key: string; expires_at: string | null }>();

  if (paid) {
    // They subscribed. If this machine is the one that started a trial on this
    // same address, hand back the subscription key so it replaces the trial key
    // sitting in their config.
    //
    // Without this, converting is a trap: the config still holds the trial key,
    // it keeps working until day 8, and then a paying customer's agent breaks
    // with a message telling them to buy what they already bought.
    //
    // The bar to get a key here is possession of the Apple developer account
    // AND the email, which is strictly higher than the /key page has always
    // asked (an email address alone), so this discloses nothing new.
    //
    // Matched on the fingerprint alone, deliberately. Requiring the trial row to
    // carry the same address stranded anyone who trialled with a personal
    // address and then checked out with a work one: their config kept the trial
    // key and broke on day 8. The fingerprint is a 64-hex digest of an Issuer ID
    // nobody else holds, so it is the strong half of the pair either way.
    const ownTrial = await env.DB.prepare(
      "SELECT id FROM licenses WHERE trial_fingerprint = ?",
    )
      .bind(fingerprint)
      .first<{ id: number }>();

    if (ownTrial) {
      return json(
        {
          ok: true,
          key: paid.key,
          expires: paid.expires_at,
          days_remaining: daysRemaining(paid.expires_at, now),
          already_started: true,
          subscription: true,
        },
        headers,
      );
    }

    return json(trialRefused(email), headers, 409);
  }

  // Repeat call for a trial we already minted: hand back the same key. Asking an
  // agent to "start my trial" twice is normal and must not fail or double-mint.
  const existing = await env.DB.prepare(
    "SELECT key, expires_at, active FROM licenses WHERE trial_fingerprint = ?",
  )
    .bind(fingerprint)
    .first<{ key: string; expires_at: string | null; active: number }>();

  if (existing) {
    const verdict = isLicenseUsable({ ...existing, source: "trial" }, now);
    if (verdict.usable) {
      return json(
        {
          ok: true,
          key: existing.key,
          expires: existing.expires_at,
          days_remaining: daysRemaining(existing.expires_at, now),
          already_started: true,
        },
        headers,
      );
    }
    return json(trialRefused(email), headers, 409);
  }

  // Checked only on the path that actually creates a row, so a legitimate
  // repeat caller is never turned away by someone else's abuse.
  if ((await trialsCreatedToday(env)) >= TRIALS_PER_DAY_MAX) {
    console.error("daily trial cap reached");
    return json(
      {
        error: "capacity",
        message:
          "Trials are temporarily unavailable. Email povkonop@gmail.com and you will get one manually, same day.",
        checkout_url: buildCheckoutUrl("trial_capacity", email),
      },
      headers,
      503,
    );
  }

  const key = generateLicenseKey();
  const expiresAt = trialExpiry(now);

  // OR IGNORE, not ON CONFLICT: either partial unique index (fingerprint or
  // trial email) can be the one that blocks, and both mean "no second trial".
  await env.DB.prepare(
    `INSERT OR IGNORE INTO licenses
       (key, tier, email, expires_at, active, source, trial_fingerprint, trigger_tool, created_at)
     VALUES (?, 'pro', ?, ?, 1, 'trial', ?, ?, datetime('now'))`,
  )
    .bind(key, email, expiresAt, fingerprint, tool)
    .run();

  const minted = await env.DB.prepare(
    "SELECT key, expires_at FROM licenses WHERE trial_fingerprint = ?",
  )
    .bind(fingerprint)
    .first<{ key: string; expires_at: string | null }>();

  if (!minted) {
    // Uniqueness is on the fingerprint, which we already checked, so reaching
    // here means the insert lost to something else entirely (a key collision,
    // a write failure). Do not claim the trial was used.
    console.error("trial insert produced no row");
    return json(
      {
        error: "mint_failed",
        message: "Could not create the trial just now. Try again in a moment.",
      },
      headers,
      503,
    );
  }

  await recordIntent(env, "trial_started", tool || "direct");

  const sent = await sendTrialEmail(env, email, minted.key, minted.expires_at);
  if (sent) {
    await env.DB.prepare(
      "UPDATE licenses SET key_emailed = 1 WHERE trial_fingerprint = ?",
    )
      .bind(fingerprint)
      .run();
  }

  return json(
    {
      ok: true,
      key: minted.key,
      expires: minted.expires_at,
      days_remaining: daysRemaining(minted.expires_at, now),
      already_started: false,
      checkout_url: buildCheckoutUrl("trial", email),
    },
    headers,
  );
}

/**
 * Read side of the only question this instrumentation exists to answer: which
 * locked tools make people reach for their card, and does the trial convert.
 */
async function handleAdminStats(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const auth = request.headers.get("x-admin-secret") || "";
  if (!env.ADMIN_TOKEN || !timingSafeEqual(auth, env.ADMIN_TOKEN)) {
    return json({ error: "Unauthorized" }, headers, 401);
  }

  const intent = await env.DB.prepare(
    `SELECT kind, tool, SUM(count) AS total FROM intent_events
     GROUP BY kind, tool ORDER BY total DESC`,
  ).all<{ kind: string; tool: string; total: number }>();

  const trials = await env.DB.prepare(
    `SELECT
       COUNT(*) AS issued,
       SUM(CASE WHEN active = 1 AND expires_at > datetime('now') THEN 1 ELSE 0 END) AS live,
       SUM(CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END) AS ended
     FROM licenses WHERE source = 'trial'`,
  ).first<{ issued: number; live: number; ended: number }>();

  const paid = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active
     FROM licenses WHERE source = 'polar'`,
  ).first<{ total: number; active: number }>();

  // A conversion is an email that holds both a trial row and a paid row.
  const converted = await env.DB.prepare(
    `SELECT COUNT(DISTINCT t.email) AS n FROM licenses t
     JOIN licenses p ON p.email = t.email AND p.source = 'polar'
     WHERE t.source = 'trial'`,
  ).first<{ n: number }>();

  return json(
    {
      intent: intent.results ?? [],
      trials: { ...trials, converted: converted?.n ?? 0 },
      paid,
    },
    headers,
  );
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
  if (!env.ADMIN_TOKEN || !timingSafeEqual(auth, env.ADMIN_TOKEN)) {
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
 * Send a product announcement to one existing customer, guarded by
 * ANNOUNCE_TOKEN. The recipient must already exist in the licenses table, so
 * this can never be used to mail an arbitrary address.
 */
async function handleAdminAnnounce(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const auth = request.headers.get("x-announce-token") || "";
  if (!env.ANNOUNCE_TOKEN || !timingSafeEqual(auth, env.ANNOUNCE_TOKEN)) {
    return json({ error: "Unauthorized" }, headers, 401);
  }

  const body = (await request.json()) as {
    email?: string;
    subject?: string;
    html?: string;
  };

  if (!body.email || !body.subject || !body.html) {
    return json({ error: "email, subject and html required" }, headers, 400);
  }

  const row = await env.DB.prepare("SELECT id FROM licenses WHERE email = ?")
    .bind(body.email)
    .first<{ id: number }>();

  if (!row) {
    return json({ error: "Not a known customer" }, headers, 404);
  }

  if (!env.BREVO_API_KEY) {
    return json({ error: "Email not configured" }, headers, 503);
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: env.BREVO_SENDER_NAME || "App Store Connect MCP",
        email: env.BREVO_SENDER_EMAIL || "license@brewist.app",
      },
      to: [{ email: body.email }],
      subject: body.subject,
      htmlContent: body.html,
    }),
  });

  if (!res.ok) {
    return json({ error: "Send failed", status: res.status }, headers, 502);
  }

  return json({ ok: true, sent_to: body.email }, headers);
}

/**
 * Email a buyer their license key via Brevo's transactional API.
 * Returns true on success. No-ops (returns false) if BREVO_API_KEY is unset,
 * so the worker is safe to deploy before email is configured.
 */
/**
 * A complete, paste-ready server block. Sending only the `ASC_LICENSE_KEY` line
 * assumed the customer already had a working config; someone who buys before
 * installing had nothing to paste it into. `npx` (not a bare `asc-mcp`) so it
 * launches without a global install.
 */
const CONFIG_SNIPPET = (key: string) => `{
  "mcpServers": {
    "appstore-connect": {
      "command": "npx",
      "args": ["-y", "@pofky/asc-mcp"],
      "env": {
        "ASC_ISSUER_ID": "YOUR_ISSUER_ID",
        "ASC_LICENSE_KEY": "${key}"
      }
    }
  }
}`;

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
      <p>If your <code>.p8</code> is in <code>~/.appstoreconnect/private_keys/</code>, this block is complete once you fill in your Issuer ID. If the key lives somewhere else, add <code>ASC_PRIVATE_KEY_PATH</code> to the same env block.</p>
      <pre style="background:#f4f4fb;border-radius:8px;padding:14px;overflow-x:auto;font-size:13px">${CONFIG_SNIPPET(safeKey)}</pre>
      <p>Not set up yet? Drop your <code>.p8</code> into <code>~/.appstoreconnect/private_keys/</code> and run <code>npx @pofky/asc-mcp init --write</code>; it asks for your Issuer ID and this key, then writes the config for you.</p>
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
 * The trial key, by email. Sent even though the agent already printed the key,
 * because the address is the only channel we have to a free user: without it a
 * trial that expires while someone is busy is simply lost.
 */
async function sendTrialEmail(
  env: Env,
  email: string,
  key: string,
  expires: string | null,
): Promise<boolean> {
  if (!env.BREVO_API_KEY) return false;

  const safeKey = escapeHtml(key);
  const ends = expires ? new Date(expires).toUTCString() : `${TRIAL_DAYS} days from now`;

  const htmlContent = `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
      <h1 style="font-size:20px">Your ${TRIAL_DAYS}-day App Store Connect MCP Pro trial</h1>
      <p>All 41 tools are unlocked on this key until <strong>${escapeHtml(ends)}</strong>. No card, nothing to cancel.</p>
      <div style="background:#f4f4fb;border:1px solid #ddd;border-radius:8px;padding:16px;font-family:monospace;font-size:18px;letter-spacing:1px;text-align:center">${safeKey}</div>
      <p>Your agent has already written this into your MCP config. If you need it on another machine, paste it in yourself:</p>
      <pre style="background:#f4f4fb;border-radius:8px;padding:14px;overflow-x:auto;font-size:13px">${CONFIG_SNIPPET(safeKey)}</pre>
      <p><strong>Worth trying first:</strong> ask your agent to run a release preflight on your app, or to give you a morning briefing across all of them. Those two answer the question "is this worth $9" faster than anything else here.</p>
      <p>When the trial ends, Pro is $9 per month: <a href="${CHECKOUT_URL}">subscribe here</a>. Cancel any time.</p>
      <p style="color:#666;font-size:14px">Hit a bug, or something did not work? Just reply to this email. A person reads it.</p>
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
        sender: {
          name: env.BREVO_SENDER_NAME || "App Store Connect MCP",
          email: env.BREVO_SENDER_EMAIL || "license@brewist.app",
        },
        to: [{ email }],
        subject: `Your ${TRIAL_DAYS}-day App Store Connect MCP Pro trial key`,
        htmlContent,
      }),
    });
    if (!res.ok) {
      console.error("Brevo trial send failed", res.status);
      return false;
    }
    return true;
  } catch {
    console.error("Brevo trial send error");
    return false;
  }
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

const EMAIL_FIELD = (label: string, button: string, colour = "#4f46e5") => `
    <form method="POST" action="/key">
      <label for="email">${label}</label>
      <input id="email" type="email" name="email" placeholder="you@example.com" required autocomplete="email"
        style="padding:10px;font-size:16px;width:min(300px,100%);border:1px solid #555;border-radius:6px;background:#1a1a2e;color:#fff">
      <button type="submit"
        style="padding:10px 20px;font-size:16px;background:${colour};color:#fff;border:none;border-radius:6px;cursor:pointer;margin-top:8px">
        ${button}
      </button>
    </form>`;

/**
 * Where Polar sends someone the moment they pay. It is the first thing they see
 * after trusting an unknown developer with $9 and, shortly, an Apple signing
 * key, so it says what happens next and who to contact rather than presenting a
 * bare form.
 */
function handleSuccess(headers: Record<string, string>): Response {
  return html(`
    <h1>Subscription confirmed</h1>
    <p>Your key is being generated now, and it usually takes a few seconds. It is also emailed to you, so you do not have to keep this page.</p>
    ${EMAIL_FIELD("The email you used at checkout", "Get my license key")}

    <h2>Then what</h2>
    <p>Put the key in your MCP config as <code>ASC_LICENSE_KEY</code> and restart your agent, or run <code>npx @pofky/asc-mcp init --write</code> and it will do it for you. The next page gives you a complete config block to paste.</p>

    <p class="muted">Nothing showing after a minute? That is on us, not you. Email <a href="mailto:povkonop@gmail.com?subject=ASC%20MCP%20Pro%20license">povkonop@gmail.com</a> with the address you checked out with and you will get a key back the same day.</p>
  `, headers, 200, { title: "Subscription confirmed", noindex: true });
}

function handleKeyPage(headers: Record<string, string>): Response {
  return html(`
    <h1>Retrieve your license key</h1>
    <p>Enter the email you subscribed with, or the one you started a trial with.</p>
    ${EMAIL_FIELD("Your email address", "Look up my key")}
  `, headers, 200, { title: "Retrieve your license key", noindex: true });
}


async function handleKeyLookup(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  if (!rateLimit(request, "key")) {
    return html(
      "<h1>Too many attempts</h1><p>Please wait 15 minutes before trying again.</p>",
      headers,
      429,
    );
  }

  const formData = await request.formData();
  const email = formData.get("email") as string;

  if (!email) {
    return html("<h1>Email required</h1><p><a href='/key'>Try again</a></p>", headers, 400);
  }

  const candidates = await env.DB.prepare(
    "SELECT key, tier, active, expires_at, source FROM licenses WHERE email = ? AND active = 1 ORDER BY created_at DESC",
  )
    .bind(email)
    .all<LookupRow>();

  const row = pickLookupRow(candidates.results ?? [], new Date());

  if (!row) {
    return html(`
      <h1>No active license found</h1>
      <p>No active Pro license found for <strong>${escapeHtml(email)}</strong>.</p>
      <p>If you just purchased, it may take a minute for the webhook to process. <a href="/key">Try again</a>.</p>
      <p>Still nothing after a few minutes? Email <a href="mailto:povkonop@gmail.com?subject=ASC%20MCP%20Pro%20license">povkonop@gmail.com</a> with the email you checked out with and we will sort it out quickly.</p>
      <p>Never had one? Pro is $9/month, and there is a free 7-day trial you start from inside your agent by asking it to run <code>asc_start_trial</code>. <a href="${CHECKOUT_URL}">Subscribe here</a>.</p>
    `, headers, 200, { title: "No active license found", noindex: true });
  }

  return html(`
    <h1>Your License Key</h1>
    <div style="background:#1a1a2e;padding:20px;border-radius:8px;border:1px solid #333;margin:20px 0;font-family:monospace;font-size:20px;letter-spacing:2px;text-align:center">
      ${escapeHtml(row.key)}
    </div>
    <p>Add this to your MCP server configuration:</p>
    <pre style="background:#1a1a2e;padding:15px;border-radius:8px;overflow-x:auto">${CONFIG_SNIPPET(escapeHtml(row.key))}</pre>
    <p>Not set up yet? Drop your <code>.p8</code> into <code>~/.appstoreconnect/private_keys/</code> and run <code>npx @pofky/asc-mcp init --write</code>, which asks for your Issuer ID and this key and writes the config for you.</p>
    <p><strong>Next step:</strong> save your config and restart your agent (Claude Code, Cursor, Windsurf, etc.) so it reloads with the key. Then ask it to "list my App Store Connect apps" to confirm Pro is active.</p>
    <p style="color:#888;font-size:14px">Keep this key private. It unlocks Pro tools on your machine.</p>
  `, headers, 200, { title: "Your license key", noindex: true });
}

function handlePrivacy(headers: Record<string, string>): Response {
  return html(`
    <h1>Privacy Policy</h1>
    <p><em>Last updated: August 6, 2026</em></p>

    <h2>What we collect</h2>
    <p>When you purchase a Pro license, we store:</p>
    <ul>
      <li>Your email address (from the checkout provider)</li>
      <li>A generated license key</li>
      <li>Your subscription ID (for managing renewals and cancellations)</li>
    </ul>
    <p>When you start a free 7-day trial with the <code>asc_start_trial</code> tool, we store:</p>
    <ul>
      <li>The email address you give the tool, so we can send you the key</li>
      <li>A generated license key and its expiry date</li>
      <li>A one-way SHA-256 fingerprint of your App Store Connect Issuer ID (see below)</li>
      <li>The name of the tool you were trying to use when you started the trial, if any</li>
    </ul>
    <p>Using the free tier, or using Pro once your key is set, stores nothing. The server runs locally on your machine.</p>

    <h2>The trial fingerprint, specifically</h2>
    <p>A trial gives away paid software, so we need to know that one person cannot take an unlimited number of them. The anchor we use is your App Store Connect Issuer ID, because it identifies an Apple developer account rather than a person.</p>
    <p><strong>Your Issuer ID is not sent to us.</strong> It is hashed with SHA-256 on your own machine and only the resulting digest is transmitted. The digest cannot be reversed into your Issuer ID, is useless to anyone who obtains it, and is sent only at the moment you explicitly ask to start a trial. It is never sent on startup, never sent during normal use, and never sent if you never start a trial.</p>

    <h2>What we don't collect</h2>
    <ul>
      <li>Your Apple API credentials never leave your machine. The .p8 private key and Key ID are never transmitted anywhere by this software, and your Issuer ID is only ever sent as the one-way digest described above, only when you start a trial</li>
      <li>No App Store Connect data passes through our servers</li>
      <li>No usage analytics or telemetry from the software. The MCP server does not report which tools you run, or when, or how often</li>
      <li>No cookies, no advertising identifiers, no third-party trackers</li>
    </ul>

    <h2>How your data flows</h2>
    <p>The MCP server runs locally. It talks directly to Apple's API from your computer. It makes exactly two kinds of call to our infrastructure, both of which you control:</p>
    <ul>
      <li>A license key validation check, sending only the license key string. This happens on startup when you have a key set, and the result is cached for 24 hours.</li>
      <li>A trial request, sending the email you provided, the one-way fingerprint, and the tool name. This happens only when you call <code>asc_start_trial</code>.</li>
    </ul>
    <p>Separately, when you click a subscribe link from inside your agent, it passes through a redirect on our server that increments a daily counter of the form "3 people clicked the buy link from the submit_for_review tool today". That counter holds a date, a tool name and a number. It records no identifier, no IP address, no user agent, and nothing that could be tied back to you.</p>

    <h2>Data storage</h2>
    <p>License data is stored on Cloudflare D1 (EU region). Cloudflare acts as our infrastructure provider under their <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">Data Processing Agreement</a>.</p>

    <h2>Payment processing</h2>
    <p>Payments are handled by <a href="https://polar.sh">Polar.sh</a>, who acts as Merchant of Record. We never see your credit card details. Polar's privacy policy applies to the checkout process.</p>

    <h2>Data retention</h2>
    <p>We keep your email, license key and subscription id for as long as the record exists, including after a subscription is cancelled or a trial ends. Two honest reasons: a cancelled subscriber who resubscribes should get their history back rather than a support ticket, and deleting a finished trial record is the same as handing out a second free trial.</p>
    <p>You can delete all of it whenever you like at <a href="/delete">/delete</a>. We email you a confirmation link first, so that nobody can remove your license by typing your address into a form, and the deletion runs when you click it. This is the only deletion mechanism: there is no automatic purge on a timer, and we would rather say so than publish a promise no code keeps.</p>

    <h2>Your rights (GDPR)</h2>
    <p>You can request access to, correction of, or deletion of your personal data at any time. To delete your data, visit <a href="/delete">/delete</a> and click the link we email you, or just email us and we will do it by hand.</p>

    <h2>Contact</h2>
    <p>For privacy questions: povkonop@gmail.com</p>

    <p style="color:#888;font-size:13px;margin-top:40px">This project is not affiliated with, endorsed by, or sponsored by Apple Inc. Apple, App Store, App Store Connect, TestFlight, iOS, and macOS are trademarks of Apple Inc.</p>
  `, headers, 200, {
    title: "Privacy Policy",
    canonical: "https://asc-mcp-license.remewdy.workers.dev/privacy",
    head: `\n<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"App Store Connect MCP","item":"https://asc-mcp.pages.dev/"},{"@type":"ListItem","position":2,"name":"Privacy Policy"}]},{"@type":"WebPage","name":"Privacy Policy","url":"https://asc-mcp-license.remewdy.workers.dev/privacy","dateModified":"2026-08-06","isPartOf":{"@type":"WebSite","url":"https://asc-mcp.pages.dev/"}}]}</script>`,
  });
}

function handleTerms(headers: Record<string, string>): Response {
  return html(`
    <h1>Terms of Service</h1>
    <p><em>Last updated: August 6, 2026</em></p>

    <h2>What this is</h2>
    <p>App Store Connect MCP Server is a developer tool that connects AI coding agents to Apple's App Store Connect API. It runs locally on your machine.</p>

    <h2>Requirements</h2>
    <ul>
      <li>A valid Apple Developer Program membership</li>
      <li>An App Store Connect API key that you create and control</li>
      <li>Compliance with Apple's Developer Program License Agreement</li>
    </ul>

    <h2>Free and Pro tiers</h2>
    <p>Six of the 41 tools are free with no subscription: <code>asc_setup_check</code>, <code>asc_guide</code>, <code>asc_start_trial</code>, <code>list_apps</code>, <code>app_details</code> and <code>review_status</code>. Three of those (the setup check, the playbook and the trial starter) need nothing at all; the other three read from App Store Connect, so they need your own Apple API key like every other tool here. The remaining 35, covering customer reviews, sales reports, preflight audits and the full write/control plane (metadata, screenshots, builds, TestFlight, in-app purchases, submit, release), require either a running trial or a $9/month subscription managed through <a href="https://polar.sh">Polar.sh</a>.</p>

    <h2>Free trial</h2>
    <p>You can unlock every Pro tool for 7 days at no cost by calling the <code>asc_start_trial</code> tool from your agent. No card is required, nothing renews, and there is nothing to cancel: the key simply stops working when the 7 days are up.</p>
    <p>One trial per Apple developer account and per email address. The account is identified by a one-way fingerprint of your Issuer ID, described in the <a href="/privacy">privacy policy</a>. We may decline or withdraw a trial where it is being used to avoid paying for continued use, for example by cycling accounts or addresses.</p>

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
  `, headers, 200, {
    title: "Terms of Service",
    canonical: "https://asc-mcp-license.remewdy.workers.dev/terms",
    head: `\n<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"App Store Connect MCP","item":"https://asc-mcp.pages.dev/"},{"@type":"ListItem","position":2,"name":"Terms of Service"}]},{"@type":"WebPage","name":"Terms of Service","url":"https://asc-mcp-license.remewdy.workers.dev/terms","dateModified":"2026-08-06","isPartOf":{"@type":"WebSite","url":"https://asc-mcp.pages.dev/"}}]}</script>`,
  });
}

function handleDeletePage(headers: Record<string, string>): Response {
  return html(`
    <h1>Delete Your Data</h1>
    <p>Enter the email associated with your license to delete all your data from our systems.</p>
    <form method="POST" action="/delete">
      <label for="email">Your email address</label>
      <input id="email" type="email" name="email" placeholder="you@example.com" required autocomplete="email"
        style="padding:10px;font-size:16px;width:min(300px,100%);border:1px solid #555;border-radius:6px;background:#1a1a2e;color:#fff">
      <button type="submit"
        style="padding:10px 20px;font-size:16px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-top:8px">
        Email me a deletion link
      </button>
    </form>
    <p class="muted" style="margin-top:20px">We email you a confirmation link first, so nobody can remove your license by typing your address into this form. Confirming permanently deletes your email and license key. If you have an active subscription, cancel it separately through Polar, otherwise it will bill again and issue a new key.</p>
  `, headers, 200, { title: "Delete your data", noindex: true });
}

/**
 * The secret used to sign deletion links. Falls back to the admin token so this
 * cannot silently degrade to an unsigned flow if a dedicated secret was never
 * set; if neither exists the endpoint refuses rather than deleting.
 */
function deleteSecret(env: Env): string | null {
  return env.DELETE_SECRET || env.ADMIN_TOKEN || null;
}

/**
 * Step one of deletion: email a signed, expiring confirmation link.
 *
 * This used to delete on a bare unauthenticated form post, which meant anyone
 * who knew a customer's address could revoke that customer's licence and leave
 * them broken until their next renewal webhook rebuilt the row. It also erased
 * the trial fingerprint, handing out a second free trial.
 *
 * The response is identical whether or not the address is known, so this is not
 * a way to discover who the customers are.
 */
async function handleDeleteRequest(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  if (!rateLimit(request, "delete")) {
    return html(
      "<h1>Too many attempts</h1><p>Please wait 15 minutes before trying again.</p>",
      headers,
      429,
    );
  }

  const formData = await request.formData();
  const email = ((formData.get("email") as string) || "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return html("<h1>Email required</h1><p><a href='/delete'>Try again</a></p>", headers, 400);
  }

  const sameAnswer = html(`
    <h1>Check your email</h1>
    <p>If <strong>${escapeHtml(email)}</strong> has data here, a confirmation link is on its way. It is valid for one hour.</p>
    <p>Deleting is not reversible, so the link is the confirmation step: nobody can remove your licence by typing your address into this form.</p>
  `, headers, 200, { title: "Check your email", noindex: true });

  const secret = deleteSecret(env);
  if (!secret) {
    console.error("delete requested but no signing secret configured");
    return html(
      "<h1>Not available right now</h1><p>Email povkonop@gmail.com and your data will be deleted manually, same day.</p>",
      headers,
      503,
    );
  }

  const row = await env.DB.prepare("SELECT id FROM licenses WHERE email = ?")
    .bind(email)
    .first<{ id: number }>();
  if (!row) return sameAnswer;

  if (!env.BREVO_API_KEY) {
    console.error("delete requested but email is not configured");
    return html(
      "<h1>Not available right now</h1><p>Email povkonop@gmail.com and your data will be deleted manually, same day.</p>",
      headers,
      503,
    );
  }

  const token = await signDeleteToken(secret, email, Date.now() + DELETE_TOKEN_TTL_MS);
  const link = `https://asc-mcp-license.remewdy.workers.dev/delete/confirm?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: env.BREVO_SENDER_NAME || "App Store Connect MCP",
        email: env.BREVO_SENDER_EMAIL || "license@brewist.app",
      },
      to: [{ email }],
      subject: "Confirm deleting your App Store Connect MCP data",
      htmlContent: `
        <div style="font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
          <h1 style="font-size:20px">Confirm deletion</h1>
          <p>Someone asked to delete the App Store Connect MCP licence data for this address. If that was you, confirm here:</p>
          <p><a href="${link}">Delete my data</a></p>
          <p>The link expires in one hour. Your licence key stops working the moment you confirm, and if you have an active subscription you should cancel it separately at polar.sh.</p>
          <p style="color:#666;font-size:14px">If this was not you, ignore this email. Nothing has been deleted, and nobody can delete your data without this link.</p>
        </div>`,
    }),
  });

  return sameAnswer;
}

/** Step two: the signed link actually deletes. */
async function handleDeleteConfirm(
  url: URL,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";
  const secret = deleteSecret(env);

  if (!secret || !isValidEmail(email) || !(await verifyDeleteToken(secret, email, token, Date.now()))) {
    return html(
      "<h1>This link is not valid</h1><p>It may have expired (they last one hour). <a href='/delete'>Request a new one</a>.</p>",
      headers,
      400,
    );
  }

  await env.DB.prepare("DELETE FROM licenses WHERE email = ?").bind(email).run();

  return html(`
    <h1>Data deleted</h1>
    <p>All license data associated with <strong>${escapeHtml(email)}</strong> has been removed from our systems.</p>
    <p>If you have an active Polar subscription, please cancel it separately at <a href="https://polar.sh">polar.sh</a>, otherwise it will keep billing and issue you a new key.</p>
  `, headers, 200, { title: "Data deleted", noindex: true });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface PageOptions {
  /** Page title. Every page shared one, so a customer's tabs and history were
   *  all identically labelled and the legal pages had no context in search. */
  title?: string;
  /** Transactional pages (checkout return, key retrieval, deletion) should not
   *  be indexed. Privacy and terms should. */
  noindex?: boolean;
  /** Full canonical URL, for the pages that are meant to be found. */
  canonical?: string;
  /** Extra head markup, e.g. structured data for the legal pages. */
  head?: string;
}

function html(
  body: string,
  extraHeaders: Record<string, string>,
  status = 200,
  opts: PageOptions = {},
): Response {
  const title = opts.title
    ? `${opts.title} | App Store Connect MCP`
    : "App Store Connect MCP";
  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="robots" content="${opts.noindex ? "noindex,nofollow" : "index,follow"}">${
    opts.canonical ? `\n<link rel="canonical" href="${opts.canonical}">` : ""
  }${opts.head ?? ""}
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;background:#0d0d1a;color:#e0e0e0;line-height:1.6}
a{color:#818cf8}h1{color:#fff}h2{color:#fff;font-size:1.05rem;margin-top:28px}pre{color:#a5b4fc}
label{display:block;margin-bottom:6px;color:#c0c0c0;font-size:14px}
.muted{color:#888;font-size:14px}</style></head><body>${body}
<p class="muted" style="margin-top:40px">&larr; <a href="https://asc-mcp.pages.dev/">App Store Connect MCP</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="mailto:povkonop@gmail.com">povkonop@gmail.com</a></p>
</body></html>`;
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
