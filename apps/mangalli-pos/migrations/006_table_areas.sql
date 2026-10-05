-- Area meja bebas diberi nama oleh outlet (Lantai 2, Rooftop, Smoking),
-- tidak lagi terbatas lima pilihan tetap. Nilai lama diubah jadi label.
ALTER TABLE qr_tables DROP CONSTRAINT IF EXISTS qr_tables_table_area_check;
UPDATE qr_tables SET table_area = CASE table_area
  WHEN 'indoor' THEN 'Indoor'
  WHEN 'outdoor' THEN 'Outdoor'
  WHEN 'vip' THEN 'VIP'
  WHEN 'bar' THEN 'Bar'
  WHEN 'other' THEN 'Other'
  ELSE table_area END;
ALTER TABLE qr_tables ALTER COLUMN table_area SET DEFAULT 'Indoor';
ALTER TABLE qr_tables ADD CONSTRAINT qr_tables_table_area_check CHECK (char_length(btrim(table_area)) BETWEEN 1 AND 40);
