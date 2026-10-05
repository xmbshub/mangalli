-- Aturan bisnis per outlet, supaya satu Mangalli melayani banyak jenis F&B:
-- UMKM tanpa pajak (0%) sampai restoran PB1 10%, outlet di WIB/WITA/WIT, dan
-- outlet yang hanya melayani takeaway (food truck, bakery, kios).
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tax_rate numeric(5,4) NOT NULL DEFAULT 0.10;
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_tax_rate_check;
ALTER TABLE outlets ADD CONSTRAINT outlets_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 0.25);

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Makassar';
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_timezone_check;
ALTER TABLE outlets ADD CONSTRAINT outlets_timezone_check CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'));

-- Jenis pesanan yang ditawarkan menu digital. Kasir di tablet tetap bebas memilih.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS order_modes text[] NOT NULL DEFAULT ARRAY['dinein', 'takeaway']::text[];
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_order_modes_check;
ALTER TABLE outlets ADD CONSTRAINT outlets_order_modes_check
  CHECK (cardinality(order_modes) >= 1 AND order_modes <@ ARRAY['dinein', 'takeaway']::text[]);
