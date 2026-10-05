import "server-only";

import type { PoolClient } from "pg";

import type { Operator } from "./auth";
import { menuMode } from "./branches";
import { pool, query, transaction } from "./db";
import { HttpError } from "./http";
import { audit, opaqueToken } from "./pos";
import { unzip, zip } from "./zip";

// Pindah data outlet (permintaan owner 4 Okt 2026): owner mengunduh semua data
// outletnya dalam satu berkas, lalu bisa mengimpornya ke outlet kosong di app
// ini atau di app pengganti. Formatnya stabil dan berversi:
//   manifest.json            { format, version, exportedAt, schema, outlet, counts }
//   data/<tabel>.json        baris tabel apa adanya (JSON dari Postgres)
// Tidak ikut: kata sandi, PIN, token tablet dan sesi, berkas Ask Eline, batas
// laju. Foto tetap berupa URL publik. Akun orang dibuat lewat Studio, jadi
// riwayat dicocokkan ke anggota outlet tujuan lewat email.
export const EXPORT_FORMAT = "mangalli-outlet-export";
export const EXPORT_VERSION = 1;

const tables: Array<[name: string, sql: string]> = [
  ["outlet", "SELECT * FROM outlets WHERE outlet_key = $1"],
  ["team", `SELECT u.id, u.name, u.email, m.pos_role, u.is_active, m.is_home FROM outlet_members m JOIN users u ON u.id = m.user_id
             WHERE m.outlet_key = $1 ORDER BY u.id`],
  ["categories", "SELECT * FROM categories WHERE outlet_key = $1 ORDER BY id"],
  ["products", "SELECT * FROM products WHERE outlet_key = $1 ORDER BY id"],
  ["product_photos", "SELECT x.* FROM product_photos x JOIN products p ON p.id = x.product_id WHERE p.outlet_key = $1 ORDER BY x.id"],
  ["product_modifier_groups", "SELECT x.* FROM product_modifier_groups x JOIN products p ON p.id = x.product_id WHERE p.outlet_key = $1 ORDER BY x.id"],
  ["product_modifier_options", `SELECT x.* FROM product_modifier_options x JOIN product_modifier_groups g ON g.id = x.group_id
                                 JOIN products p ON p.id = g.product_id WHERE p.outlet_key = $1 ORDER BY x.id`],
  ["qr_tables", "SELECT * FROM qr_tables WHERE outlet_key = $1 ORDER BY id"],
  ["promotions", "SELECT * FROM promotions WHERE outlet_key = $1 ORDER BY id"],
  ["expenses", "SELECT * FROM expenses WHERE outlet_key = $1 ORDER BY id"],
  ["pos_shifts", "SELECT * FROM pos_shifts WHERE outlet_key = $1 ORDER BY id"],
  ["shift_cash_movements", "SELECT * FROM shift_cash_movements WHERE outlet_key = $1 ORDER BY id"],
  ["pos_cash_handovers", "SELECT * FROM pos_cash_handovers WHERE outlet_key = $1 ORDER BY id"],
  ["orders", "SELECT * FROM orders WHERE outlet_key = $1 ORDER BY id"],
  ["order_items", "SELECT x.* FROM order_items x JOIN orders o ON o.id = x.order_id WHERE o.outlet_key = $1 ORDER BY x.id"],
  ["payments", "SELECT x.* FROM payments x JOIN orders o ON o.id = x.order_id WHERE o.outlet_key = $1 ORDER BY x.id"],
  ["pos_audit_logs", "SELECT * FROM pos_audit_logs WHERE outlet_key = $1 ORDER BY id"],
  ["support_reports", "SELECT * FROM support_reports WHERE outlet_key = $1 ORDER BY id"],
];

