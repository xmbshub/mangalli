-- Stok per produk (opsional). stock_quantity = jumlah yang dihitung owner pada
-- stock_counted_at; sisa stok = jumlah itu - item di pesanan tidak batal sejak
-- saat itu (tablet dan menu digital). Pembatalan, pesanan menu kedaluwarsa, dan
-- void mengembalikan stok dengan sendirinya. NULL = stok tidak dilacak.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity integer CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_counted_at timestamptz;
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items(product_id);
