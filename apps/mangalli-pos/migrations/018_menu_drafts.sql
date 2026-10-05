-- Draf menu dari chat Ask Eline (permintaan owner 5 Okt 2026): owner menjelaskan
-- menu di chat, Eline menyiapkan draf (kategori, produk, harga, varian) yang
-- dibuka di halaman Import untuk diperiksa. Tidak ada yang tersimpan ke menu
-- sebelum owner menekan Import. Draf berumur satu hari.
CREATE TABLE IF NOT EXISTS menu_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  draft jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS menu_drafts_outlet_idx ON menu_drafts(outlet_key, created_at);
