-- Laporan masalah dari tablet (crash, galat, laporan kasir), dashboard, dan
-- server (pembayaran online gagal). Laporan otomatis dengan sidik yang sama
-- digabung selama masih terbuka supaya crash berulang tidak membanjiri daftar.
CREATE TABLE IF NOT EXISTS support_reports (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('tablet', 'dashboard', 'system')),
  category text NOT NULL CHECK (category IN ('crash', 'error', 'payment', 'printer', 'sync', 'menu', 'other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  message text CHECK (char_length(message) <= 4000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text,
  occurrences integer NOT NULL DEFAULT 1,
  reported_by bigint REFERENCES users(id) ON DELETE SET NULL,
  device_id bigint REFERENCES android_pos_devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by bigint REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_reports_outlet_idx ON support_reports(outlet_key, status, last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS support_reports_open_fingerprint_idx
  ON support_reports(outlet_key, fingerprint) WHERE status = 'open' AND fingerprint IS NOT NULL;
