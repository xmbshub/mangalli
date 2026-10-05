-- Asal pesanan: tablet kasir atau menu digital. Dipakai notifikasi suara
-- pesanan menu digital (dashboard dan tablet) serta laporan per saluran.
-- API tablet lama membuat pesanan tanpa device_id, jadi device_id tidak bisa
-- menjadi penanda; jalur menu digital kini menulis channel='menu' sendiri.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'tablet';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;
ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN ('tablet', 'menu'));
-- Riwayat: pesanan tanpa tablet yang pernah menunggu bayar, atau yang dibayar
-- lewat Midtrans, berasal dari menu digital. Pesanan menu lama yang
-- dibayar di kasir sebelum migrasi ini tetap tercatat 'tablet' (perkiraan).
UPDATE orders o SET channel = 'menu'
  WHERE o.device_id IS NULL AND (o.payment_due_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM payments p WHERE p.order_id = o.id AND (p.checkout_url IS NOT NULL OR p.payment_method = 'midtrans')));
CREATE INDEX IF NOT EXISTS orders_menu_alert_idx ON orders(outlet_key, id) WHERE channel = 'menu';
