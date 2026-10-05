-- Email laporan harian (permintaan owner 4 Okt 2026) untuk owner dan manager,
-- 30 menit setelah jam tutup outlet. Tiap orang bisa berhenti berlangganan.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_report_opt_out boolean NOT NULL DEFAULT false;

-- Satu baris per outlet per hari usaha: mencegah kirim ganda saat server
-- restart atau ada lebih dari satu proses, dan mencatat hasil pengiriman.
CREATE TABLE IF NOT EXISTS daily_report_runs (
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  business_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  recipients integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 1,
  error text,
  PRIMARY KEY (outlet_key, business_date)
);
