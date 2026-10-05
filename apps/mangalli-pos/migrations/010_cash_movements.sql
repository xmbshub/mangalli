-- Cash in/out laci di luar penjualan (mis. beli galon, tambah uang kecil),
-- dicatat di tablet per shift. Kas seharusnya = kas awal + penjualan tunai
-- + cash in - cash out. Cash out oleh kasir disetujui manager/owner (PIN).
CREATE TABLE IF NOT EXISTS shift_cash_movements (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  shift_id bigint NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  local_uuid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  approved_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (shift_id, local_uuid)
);
CREATE INDEX IF NOT EXISTS shift_cash_movements_shift_idx ON shift_cash_movements(shift_id);
