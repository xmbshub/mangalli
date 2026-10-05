-- File laporan yang dibuat Ask Eline (Excel/PDF), disimpan 7 hari lalu dihapus.
-- Hanya bisa diunduh lewat dashboard oleh pembuatnya atau owner/manager outlet.
CREATE TABLE IF NOT EXISTS assistant_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_files_outlet_idx ON assistant_files(outlet_key, created_at);
