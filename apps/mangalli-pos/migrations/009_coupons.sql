-- Kupon: promo berkode yang hanya berlaku bila kodenya dimasukkan (untuk
-- kampanye media sosial), dengan batas pemakaian dan masa berlaku opsional.
-- Masa berlaku (tanggal) juga bisa dipakai promo biasa.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS code text CHECK (code IS NULL OR code ~ '^[A-Z0-9_-]{3,24}$');
CREATE UNIQUE INDEX IF NOT EXISTS promotions_outlet_code_idx ON promotions(outlet_key, code) WHERE code IS NOT NULL;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS max_uses integer CHECK (max_uses IS NULL OR max_uses > 0);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS ends_on date;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_dates_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_dates_check CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

-- Pesanan mencatat promo yang dipakai untuk menghitung pemakaian kupon.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_id bigint REFERENCES promotions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_promotion_idx ON orders(promotion_id) WHERE promotion_id IS NOT NULL;
