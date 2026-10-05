import "server-only";

import type { PoolClient } from "pg";

import type { Operator } from "./auth";
import { pool, query, transaction } from "./db";
import { HttpError } from "./http";
import { audit } from "./pos";

// Multi cabang (permintaan owner 4 Okt 2026). Outlet dikelompokkan dalam brand;
// menu dikelola di cabang utama dan disalin ke cabang lain (tautan source_*),
// sementara harga khusus, ketersediaan, stok, meja, promo, shift, dan tablet
// tetap milik tiap cabang. Semua data operasional tetap dibatasi outlet_key.

export type MenuMode = { kind: "single" | "main" | "branch"; brandKey: string | null; brandName: string | null; mainOutletKey: string | null; mainName: string | null; outlets: number };

export async function menuMode(outletKey: string, client: Pick<PoolClient, "query"> = pool): Promise<MenuMode> {
  const row = (await client.query<{ brand_key: string | null; brand_name: string | null; main_outlet_key: string | null; main_name: string | null; outlets: number }>(
    `SELECT b.brand_key, b.name AS brand_name, b.main_outlet_key, coalesce(m.public_name, m.name) AS main_name,
            (SELECT count(*)::int FROM outlets x WHERE x.brand_key = b.brand_key AND x.is_active) AS outlets
       FROM outlets o LEFT JOIN brands b ON b.brand_key = o.brand_key LEFT JOIN outlets m ON m.outlet_key = b.main_outlet_key
      WHERE o.outlet_key = $1`, [outletKey])).rows[0];
  const outlets = row?.outlets ?? 1;
  const kind = !row?.brand_key || outlets <= 1 ? "single" : row.main_outlet_key === outletKey ? "main" : "branch";
  return { kind, brandKey: row?.brand_key ?? null, brandName: row?.brand_name ?? null, mainOutletKey: row?.main_outlet_key ?? null, mainName: row?.main_name ?? null, outlets };
}

// Struktur menu (kategori, produk baru, opsi, impor, hapus) hanya diubah di
// cabang utama; cabang lain mengatur harga khusus, status, dan stok sendiri.
export async function assertMenuEditable(outletKey: string) {
  const mode = await menuMode(outletKey);
  if (mode.kind === "branch") throw new HttpError(422, `The menu is managed at ${mode.mainName ?? "the main branch"}. Change it there and every branch updates. Here you can set this branch's price, status and stock.`);
}

