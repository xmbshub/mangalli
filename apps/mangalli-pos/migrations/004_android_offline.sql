-- Android POS offline-first: tablet kasir adalah sumber kebenaran operasional.
-- Pesanan dan shift dibuat di tablet (tanpa internet) lalu dikirim sebagai
-- snapshot saat sinkron. Kunci (device_id, local_uuid) membuat pengiriman
-- ulang aman: snapshot yang sama atau lebih baru hanya memperbarui baris.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_id bigint REFERENCES android_pos_devices(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS local_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_device_local_uuid_idx ON orders(device_id, local_uuid) WHERE local_uuid IS NOT NULL;

ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS device_id bigint REFERENCES android_pos_devices(id) ON DELETE SET NULL;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS local_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_device_local_uuid_idx ON pos_shifts(device_id, local_uuid) WHERE local_uuid IS NOT NULL;
-- Satu shift terbuka per sumber: dashboard web (device_id kosong) dan setiap
-- tablet. Shift tablet dibuka offline, jadi tidak boleh ditolak hanya karena
-- dashboard masih punya shift terbuka.
DROP INDEX IF EXISTS pos_shifts_one_open_per_outlet_idx;
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_source_idx ON pos_shifts(outlet_key, coalesce(device_id, 0)) WHERE status = 'open';

-- Jam sinkron otomatis tablet (waktu lokal outlet, HH:MM), diatur owner di dashboard.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS android_sync_times text[] NOT NULL DEFAULT ARRAY['11:00', '15:00', '19:00', '23:00']::text[];
