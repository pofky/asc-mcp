CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'pro',
  email TEXT,
  polar_subscription_id TEXT UNIQUE,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  key_emailed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
CREATE INDEX IF NOT EXISTS idx_licenses_polar_sub ON licenses(polar_subscription_id);
