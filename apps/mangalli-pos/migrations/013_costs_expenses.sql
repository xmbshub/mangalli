-- Laporan laba (permintaan owner 4 Okt 2026): harga modal (HPP) per produk dan
-- pengeluaran usaha, supaya Reports bisa menunjukkan laba kotor dan laba bersih.

-- Harga modal per satuan produk. NULL = belum diisi; laporan menyebut cakupannya.
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price numeric(14,2) CHECK (cost_price IS NULL OR cost_price >= 0);

-- Harga modal dibekukan per item saat pesanan dibuat, jadi laba bulan lalu tidak
-- berubah ketika owner mengubah harga modal. Trigger mengisi semua jalur
-- (tablet, sinkron offline, menu digital, API lama) tanpa mengubah kode insert.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost numeric(14,2);
-- Isi fungsi ditulis satu baris: runner migrasi memecah pernyataan di ";" + baris baru.
CREATE OR REPLACE FUNCTION order_items_snapshot_cost() RETURNS trigger AS $fn$ BEGIN IF NEW.unit_cost IS NULL AND NEW.product_id IS NOT NULL THEN SELECT cost_price INTO NEW.unit_cost FROM products WHERE id = NEW.product_id; END IF; RETURN NEW; END $fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS order_items_snapshot_cost ON order_items;
CREATE TRIGGER order_items_snapshot_cost BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION order_items_snapshot_cost();

-- Pengeluaran usaha yang dicatat di dashboard (sewa, gaji, bahan, listrik, dll).
-- Kas keluar dari laci tablet tetap di shift_cash_movements dan dijumlahkan
-- laporan sebagai kategori tersendiri, jadi tidak disalin ke sini.
CREATE TABLE IF NOT EXISTS expenses (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  spent_on date NOT NULL,
  category text NOT NULL CHECK (category IN ('ingredients', 'salaries', 'rent', 'utilities', 'marketing', 'equipment', 'transport', 'fees', 'other')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_outlet_day_idx ON expenses(outlet_key, spent_on);