export async function exportOutlet(operator: Operator): Promise<{ file: Buffer; name: string }> {
  const files: Array<{ name: string; data: Buffer }> = [];
  const counts: Record<string, number> = {};
  const client = await pool.connect();
  try {
    // Satu snapshot yang konsisten untuk semua tabel.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const [name, sql] of tables) {
      const result = await client.query<{ rows: string; count: number }>(`SELECT coalesce(json_agg(t), '[]')::text AS rows, count(*)::int AS count FROM (${sql}) t`, [operator.outletKey]);
      counts[name] = result.rows[0].count;
      files.push({ name: `data/${name}.json`, data: Buffer.from(result.rows[0].rows) });
    }
    const schema = (await client.query<{ name: string }>("SELECT max(name) AS name FROM schema_migrations")).rows[0]?.name ?? null;
    await client.query("COMMIT");
    await audit(client, { outletKey: operator.outletKey, actorId: operator.id, action: "outlet.data_exported", summary: "All outlet data downloaded." });
    const outlet = (JSON.parse(files[0].data.toString()) as Array<{ outlet_key: string; name: string }>)[0];
    const manifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), schema, outlet: { key: outlet.outlet_key, name: outlet.name }, counts };
    files.unshift({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const date = new Date().toLocaleDateString("en-CA", { timeZone: operator.timezone });
  return { file: zip(files, true), name: `mangalli-${operator.outletKey}-${date}.zip` };
}

type Row = Record<string, unknown>;
const columnsCache = new Map<string, Set<string>>();

async function tableColumns(client: PoolClient, table: string): Promise<Set<string>> {
  if (!columnsCache.has(table)) {
    const result = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]);
    columnsCache.set(table, new Set(result.rows.map((row) => row.column_name)));
  }
  return columnsCache.get(table)!;
}

// Sisipkan satu baris lewat json_populate_record: Postgres sendiri yang
// mengubah JSON ke tipe kolom. Hanya kolom yang ada di berkas dan di tabel
// yang diisi, jadi kolom baru memakai nilai bawaannya. `id` lama dibuang
// kecuali keepId (id teks produk).
async function insertRow(client: PoolClient, table: string, row: Row, keepId = false): Promise<string> {
  const columns = await tableColumns(client, table);
  const names = Object.keys(row).filter((name) => columns.has(name) && (keepId || name !== "id")).map((name) => `"${name}"`).join(", ");
  const result = await client.query<{ id: string }>(
    `INSERT INTO ${table} (${names}) SELECT ${names} FROM json_populate_record(null::${table}, $1::json) RETURNING id::text`, [JSON.stringify(row)]);
  return result.rows[0].id;
}

async function taken(client: PoolClient, table: string, column: string, value: unknown): Promise<boolean> {
  if (value === null || value === undefined) return false;
  return Boolean((await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value])).rowCount);
}

const key = (value: unknown) => (value === null || value === undefined ? null : String(value));

export type ImportSummary = { products: number; orders: number; shifts: number; expenses: number; unmatchedPeople: string[] };

