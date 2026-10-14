-- Kasir yang melayani pesanan (permintaan owner 13 Okt 2026, untuk audit): yang
-- mengambil pesanan di tablet, atau untuk pesanan menu digital yang menerima
-- pembayarannya di dashboard atau tablet. Tampil di detail pesanan, ekspor,
-- laporan, dan struk. Pesanan lama diisi dari jejak yang sudah ada.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_id bigint REFERENCES users(id) ON DELETE SET NULL;

-- Tablet versi lama (sinkron v1) mencatat kasir per kejadian.
UPDATE orders o SET cashier_id = e.user_id
  FROM (SELECT DISTINCT ON (order_id) order_id, user_id FROM android_pos_sync_events WHERE order_id IS NOT NULL ORDER BY order_id, created_at) e
 WHERE o.id = e.order_id AND o.cashier_id IS NULL;

-- Pesanan menu digital: yang menerima pembayaran (dashboard atau tablet).
UPDATE orders o SET cashier_id = a.actor_id
  FROM (SELECT DISTINCT ON (auditable_id) auditable_id, actor_id FROM pos_audit_logs
         WHERE action = 'order.menu_payment_received' AND actor_id IS NOT NULL ORDER BY auditable_id, created_at) a
 WHERE o.id = a.auditable_id AND o.cashier_id IS NULL;
