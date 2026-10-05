CREATE TABLE IF NOT EXISTS outlets (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL UNIQUE,
  name text NOT NULL,
  public_name text,
  tagline text,
  address text,
  phone text,
  logo_image_url text,
  banner_image_url text,
  opening_hours jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  outlet_key text REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  pos_role text NOT NULL DEFAULT 'viewer' CHECK (pos_role IN ('owner', 'manager', 'staff', 'viewer')),
  approval_pin_hash text,
  is_active boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_outlet_role_idx ON users(outlet_key, pos_role);

CREATE TABLE IF NOT EXISTS categories (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outlet_key, name)
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'unavailable', 'hidden')),
  sort_order integer NOT NULL DEFAULT 0,
  is_best_seller boolean NOT NULL DEFAULT false,
  is_people_love_this boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_outlet_sort_idx ON products(outlet_key, availability, sort_order);

CREATE TABLE IF NOT EXISTS product_photos (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= min_select),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_modifier_options (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES product_modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(14,2) NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qr_tables (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  qr_token text NOT NULL UNIQUE,
  table_code text NOT NULL,
  table_label text NOT NULL,
  table_area text NOT NULL DEFAULT 'indoor' CHECK (table_area IN ('indoor', 'outdoor', 'vip', 'bar', 'other')),
  pax_capacity integer CHECK (pax_capacity IS NULL OR pax_capacity > 0),
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outlet_key, table_code)
);

CREATE TABLE IF NOT EXISTS pos_shifts (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by bigint REFERENCES users(id) ON DELETE SET NULL,
  closed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_cash numeric(14,2) NOT NULL DEFAULT 0,
  expected_cash numeric(14,2) NOT NULL DEFAULT 0,
  actual_cash numeric(14,2),
  cash_difference numeric(14,2) NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  cash_payment_total numeric(14,2) NOT NULL DEFAULT 0,
  digital_payment_total numeric(14,2) NOT NULL DEFAULT 0,
  pending_payment_total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_outlet_idx ON pos_shifts(outlet_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS pos_shifts_outlet_date_idx ON pos_shifts(outlet_key, business_date DESC);

CREATE TABLE IF NOT EXISTS orders (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  shift_id bigint REFERENCES pos_shifts(id) ON DELETE SET NULL,
  order_code text UNIQUE,
  public_token text NOT NULL UNIQUE,
  business_date date,
  customer_name text,
  customer_phone text,
  customer_email text,
  order_mode text NOT NULL DEFAULT 'dinein' CHECK (order_mode IN ('dinein', 'takeaway')),
  table_number integer NOT NULL DEFAULT 0,
  table_code text,
  table_label text,
  pickup_name text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  restaurant_status text NOT NULL DEFAULT 'new' CHECK (restaurant_status IN ('new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  voided_at timestamptz,
  voided_by bigint REFERENCES users(id) ON DELETE SET NULL,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_outlet_queue_idx ON orders(outlet_key, restaurant_status, created_at);
CREATE INDEX IF NOT EXISTS orders_shift_idx ON orders(shift_id);

CREATE TABLE IF NOT EXISTS order_items (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  item_type text NOT NULL DEFAULT 'product' CHECK (item_type IN ('product', 'custom_amount')),
  item_name text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  modifier_total numeric(14,2) NOT NULL DEFAULT 0,
  selected_modifier_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  modifier_summary text,
  notes text,
  send_to_kitchen boolean NOT NULL DEFAULT true,
  kitchen_printed_quantity integer NOT NULL DEFAULT 0 CHECK (kitchen_printed_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired', 'cancelled', 'refunded')),
  payment_method text,
  transaction_id text UNIQUE,
  paid_at timestamptz,
  notes text,
  refunded_at timestamptz,
  refunded_by bigint REFERENCES users(id) ON DELETE SET NULL,
  refund_amount numeric(14,2),
  refund_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_audit_logs (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  actor_id bigint REFERENCES users(id) ON DELETE SET NULL,
  approved_by bigint REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  auditable_type text,
  auditable_id bigint,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_audit_logs_outlet_created_idx ON pos_audit_logs(outlet_key, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_cash_handovers (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  shift_id bigint REFERENCES pos_shifts(id) ON DELETE SET NULL,
  handed_over_by text,
  received_by text NOT NULL,
  system_cash numeric(14,2) NOT NULL DEFAULT 0,
  counted_cash numeric(14,2) NOT NULL DEFAULT 0,
  cash_difference numeric(14,2) NOT NULL DEFAULT 0,
  active_order_count integer NOT NULL DEFAULT 0,
  pending_payment_count integer NOT NULL DEFAULT 0,
  pending_payment_total numeric(14,2) NOT NULL DEFAULT 0,
  open_bill_count integer NOT NULL DEFAULT 0,
  notes text,
  approval_by bigint REFERENCES users(id) ON DELETE SET NULL,
  approval_reason text,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS android_pos_devices (
  id bigserial PRIMARY KEY,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  device_key text NOT NULL,
  label text,
  token_digest text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outlet_key, device_key)
);

CREATE TABLE IF NOT EXISTS android_pos_staff_sessions (
  id bigserial PRIMARY KEY,
  device_id bigint NOT NULL REFERENCES android_pos_devices(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  token_digest text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, user_id)
);

CREATE TABLE IF NOT EXISTS android_pos_sync_events (
  id bigserial PRIMARY KEY,
  device_id bigint NOT NULL REFERENCES android_pos_devices(id) ON DELETE CASCADE,
  staff_session_id bigint NOT NULL REFERENCES android_pos_staff_sessions(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE RESTRICT,
  local_uuid text NOT NULL,
  idempotency_key text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'accepted',
  payload jsonb NOT NULL,
  order_id bigint REFERENCES orders(id) ON DELETE SET NULL,
  payment_id bigint REFERENCES payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS android_sync_device_local_idx ON android_pos_sync_events(device_id, local_uuid);
