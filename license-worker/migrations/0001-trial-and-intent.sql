-- PRD-0001: in-agent trial + buy-intent instrumentation.
--
-- Additive only. No column is dropped, renamed, retyped, or given a new NOT NULL
-- constraint, so every existing row keeps validating exactly as it does today.
-- Existing rows land on source='polar', which is what they are and which keeps
-- them inside the renewal grace window (see isLicenseUsable).
--
-- Apply BEFORE deploying the worker build that reads these columns:
--   wrangler d1 execute asc-mcp-licenses --remote \
--     --file=license-worker/migrations/0001-trial-and-intent.sql

ALTER TABLE licenses ADD COLUMN source TEXT NOT NULL DEFAULT 'polar';
ALTER TABLE licenses ADD COLUMN trial_fingerprint TEXT;
ALTER TABLE licenses ADD COLUMN trigger_tool TEXT;

-- Partial, so the many NULLs on paid rows do not collide. This is what makes the
-- one-trial-per-fingerprint guarantee atomic under concurrent requests: D1 has no
-- multi-statement transaction, so uniqueness has to be enforced by the database,
-- not by a check-then-insert in the worker.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_trial_fp
  ON licenses(trial_fingerprint) WHERE trial_fingerprint IS NOT NULL;

-- Deliberately NOT a unique index on the trial email.
--
-- The fingerprint proves nothing about who sent it: it is a 64-hex string, and
-- the server cannot check that the caller derived it from an Issuer ID they
-- actually hold. So if the email were also a uniqueness anchor, anyone could
-- post a made-up fingerprint with someone else's address and permanently burn
-- that person's free trial before they had ever heard of this product.
--
-- Uniqueness rests on the Apple account alone, which an attacker cannot guess
-- and a freeloader cannot cheaply duplicate ($99/year per developer account
-- against $9/month). The email is still stored, still sent the key, and still
-- the channel we follow up on; it just cannot be used as a weapon.
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);

-- Aggregated counts only: a day bucket, a kind, and a tool name. No identifiers,
-- no IP, no user agent, nothing that could be tied back to a person.
CREATE TABLE IF NOT EXISTS intent_events (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, tool)
);
