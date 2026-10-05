-- Multi cabang (permintaan owner 4 Okt 2026): outlet dikelompokkan dalam brand.
-- Menu dikelola di cabang utama dan disalin ke cabang lain; tiap cabang tetap
-- punya harga khusus, ketersediaan, stok, meja, promo, shift, dan tabletnya sendiri.
CREATE TABLE IF NOT EXISTS brands (
  brand_key text PRIMARY KEY,
  name text NOT NULL,
  main_outlet_key text REFERENCES outlets(outlet_key) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS brand_key text REFERENCES brands(brand_key) ON DELETE SET NULL;
INSERT INTO brands(brand_key, name, main_outlet_key)
  SELECT outlet_key, coalesce(public_name, name), outlet_key FROM outlets WHERE brand_key IS NULL ON CONFLICT (brand_key) DO NOTHING;
UPDATE outlets SET brand_key = outlet_key WHERE brand_key IS NULL;

-- Akses ke cabang lain dalam brand yang sama, dengan peran di cabang itu.
-- Cabang asal tetap users.outlet_key; identitas pusat tetap satu users.id.
CREATE TABLE IF NOT EXISTS user_outlets (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_key text NOT NULL REFERENCES outlets(outlet_key) ON DELETE CASCADE,
  pos_role text NOT NULL CHECK (pos_role IN ('owner', 'manager', 'staff', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, outlet_key)
);

-- Tautan menu cabang ke menu cabang utama, dan harga khusus per cabang.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS source_category_id bigint;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_product_id text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_override boolean NOT NULL DEFAULT false;
ALTER TABLE product_modifier_groups ADD COLUMN IF NOT EXISTS source_group_id bigint;
ALTER TABLE product_modifier_options ADD COLUMN IF NOT EXISTS source_option_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS categories_source_idx ON categories(outlet_key, source_category_id) WHERE source_category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_source_idx ON products(outlet_key, source_product_id) WHERE source_product_id IS NOT NULL;

-- Anggota per outlet: anggota asal plus akses cabang. Akses hanya berlaku ke
-- outlet dalam brand yang sama dengan outlet asal, dijaga di sini supaya baris
-- user_outlets lintas brand tidak pernah memberi akses.
CREATE OR REPLACE VIEW outlet_members AS
  SELECT u.id AS user_id, u.outlet_key, u.pos_role, true AS is_home FROM users u WHERE u.outlet_key IS NOT NULL
  UNION ALL
  SELECT uo.user_id, uo.outlet_key, uo.pos_role, false AS is_home
    FROM user_outlets uo JOIN users u ON u.id = uo.user_id
    JOIN outlets target ON target.outlet_key = uo.outlet_key JOIN outlets home ON home.outlet_key = u.outlet_key
   WHERE target.brand_key IS NOT NULL AND target.brand_key = home.brand_key AND uo.outlet_key <> u.outlet_key;
