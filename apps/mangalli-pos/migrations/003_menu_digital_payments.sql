-- Menu digital (situs di layanan website) mengirim pesanan ke Mangalli lewat
-- API adapter. Pesanan itu menunggu pembayaran dulu dan baru masuk dapur
-- setelah lunas, supaya pesanan fiktif tidak pernah diproses.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_restaurant_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_restaurant_status_check
  CHECK (restaurant_status IN ('pending_payment', 'new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_pending_payment_idx ON orders(outlet_key, payment_due_at) WHERE restaurant_status = 'pending_payment';

-- Cara bayar yang diizinkan owner untuk menu digital outlet ini:
-- cashier (bayar di kasir), qris (QRIS toko dengan nominal otomatis),
-- midtrans (hanya aktif bila kunci merchant outlet tersedia di server).
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS menu_payment_methods text[] NOT NULL DEFAULT ARRAY['cashier']::text[];
-- Isi QRIS statis milik outlet (bukan rahasia; sama dengan yang dicetak di meja kasir).
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS qris_payload text;
-- Alamat situs menu digital outlet, dipakai QR meja dari dashboard.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS menu_url text;
-- Tautan pembayaran Midtrans, supaya pelanggan bisa melanjutkan bayar dari halaman status.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url text;