export async function importOutlet(operator: Operator, archive: Buffer): Promise<ImportSummary> {
  let files: Map<string, Buffer>;
  try {
    files = unzip(archive);
  } catch (error) {
    throw new HttpError(422, error instanceof Error && error.message === "The file is too large." ? error.message : "This isn't a Mangalli data file.");
  }
  const read = (name: string): Row[] => {
    const file = files.get(`data/${name}.json`);
    if (!file) return [];
    const rows = JSON.parse(file.toString("utf8")) as unknown;
    if (!Array.isArray(rows)) throw new HttpError(422, `The ${name} data in this file is damaged.`);
    return rows as Row[];
  };
  const manifest = (() => {
    try { return JSON.parse(files.get("manifest.json")?.toString("utf8") ?? "null") as { format?: string; version?: number } | null; } catch { return null; }
  })();
  if (manifest?.format !== EXPORT_FORMAT) throw new HttpError(422, "This isn't a Mangalli data file.");
  if (!Number.isInteger(manifest.version) || manifest.version! > EXPORT_VERSION) throw new HttpError(422, "This file comes from a newer Mangalli. Update this dashboard first.");
  if ((await menuMode(operator.outletKey)).kind !== "single") throw new HttpError(422, "Import into an outlet that isn't part of a multi-branch brand.");
  const shifts = read("pos_shifts");
  if (shifts.some((shift) => shift.status === "open")) throw new HttpError(422, "This file has an open shift. Close every shift on the tablet, sync, and download the data again.");

  return transaction(async (client) => {
    const target = operator.outletKey;
    // Hanya ke outlet yang masih kosong, supaya data tidak pernah tercampur.
    const existing = (await client.query<{ busy: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM orders WHERE outlet_key = $1) OR EXISTS (SELECT 1 FROM products WHERE outlet_key = $1)
           OR EXISTS (SELECT 1 FROM categories WHERE outlet_key = $1) AS busy`, [target])).rows[0];
    if (existing.busy) throw new HttpError(422, "Import only works into an outlet with no menu and no orders yet.");

    // Orang: dicocokkan ke anggota outlet tujuan lewat email; selain itu kosong.
    const members = new Map((await client.query<{ id: string; email: string }>(
      "SELECT u.id::text, lower(u.email) AS email FROM outlet_members m JOIN users u ON u.id = m.user_id WHERE m.outlet_key = $1", [target])).rows.map((row) => [row.email, row.id]));
    const people = new Map<string, string | null>();
    const unmatchedPeople: string[] = [];
    for (const person of read("team")) {
      const match = members.get(String(person.email ?? "").toLowerCase()) ?? null;
      people.set(String(person.id), match);
      if (!match) unmatchedPeople.push(String(person.name ?? person.email));
    }
    const person = (value: unknown) => people.get(key(value) ?? "") ?? null;

    // Pengaturan usaha. menu_url hanya diisi bila outlet tujuan belum punya.
    const outlet = read("outlet")[0];
    if (outlet) {
      await client.query(
        // coalesce: berkas lama tanpa kolom tertentu tidak mengosongkan pengaturan.
        `UPDATE outlets o SET public_name = coalesce(s.public_name, o.public_name), tagline = coalesce(s.tagline, o.tagline), address = coalesce(s.address, o.address), phone = coalesce(s.phone, o.phone), logo_image_url = coalesce(s.logo_image_url, o.logo_image_url), banner_image_url = coalesce(s.banner_image_url, o.banner_image_url), opening_hours = coalesce(s.opening_hours, o.opening_hours), menu_payment_methods = coalesce(s.menu_payment_methods, o.menu_payment_methods), qris_payload = coalesce(s.qris_payload, o.qris_payload), android_sync_times = coalesce(s.android_sync_times, o.android_sync_times), tax_rate = coalesce(s.tax_rate, o.tax_rate), timezone = coalesce(s.timezone, o.timezone), order_modes = coalesce(s.order_modes, o.order_modes),
           menu_url = coalesce(o.menu_url, s.menu_url), updated_at = now()
           FROM json_populate_record(null::outlets, $2::json) s WHERE o.outlet_key = $1`, [target, JSON.stringify(outlet)]);
    }

    const categories = new Map<string, string>();
    for (const row of read("categories")) categories.set(String(row.id), await insertRow(client, "categories", { ...row, outlet_key: target, source_category_id: null }));
    const products = new Map<string, string>();
    for (const row of read("products")) {
      let id = String(row.id);
      for (let n = 0; await taken(client, "products", "id", id); n += 1) id = `${row.id}~${target}${n ? `-${n}` : ""}`;
      await insertRow(client, "products", { ...row, id, outlet_key: target, category_id: categories.get(String(row.category_id)) ?? null, source_product_id: null, price_override: false }, true);
      products.set(String(row.id), id);
    }
    for (const row of read("product_photos")) {
      const product = products.get(String(row.product_id));
      if (product) await insertRow(client, "product_photos", { ...row, product_id: product });
    }
    const groups = new Map<string, string>();
    for (const row of read("product_modifier_groups")) {
      const product = products.get(String(row.product_id));
      if (product) groups.set(String(row.id), await insertRow(client, "product_modifier_groups", { ...row, product_id: product, source_group_id: null }));
    }
    for (const row of read("product_modifier_options")) {
      const group = groups.get(String(row.group_id));
      if (group) await insertRow(client, "product_modifier_options", { ...row, group_id: group, source_option_id: null });
    }
    for (const row of read("qr_tables")) {
      const token = (await taken(client, "qr_tables", "qr_token", row.qr_token)) ? opaqueToken("qr_") : row.qr_token;
      await insertRow(client, "qr_tables", { ...row, outlet_key: target, qr_token: token });
    }
    const promotions = new Map<string, string>();
    const mapIds = (values: unknown, map: Map<string, string>) => (Array.isArray(values) ? values.map((value) => map.get(String(value))).filter(Boolean) : values);
    for (const row of read("promotions")) {
      promotions.set(String(row.id), await insertRow(client, "promotions", {
        ...row, outlet_key: target, category_ids: mapIds(row.category_ids, categories), product_ids: mapIds(row.product_ids, products),
      }));
    }
    const shiftIds = new Map<string, string>();
    for (const row of shifts) {
      shiftIds.set(String(row.id), await insertRow(client, "pos_shifts", { ...row, outlet_key: target, device_id: null, opened_by: person(row.opened_by), closed_by: person(row.closed_by) }));
    }
    for (const row of read("shift_cash_movements")) {
      const shift = shiftIds.get(String(row.shift_id));
      if (shift) await insertRow(client, "shift_cash_movements", { ...row, outlet_key: target, shift_id: shift, created_by: person(row.created_by), approved_by: person(row.approved_by) });
    }
    for (const row of read("pos_cash_handovers")) {
      await insertRow(client, "pos_cash_handovers", {
        ...row, outlet_key: target, shift_id: shiftIds.get(String(row.shift_id)) ?? null, created_by: person(row.created_by), approval_by: person(row.approval_by),
      });
    }
    const orders = new Map<string, string>();
    for (const row of read("orders")) {
      let code = row.order_code;
      for (let n = 1; await taken(client, "orders", "order_code", code); n += 1) code = `${row.order_code}-${n}`;
      const token = (await taken(client, "orders", "public_token", row.public_token)) ? opaqueToken("") : row.public_token;
      orders.set(String(row.id), await insertRow(client, "orders", {
        ...row, outlet_key: target, order_code: code, public_token: token, device_id: null, shift_id: shiftIds.get(String(row.shift_id)) ?? null,
        voided_by: person(row.voided_by), promotion_id: promotions.get(String(row.promotion_id)) ?? null,
      }));
    }
    for (const row of read("order_items")) {
      const order = orders.get(String(row.order_id));
      if (!order) continue;
      const product = products.get(String(row.product_id)) ?? null;
      // Item lama tanpa harga modal tetap tanpa (laporan memakai harga modal
      // produk saat ini); trigger hanya mengisi saat INSERT, jadi produk
      // disambungkan sesudahnya.
      const keepCostEmpty = row.unit_cost === null && product !== null;
      const id = await insertRow(client, "order_items", { ...row, order_id: order, product_id: keepCostEmpty ? null : product });
      if (keepCostEmpty) await client.query("UPDATE order_items SET product_id = $1 WHERE id = $2", [product, id]);
    }
    for (const row of read("payments")) {
      const order = orders.get(String(row.order_id));
      const transactionId = (await taken(client, "payments", "transaction_id", row.transaction_id)) ? null : row.transaction_id;
      if (order) await insertRow(client, "payments", { ...row, order_id: order, transaction_id: transactionId, refunded_by: person(row.refunded_by) });
    }
    const expenses = read("expenses");
    for (const row of expenses) await insertRow(client, "expenses", { ...row, outlet_key: target, created_by: person(row.created_by) });
    // Jejak audit lama ikut; rujukan ke baris yang dipindah diganti id barunya.
    const auditMaps: Record<string, Map<string, string>> = { order: orders, shift: shiftIds, promotion: promotions, category: categories };
    for (const row of read("pos_audit_logs")) {
      const map = auditMaps[String(row.auditable_type)];
      await insertRow(client, "pos_audit_logs", {
        ...row, outlet_key: target, actor_id: person(row.actor_id), approved_by: person(row.approved_by), auditable_id: map ? map.get(String(row.auditable_id)) ?? null : null,
      });
    }
    for (const row of read("support_reports")) {
      await insertRow(client, "support_reports", { ...row, outlet_key: target, device_id: null, reported_by: person(row.reported_by), resolved_by: person(row.resolved_by) });
    }
    const summary = { products: products.size, orders: orders.size, shifts: shiftIds.size, expenses: expenses.length, unmatchedPeople };
    await audit(client, {
      outletKey: target, actorId: operator.id, action: "outlet.data_imported",
      summary: `Data imported: ${summary.products} products, ${summary.orders} orders, ${summary.shifts} shifts, ${summary.expenses} expenses.`,
      metadata: { from: (manifest as { outlet?: unknown }).outlet ?? null, unmatchedPeople },
    });
    return summary;
  });
}

// Untuk panel di Outlet settings: apakah outlet ini masih kosong (boleh impor).
export async function outletIsEmpty(outletKey: string): Promise<boolean> {
  const result = await query<{ empty: boolean }>(
    `SELECT NOT (EXISTS (SELECT 1 FROM orders WHERE outlet_key = $1) OR EXISTS (SELECT 1 FROM products WHERE outlet_key = $1)
         OR EXISTS (SELECT 1 FROM categories WHERE outlet_key = $1)) AS empty`, [outletKey]);
  return result.rows[0]?.empty ?? false;
}
