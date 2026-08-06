-- Full shape for a fresh database. An existing database is brought here by the
-- files in migrations/, which is what the live D1 instance has had applied.
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'pro',
  email TEXT,
  polar_subscription_id TEXT UNIQUE,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  key_emailed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 'polar' for a purchase, 'trial' for a self-served in-agent trial.
  source TEXT NOT NULL DEFAULT 'polar',
  -- Salted SHA-256 of the user's App Store Connect Issuer ID, computed on their
  -- machine. NULL on paid rows. Anchors one-trial-per-Apple-account.
  trial_fingerprint TEXT,
  -- Which locked tool's gate produced this trial, when known.
  trigger_tool TEXT,
  -- Set by subscription.revoked. Terminal: no later event reactivates the row.
  revoked_at TEXT,
  -- Set when the customer turns off renewal. Suppresses the grace window.
  canceled_at TEXT,
  -- Which machine claimed this paid licence through /trial. See
  -- migrations/0002-claim-fingerprint.sql.
  claim_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
CREATE INDEX IF NOT EXISTS idx_licenses_polar_sub ON licenses(polar_subscription_id);

-- One trial per Apple developer account. Not per email: an email address is
-- something anyone can type, so making it an anchor would let a stranger burn a
-- real user's trial. See migrations/0001-trial-and-intent.sql.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_trial_fp
  ON licenses(trial_fingerprint) WHERE trial_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);

CREATE TABLE IF NOT EXISTS intent_events (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, tool)
);
