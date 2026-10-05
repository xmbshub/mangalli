-- Promo dan diskon per outlet. Satu promo per pesanan (tanpa tumpuk); pajak
-- dihitung dari subtotal setelah diskon. Pesanan menyimpan salinan nominal dan
-- label diskon, jadi promo boleh diubah atau dihapus tanpa mengubah riwayat.
CREATE TABLE IF NOT EXISTS promotions (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('percent', 'amount')),
  value numeric(14,2) NOT NULL CHECK (value > 0),
  max_discount numeric(14,2) CHECK (max_discount IS NULL OR max_discount > 0),
  min_subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  scope text NOT NULL DEFAULT 'order' CHECK (scope IN ('order', 'category', 'product')),
  category_ids bigint[] NOT NULL DEFAULT '{}',
  product_ids text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL DEFAULT '{tablet,menu}' CHECK (channels <@ ARRAY['tablet', 'menu']::text[] AND cardinality(channels) > 0),
  days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}' CHECK (days <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND cardinality(days) > 0),
  start_time time,
  end_time time,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK ((start_time IS NULL) = (end_time IS NULL))
);
CREATE INDEX IF NOT EXISTS promotions_outlet_idx ON promotions(outlet_key, is_active);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_label text;