// Menyalin menu cabang utama ke satu cabang. Idempoten: dicocokkan lewat
// source_*; produk cabang dengan nama sama yang belum bertaut diadopsi; produk
// yang hilang dari cabang utama disembunyikan (pesanan lama tetap merujuknya).
export async function syncOutletMenu(client: PoolClient, source: string, target: string) {
  const categories = await client.query<{ id: string; name: string; sort_order: number }>("SELECT id::text, name, sort_order FROM categories WHERE outlet_key = $1", [source]);
  const categoryMap = new Map<string, string>();
  for (const category of categories.rows) {
    // Nama baru bentrok dengan kategori cabang yang tidak bertaut: hanya urutan yang diperbarui.
    const clash = (await client.query("SELECT 1 FROM categories WHERE outlet_key = $1 AND name = $2 AND source_category_id IS DISTINCT FROM $3",
      [target, category.name, category.id])).rowCount;
    const linked = clash
      ? await client.query<{ id: string }>("UPDATE categories SET sort_order = $3, updated_at = now() WHERE outlet_key = $1 AND source_category_id = $2 RETURNING id::text",
        [target, category.id, category.sort_order])
      : await client.query<{ id: string }>("UPDATE categories SET name = $3, sort_order = $4, updated_at = now() WHERE outlet_key = $1 AND source_category_id = $2 RETURNING id::text",
        [target, category.id, category.name, category.sort_order]);
    let id = linked.rows[0]?.id;
    if (!id) {
      id = (await client.query<{ id: string }>(
        `INSERT INTO categories(outlet_key, name, sort_order, source_category_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (outlet_key, name) DO UPDATE SET source_category_id = EXCLUDED.source_category_id, sort_order = EXCLUDED.sort_order, updated_at = now()
         RETURNING id::text`, [target, category.name, category.sort_order, category.id])).rows[0].id;
    }
    categoryMap.set(category.id, id);
  }

  const products = await client.query<{ id: string; category_id: string; name: string; description: string | null; price: string; availability: string; sort_order: number; is_best_seller: boolean; is_people_love_this: boolean; cost_price: string | null; photo: string | null }>(
    `SELECT p.id, p.category_id::text, p.name, p.description, p.price::text, p.availability, p.sort_order, p.is_best_seller, p.is_people_love_this, p.cost_price::text,
            (SELECT url FROM product_photos WHERE product_id = p.id ORDER BY is_primary DESC, id LIMIT 1) AS photo
       FROM products p WHERE p.outlet_key = $1`, [source]);
  for (const product of products.rows) {
    const category = categoryMap.get(product.category_id);
    if (!category) continue;
    let targetId = (await client.query<{ id: string }>("SELECT id FROM products WHERE outlet_key = $1 AND source_product_id = $2", [target, product.id])).rows[0]?.id;
    if (!targetId) {
      targetId = (await client.query<{ id: string }>(
        "UPDATE products SET source_product_id = $2 WHERE id = (SELECT id FROM products WHERE outlet_key = $1 AND source_product_id IS NULL AND lower(name) = lower($3) LIMIT 1) RETURNING id",
        [target, product.id, product.name])).rows[0]?.id;
    }
    if (targetId) {
      await client.query(
        `UPDATE products SET category_id = $2, name = $3, description = $4, sort_order = $5, is_best_seller = $6, is_people_love_this = $7, cost_price = $8,
            price = CASE WHEN price_override THEN price ELSE $9 END,
            availability = CASE WHEN $10 = 'hidden' THEN 'hidden' WHEN availability = 'hidden' THEN $10 ELSE availability END, updated_at = now()
          WHERE id = $1`,
        [targetId, category, product.name, product.description, product.sort_order, product.is_best_seller, product.is_people_love_this, product.cost_price, product.price, product.availability]);
    } else {
      targetId = `${product.id}~${target}`.slice(0, 120);
      await client.query(
        `INSERT INTO products(id, outlet_key, category_id, name, description, price, availability, sort_order, is_best_seller, is_people_love_this, cost_price, source_product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [targetId, target, category, product.name, product.description, product.price, product.availability, product.sort_order, product.is_best_seller, product.is_people_love_this, product.cost_price, product.id]);
    }
    const photo = (await client.query<{ url: string }>("SELECT url FROM product_photos WHERE product_id = $1 ORDER BY is_primary DESC, id LIMIT 1", [targetId])).rows[0]?.url ?? null;
    if (photo !== product.photo) {
      await client.query("DELETE FROM product_photos WHERE product_id = $1", [targetId]);
      if (product.photo) await client.query("INSERT INTO product_photos(product_id, url, is_primary) VALUES ($1, $2, true)", [targetId, product.photo]);
    }

    // Opsi produk dicerminkan penuh dari cabang utama.
    const groups = await client.query<{ id: string; name: string; is_required: boolean; min_select: number; max_select: number; sort_order: number }>(
      "SELECT id::text, name, is_required, min_select, max_select, sort_order FROM product_modifier_groups WHERE product_id = $1", [product.id]);
    await client.query("DELETE FROM product_modifier_groups WHERE product_id = $1 AND (source_group_id IS NULL OR NOT (source_group_id = ANY($2::bigint[])))", [targetId, groups.rows.map((group) => group.id)]);
    for (const group of groups.rows) {
      let groupId = (await client.query<{ id: string }>(
        "UPDATE product_modifier_groups SET name = $3, is_required = $4, min_select = $5, max_select = $6, sort_order = $7, updated_at = now() WHERE product_id = $1 AND source_group_id = $2 RETURNING id::text",
        [targetId, group.id, group.name, group.is_required, group.min_select, group.max_select, group.sort_order])).rows[0]?.id;
      if (!groupId) {
        groupId = (await client.query<{ id: string }>(
          "INSERT INTO product_modifier_groups(product_id, name, is_required, min_select, max_select, sort_order, source_group_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text",
          [targetId, group.name, group.is_required, group.min_select, group.max_select, group.sort_order, group.id])).rows[0].id;
      }
      const options = await client.query<{ id: string; name: string; price_delta: string; is_available: boolean; sort_order: number }>(
        "SELECT id::text, name, price_delta::text, is_available, sort_order FROM product_modifier_options WHERE group_id = $1", [group.id]);
      await client.query("DELETE FROM product_modifier_options WHERE group_id = $1 AND (source_option_id IS NULL OR NOT (source_option_id = ANY($2::bigint[])))", [groupId, options.rows.map((option) => option.id)]);
      for (const option of options.rows) {
        const updated = await client.query(
          "UPDATE product_modifier_options SET name = $3, price_delta = $4, is_available = $5, sort_order = $6, updated_at = now() WHERE group_id = $1 AND source_option_id = $2",
          [groupId, option.id, option.name, option.price_delta, option.is_available, option.sort_order]);
        if (!updated.rowCount) {
          await client.query("INSERT INTO product_modifier_options(group_id, name, price_delta, is_available, sort_order, source_option_id) VALUES ($1,$2,$3,$4,$5,$6)",
            [groupId, option.name, option.price_delta, option.is_available, option.sort_order, option.id]);
        }
      }
    }
  }
  await client.query("UPDATE products SET availability = 'hidden', updated_at = now() WHERE outlet_key = $1 AND source_product_id IS NOT NULL AND NOT (source_product_id = ANY($2::text[]))",
    [target, products.rows.map((product) => product.id)]);
  await client.query(
    `DELETE FROM categories c WHERE c.outlet_key = $1 AND c.source_category_id IS NOT NULL AND NOT (c.source_category_id = ANY($2::bigint[]))
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)`, [target, categories.rows.map((category) => category.id)]);
}

// Dipanggil setelah perubahan menu di cabang utama. Kegagalan tidak membatalkan
// perubahan di cabang utama, tetapi dilaporkan ke pemanggil supaya terlihat.
export async function menuChanged(outletKey: string): Promise<string | null> {
  const mode = await menuMode(outletKey);
  if (mode.kind !== "main" || !mode.brandKey) return null;
  const branches = await query<{ outlet_key: string }>("SELECT outlet_key FROM outlets WHERE brand_key = $1 AND is_active AND outlet_key <> $2", [mode.brandKey, outletKey]);
  try {
    for (const branch of branches.rows) await transaction((client) => syncOutletMenu(client, outletKey, branch.outlet_key));
    return null;
  } catch (error) {
    console.error("branch menu sync failed", outletKey, error);
    return "Saved here, but the other branches couldn't be updated. Save again to retry.";
  }
}

export type BranchOutlet = { outlet_key: string; name: string; address: string | null; is_main: boolean; role: Operator["role"] | null };

// Cabang dalam brand operator, dengan peran operator di masing-masing (null = tanpa akses).
export async function brandOutlets(operator: Operator): Promise<BranchOutlet[]> {
  const result = await query<BranchOutlet>(
    `SELECT o.outlet_key, coalesce(o.public_name, o.name) AS name, o.address, (b.main_outlet_key = o.outlet_key) AS is_main, m.pos_role AS role
       FROM outlets o JOIN outlets mine ON mine.outlet_key = $1 JOIN brands b ON b.brand_key = o.brand_key
       LEFT JOIN outlet_members m ON m.outlet_key = o.outlet_key AND m.user_id = $2
      WHERE o.brand_key = mine.brand_key AND o.is_active
      ORDER BY (b.main_outlet_key = o.outlet_key) DESC, o.created_at, o.outlet_key`, [operator.outletKey, operator.id]);
  return result.rows;
}

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

// Cabang baru (owner): pengaturan usaha disalin dari cabang ini, menu dari
// cabang utama, dan pembuatnya menjadi owner di cabang baru.
export async function createBranch(operator: Operator, input: { name: string; address: string | null; phone: string | null }) {
  return transaction(async (client) => {
    // Outlet yang dibuat setelah migrasi 016 belum punya brand: jadikan brand sendiri.
    await client.query(
      `INSERT INTO brands(brand_key, name, main_outlet_key) SELECT outlet_key, coalesce(public_name, name), outlet_key FROM outlets
        WHERE outlet_key = $1 AND brand_key IS NULL ON CONFLICT (brand_key) DO NOTHING`, [operator.outletKey]);
    await client.query("UPDATE outlets SET brand_key = outlet_key WHERE outlet_key = $1 AND brand_key IS NULL", [operator.outletKey]);
    const home =(await client.query<{ brand_key: string; main_outlet_key: string | null }>(
      "SELECT o.brand_key, b.main_outlet_key FROM outlets o JOIN brands b ON b.brand_key = o.brand_key WHERE o.outlet_key = $1", [operator.outletKey])).rows[0];
    if (!home) throw new HttpError(422, "This outlet isn't part of a brand yet.");
    // Kode outlet: nama cabang, diawali kode brand bila namanya belum memuatnya.
    const brandSlug = slug(home.brand_key);
    const nameSlug = slug(input.name) || "branch";
    const base = (nameSlug.startsWith(brandSlug) ? nameSlug : `${brandSlug}-${nameSlug}`).slice(0, 40);
    let key = base;
    for (let n = 2; (await client.query("SELECT 1 FROM outlets WHERE outlet_key = $1", [key])).rowCount; n += 1) key = `${base}-${n}`;
    await client.query(
      `INSERT INTO outlets(outlet_key, name, public_name, tagline, address, phone, logo_image_url, banner_image_url, opening_hours, tax_rate, timezone, order_modes, android_sync_times, brand_key, menu_payment_methods)
       SELECT $2, $3, $3, tagline, $4, $5, logo_image_url, banner_image_url, opening_hours, tax_rate, timezone, order_modes, android_sync_times, brand_key, ARRAY['cashier']::text[]
         FROM outlets WHERE outlet_key = $1`, [operator.outletKey, key, input.name, input.address, input.phone]);
    await client.query("INSERT INTO user_outlets(user_id, outlet_key, pos_role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING", [operator.id, key]);
    await syncOutletMenu(client, home.main_outlet_key ?? operator.outletKey, key);
    for (const outlet of [operator.outletKey, key]) {
      await audit(client, { outletKey: outlet, actorId: operator.id, action: "outlet.branch_created", type: "outlet", id: key, summary: `Branch ${input.name} (${key}) created.` });
    }
    return key;
  });
}
