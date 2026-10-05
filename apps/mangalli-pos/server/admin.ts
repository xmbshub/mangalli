import "server-only";

import { query, transaction } from "./db";
import { expireUnpaidOrders } from "./menu-orders";
import type { Operator } from "./auth";
import { availableStockSql } from "./stock";

// Semua query dashboard dibatasi outlet operator. Batas hari dihitung dalam
// zona waktu outlet ($2 = operator.timezone) karena database berjalan dalam UTC.
const localMidnight = (days = 0) => `((date_trunc('day', now() AT TIME ZONE $2) - interval '${days} day') AT TIME ZONE $2)`;

export const kitchenStatuses = ["new", "accepted", "preparing", "ready"] as const;

export async function navCounts(operator: Operator) {
  const result = await query<{ unpaid: string; fresh: string; problems: string }>(
    `SELECT count(*) FILTER (WHERE restaurant_status='pending_payment' AND payment_due_at > now())::text AS unpaid,
            count(*) FILTER (WHERE restaurant_status='new')::text AS fresh,
            (SELECT count(*) FROM support_reports WHERE outlet_key=$1 AND status='open')::text AS problems
       FROM orders WHERE outlet_key=$1 AND restaurant_status IN ('pending_payment','new')`, [operator.outletKey]);
  return { unpaid: Number(result.rows[0]?.unpaid ?? 0), fresh: Number(result.rows[0]?.fresh ?? 0), problems: Number(result.rows[0]?.problems ?? 0) };
}

// Pesanan menu digital yang masuk sesudah kursor `after` (id pesanan, naik
// terus). Tanpa kursor hanya mengembalikan id terakhir, supaya membuka
// dashboard tidak membunyikan pesanan lama.
export async function orderAlerts(operator: Operator, after: string | null) {
  const latest = await query<{ id: string | null }>(
    "SELECT max(id)::text AS id FROM orders WHERE outlet_key=$1 AND channel='menu'", [operator.outletKey]);
  const latestId = latest.rows[0]?.id ?? "0";
  if (after === null || !/^\d+$/.test(after)) return { latestId, orders: [] };
  const rows = await query<{ id: string; order_code: string | null; order_mode: string; table_label: string | null; customer_name: string | null; restaurant_status: string }>(
    `SELECT id::text, order_code, order_mode, table_label, customer_name, restaurant_status FROM orders
      WHERE outlet_key=$1 AND channel='menu' AND id > $2::bigint ORDER BY id LIMIT 20`, [operator.outletKey, after]);
  return {
    latestId,
    orders: rows.rows.map((row) => ({
      id: row.id, code: row.order_code, paid: row.restaurant_status !== "pending_payment",
      where: row.order_mode === "dinein" ? row.table_label ?? "Dine in" : "Takeaway", customer: row.customer_name,
    })),
  };
}

export type SupportRow = {
  id: string; source: string; category: string; title: string; message: string | null; context: Record<string, unknown>;
  occurrences: number; status: string; created_at: Date; last_seen_at: Date; reporter: string | null; resolver: string | null; resolved_at: Date | null;
};

// Laporan masalah outlet. Owner/manager melihat semua; peran lain hanya laporannya sendiri.
export async function supportData(operator: Operator, status: "open" | "resolved", page = 1, pageSize = 25) {
  const mine = operator.role === "owner" || operator.role === "manager" ? null : operator.id;
  const [rows, counts] = await Promise.all([
    query<SupportRow>(
      `SELECT r.id::text, r.source, r.category, r.title, r.message, r.context, r.occurrences, r.status, r.created_at, r.last_seen_at,
         u.name AS reporter, v.name AS resolver, r.resolved_at
       FROM support_reports r LEFT JOIN users u ON u.id=r.reported_by LEFT JOIN users v ON v.id=r.resolved_by
       WHERE r.outlet_key=$1 AND r.status=$2 AND ($3::bigint IS NULL OR r.reported_by=$3)
       ORDER BY r.last_seen_at DESC LIMIT $4 OFFSET $5`, [operator.outletKey, status, mine, pageSize, (page - 1) * pageSize]),
    query<{ status: string; count: string }>(
      `SELECT status, count(*)::text FROM support_reports WHERE outlet_key=$1 AND ($2::bigint IS NULL OR reported_by=$2) GROUP BY status`,
      [operator.outletKey, mine]),
  ]);
  const count = (key: string) => Number(counts.rows.find((row) => row.status === key)?.count ?? 0);
  return { rows: rows.rows, open: count("open"), resolved: count("resolved") };
}

export async function dashboardData(operator: Operator) {
  const args = [operator.outletKey, operator.timezone];
  const paidSince = (days: number) => `FROM orders o JOIN payments p ON p.order_id=o.id
    WHERE o.outlet_key=$1 AND p.status='completed' AND p.paid_at >= ${localMidnight(days)}`;
  const [summary, hours, methods, top, queue, openShift, recent] = await Promise.all([
    query<{ today: string; today_count: string; yesterday_same: string }>(
      `SELECT coalesce(sum(p.amount) FILTER (WHERE p.paid_at >= ${localMidnight()}),0)::text AS today,
              count(*) FILTER (WHERE p.paid_at >= ${localMidnight()})::text AS today_count,
              coalesce(sum(p.amount) FILTER (WHERE p.paid_at < now() - interval '1 day'),0)::text AS yesterday_same
       ${paidSince(1)}`, args),
    query<{ hour: number; total: string }>(
      `SELECT extract(hour FROM p.paid_at AT TIME ZONE $2)::int AS hour, sum(p.amount)::text AS total
       ${paidSince(0)} GROUP BY 1`, args),
    query<{ method: string; total: string; count: string }>(
      `SELECT coalesce(p.payment_method,'other') AS method, sum(p.amount)::text AS total, count(*)::text AS count
       ${paidSince(0)} GROUP BY 1 ORDER BY sum(p.amount) DESC`, args),
    query<{ name: string; qty: string; revenue: string }>(
      `SELECT coalesce(pr.name, i.item_name, 'Item') AS name, sum(i.quantity)::text AS qty,
              sum(i.unit_price*i.quantity)::text AS revenue
       FROM order_items i JOIN orders o ON o.id=i.order_id JOIN payments p ON p.order_id=o.id
       LEFT JOIN products pr ON pr.id=i.product_id
       WHERE o.outlet_key=$1 AND p.status='completed' AND p.paid_at >= ${localMidnight()} AND i.item_type='product'
       GROUP BY 1 ORDER BY sum(i.quantity) DESC LIMIT 5`, args),
    query<{ unpaid: string; kitchen: string; ready: string }>(
      `SELECT count(*) FILTER (WHERE restaurant_status='pending_payment' AND payment_due_at > now())::text AS unpaid,
              count(*) FILTER (WHERE restaurant_status IN ('new','accepted','preparing'))::text AS kitchen,
              count(*) FILTER (WHERE restaurant_status='ready')::text AS ready
       FROM orders WHERE outlet_key=$1 AND restaurant_status IN ('pending_payment','new','accepted','preparing','ready')`, [operator.outletKey]),
    query<{ opened_at: Date; opening_cash: string; order_count: number; cash_payment_total: string; digital_payment_total: string }>(
      `SELECT opened_at,opening_cash::text,order_count,cash_payment_total::text,digital_payment_total::text
       FROM pos_shifts WHERE outlet_key=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1`, [operator.outletKey]),
    query<{ id: string; order_code: string | null; customer_name: string | null; restaurant_status: string; payment_status: string | null; amount: string | null; created_at: Date }>(
      `SELECT o.id::text,o.order_code,o.customer_name,o.restaurant_status,p.status AS payment_status,p.amount::text,o.created_at
       FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.outlet_key=$1 ORDER BY o.created_at DESC LIMIT 6`, [operator.outletKey]),
  ]);
  const row = summary.rows[0];
  const sales = Number(row?.today ?? 0);
  const count = Number(row?.today_count ?? 0);
  const byHour = Array.from({ length: 24 }, (_, hour) => Number(hours.rows.find((item) => item.hour === hour)?.total ?? 0));
  return {
    sales, count, average: count ? sales / count : 0, yesterdaySameTime: Number(row?.yesterday_same ?? 0),
    byHour, methods: methods.rows.map((item) => ({ method: item.method, total: Number(item.total), count: Number(item.count) })),
    top: top.rows.map((item) => ({ name: item.name, qty: Number(item.qty), revenue: Number(item.revenue) })),
    unpaid: Number(queue.rows[0]?.unpaid ?? 0), kitchen: Number(queue.rows[0]?.kitchen ?? 0), ready: Number(queue.rows[0]?.ready ?? 0),
    openShift: openShift.rows[0] ?? null, recent: recent.rows,
  };
}

export const orderTabs = {
  all: null,
  unpaid: ["pending_payment"],
  active: ["new", "accepted", "preparing", "ready"],
  completed: ["completed"],
  cancelled: ["cancelled"],
} as const;
export type OrderTab = keyof typeof orderTabs;

export type OrderRow = {
  id: string; order_code: string | null; customer_name: string | null; order_mode: string; table_label: string | null;
  restaurant_status: string; payment_status: string | null; payment_method: string | null; amount: string | null;
  created_at: Date; payment_due_at: Date | null; pickup_name: string | null; from_tablet: boolean;
};

const orderColumns = `o.id::text,o.order_code,o.customer_name,o.order_mode,o.table_label,o.restaurant_status,
  p.status AS payment_status,p.payment_method,p.amount::text,o.created_at,o.payment_due_at,o.pickup_name,
  (o.device_id IS NOT NULL) AS from_tablet`;

export const orderSorts = { newest: "o.created_at DESC", oldest: "o.created_at ASC", highest: "p.amount DESC NULLS LAST, o.created_at DESC" } as const;
export type OrderSort = keyof typeof orderSorts;
const dateParam = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

// Daftar pesanan per halaman dengan tab status, pencarian, rentang tanggal
// (tanggal lokal outlet), dan urutan.
export async function ordersData(operator: Operator, filters: { tab: OrderTab; search: string; from: string; to: string; sort: OrderSort; page: number; pageSize: number }) {
  await transaction((client) => expireUnpaidOrders(client, operator.outletKey));
  const statuses = orderTabs[filters.tab];
  const where = `o.outlet_key=$1 AND ($2::text[] IS NULL OR o.restaurant_status = ANY($2::text[]))
         AND ($3 = '' OR o.order_code ILIKE '%'||$3||'%' OR o.customer_name ILIKE '%'||$3||'%' OR o.table_label ILIKE '%'||$3||'%')
         AND ($4 = '' OR (o.created_at AT TIME ZONE $6)::date >= $4::date) AND ($5 = '' OR (o.created_at AT TIME ZONE $6)::date <= $5::date)`;
  const args = [operator.outletKey, statuses, filters.search, dateParam(filters.from), dateParam(filters.to), operator.timezone];
  const [rows, counts, total] = await Promise.all([
    query<OrderRow>(
      `SELECT ${orderColumns} FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE ${where}
       ORDER BY ${orderSorts[filters.sort]} LIMIT $7 OFFSET $8`, [...args, filters.pageSize, (filters.page - 1) * filters.pageSize]),
    query<{ unpaid: string; active: string }>(
      `SELECT count(*) FILTER (WHERE restaurant_status='pending_payment')::text AS unpaid,
              count(*) FILTER (WHERE restaurant_status IN ('new','accepted','preparing','ready'))::text AS active
       FROM orders WHERE outlet_key=$1`, [operator.outletKey]),
    query<{ total: string }>(`SELECT count(*)::text AS total FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE ${where}`, args),
  ]);
  return { rows: rows.rows, total: Number(total.rows[0]?.total ?? 0), counts: { unpaid: Number(counts.rows[0]?.unpaid ?? 0), active: Number(counts.rows[0]?.active ?? 0) } };
}

export type OrderItemRow = { order_id: string; name: string; quantity: number; unit_price: string; modifier_summary: string | null; notes: string | null; send_to_kitchen: boolean };

async function itemsFor(orderIds: string[]) {
  if (!orderIds.length) return [];
  return (await query<OrderItemRow>(
    `SELECT order_id::text, coalesce(item_name,'Item') AS name, quantity, unit_price::text, modifier_summary, notes, send_to_kitchen
     FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY id`, [orderIds])).rows;
}

export async function orderDetail(operator: Operator, id: string) {
  if (!/^\d+$/.test(id)) return null;
  const order = (await query<OrderRow & { notes: string | null; void_reason: string | null; paid_at: Date | null; discount_amount: string; discount_label: string | null }>(
    `SELECT ${orderColumns},o.notes,o.void_reason,p.paid_at,o.discount_amount::text,o.discount_label FROM orders o LEFT JOIN payments p ON p.order_id=o.id
     WHERE o.outlet_key=$1 AND o.id=$2`, [operator.outletKey, id])).rows[0];
  if (!order) return null;
  return { order, items: await itemsFor([order.id]) };
}

export async function kitchenData(operator: Operator) {
  const orders = (await query<OrderRow>(
    `SELECT ${orderColumns} FROM orders o LEFT JOIN payments p ON p.order_id=o.id
     WHERE o.outlet_key=$1 AND o.restaurant_status IN ('new','accepted','preparing','ready')
     ORDER BY o.created_at LIMIT 120`, [operator.outletKey])).rows;
  const items = await itemsFor(orders.map((order) => order.id));
  return orders.map((order) => ({ ...order, items: items.filter((item) => item.order_id === order.id && item.send_to_kitchen) }));
}

export type ProductRow = {
  id: string; name: string; description: string | null; price: string; availability: string; category_id: string;
  category_name: string; sort_order: number; image_url: string | null; is_best_seller: boolean; is_people_love_this: boolean;
  modifier_count: number;
  // Sisa stok sekarang (null = tidak dilacak).
  stock: number | null;
  // Harga modal per satuan (null = belum diisi).
  cost_price: string | null;
  // Multi cabang: harga khusus cabang ini dan harga di cabang utama (detail saja).
  price_override?: boolean;
  main_price?: string | null;
};

export const productSorts = {
  menu: { label: "Menu order", sql: "c.sort_order,c.name,p.sort_order,p.name" },
  name: { label: "Name A–Z", sql: "p.name" },
  price_low: { label: "Price: low to high", sql: "p.price,p.name" },
  price_high: { label: "Price: high to low", sql: "p.price DESC,p.name" },
  newest: { label: "Newest first", sql: "p.created_at DESC,p.name" },
} as const;
export type ProductSort = keyof typeof productSorts;

export async function productsData(operator: Operator, filters: { q?: string; category?: string; status?: string; sort?: ProductSort; page?: number; pageSize?: number } = {}) {
  const paged = Boolean(filters.page);
  const [products, categories] = await Promise.all([
    query<ProductRow & { total_count: number }>(
      `SELECT p.id,p.name,p.description,p.price::text,p.cost_price::text,p.availability,p.category_id::text,c.name AS category_name,p.sort_order,
        photo.url AS image_url,p.is_best_seller,p.is_people_love_this,
        (SELECT count(*)::int FROM product_modifier_groups g WHERE g.product_id=p.id) AS modifier_count, ${availableStockSql("p")} AS stock, count(*) OVER()::int AS total_count
       FROM products p JOIN categories c ON c.id=p.category_id
       LEFT JOIN LATERAL (SELECT url FROM product_photos WHERE product_id=p.id ORDER BY is_primary DESC,id LIMIT 1) photo ON true
       WHERE p.outlet_key=$1 AND ($2 = '' OR p.name ILIKE '%'||$2||'%')
         AND ($3 = '' OR p.category_id::text=$3)
         AND ($4 = '' OR ($4 = 'out_of_stock' AND ${availableStockSql("p")} <= 0) OR ($4 = 'low_stock' AND ${availableStockSql("p")} BETWEEN 1 AND 5) OR p.availability=$4)
       ORDER BY ${productSorts[filters.sort ?? "menu"].sql} ${paged ? "LIMIT $5 OFFSET $6" : ""}`,
      [operator.outletKey, filters.q ?? "", filters.category ?? "", filters.status ?? "",
        ...(paged ? [filters.pageSize ?? 50, ((filters.page ?? 1) - 1) * (filters.pageSize ?? 50)] : [])]),
    categoriesData(operator),
  ]);
  return { products: products.rows, categories, total: products.rows[0]?.total_count ?? 0 };
}

export async function categoriesData(operator: Operator) {
  return (await query<{ id: string; name: string; sort_order: number; product_count: number }>(
    `SELECT c.id::text,c.name,c.sort_order,count(p.id)::int AS product_count
     FROM categories c LEFT JOIN products p ON p.category_id=c.id
     WHERE c.outlet_key=$1 GROUP BY c.id ORDER BY c.sort_order,c.name`, [operator.outletKey])).rows;
}

export type ModifierGroup = {
  id: string; name: string; isRequired: boolean; minSelect: number; maxSelect: number;
  options: Array<{ id: string; name: string; priceDelta: string }>;
};

export async function productDetail(operator: Operator, id: string) {
  const product = (await query<ProductRow>(
    `SELECT p.id,p.name,p.description,p.price::text,p.cost_price::text,p.availability,p.category_id::text,c.name AS category_name,p.sort_order,
       (SELECT url FROM product_photos WHERE product_id=p.id ORDER BY is_primary DESC,id LIMIT 1) AS image_url,
       p.is_best_seller,p.is_people_love_this,0 AS modifier_count, ${availableStockSql("p")} AS stock,
       p.price_override,(SELECT s.price::text FROM products s WHERE s.id=p.source_product_id) AS main_price
     FROM products p JOIN categories c ON c.id=p.category_id WHERE p.outlet_key=$1 AND p.id=$2`, [operator.outletKey, id])).rows[0];
  if (!product) return null;
  const rows = (await query<{ group_id: string; group_name: string; is_required: boolean; min_select: number; max_select: number; option_id: string | null; option_name: string | null; price_delta: string | null }>(
    `SELECT g.id::text AS group_id,g.name AS group_name,g.is_required,g.min_select,g.max_select,
       o.id::text AS option_id,o.name AS option_name,o.price_delta::text
     FROM product_modifier_groups g LEFT JOIN product_modifier_options o ON o.group_id=g.id
     WHERE g.product_id=$1 ORDER BY g.sort_order,g.id,o.sort_order,o.id`, [product.id])).rows;
  const groups = new Map<string, ModifierGroup>();
  for (const row of rows) {
    const group = groups.get(row.group_id) ?? { id: row.group_id, name: row.group_name, isRequired: row.is_required, minSelect: row.min_select, maxSelect: row.max_select, options: [] };
    if (row.option_id && row.option_name) group.options.push({ id: row.option_id, name: row.option_name, priceDelta: row.price_delta ?? "0" });
    groups.set(row.group_id, group);
  }
  return { product, groups: [...groups.values()] };
}

export type OpeningHour = { key: string; day?: string; is_open?: boolean; open_time?: string | null; close_time?: string | null };

export async function outletData(operator: Operator) {
  return (await query<{
    outlet_key: string; name: string; public_name: string | null; tagline: string | null; address: string | null;
    phone: string | null; logo_image_url: string | null; banner_image_url: string | null; is_active: boolean;
    menu_payment_methods: string[]; qris_payload: string | null; menu_url: string | null; android_sync_times: string[];
    tax_rate: string; timezone: string; order_modes: string[]; opening_hours: OpeningHour[] | null;
  }>(`SELECT outlet_key,name,public_name,tagline,address,phone,logo_image_url,banner_image_url,is_active,
      menu_payment_methods,qris_payload,menu_url,android_sync_times,tax_rate::text,timezone,order_modes,opening_hours
      FROM outlets WHERE outlet_key=$1`, [operator.outletKey])).rows[0];
}

export type TableRow = { id: string; table_code: string; table_label: string; table_area: string; pax_capacity: number | null; is_active: boolean; qr_token: string };

export async function tablesData(operator: Operator) {
  return (await query<TableRow>(
    "SELECT id::text,table_code,table_label,table_area,pax_capacity,is_active,qr_token FROM qr_tables WHERE outlet_key=$1 ORDER BY table_area,sort_order,table_code", [operator.outletKey])).rows;
}

export type UserRow = { id: string; name: string; email: string; pos_role: string; is_active: boolean; created_at: Date; has_pin: boolean; is_home: boolean; home_name: string; access: string[] };

// Anggota outlet ini: akun asal dan akun dari cabang lain yang diberi akses.
// `access` berisi cabang lain tempat akun asal juga diberi akses.
export async function usersData(operator: Operator) {
  return (await query<UserRow>(
    `SELECT u.id::text, u.name, u.email, m.pos_role, u.is_active, u.created_at, coalesce(u.approval_pin_hash LIKE 'pbkdf2-sha256$%', false) AS has_pin,
            m.is_home, coalesce(h.public_name, h.name) AS home_name,
            coalesce((SELECT array_agg(a.outlet_key) FROM outlet_members a WHERE a.user_id = u.id AND NOT a.is_home), ARRAY[]::text[]) AS access
       FROM outlet_members m JOIN users u ON u.id = m.user_id JOIN outlets h ON h.outlet_key = u.outlet_key
      WHERE m.outlet_key = $1 ORDER BY m.is_home DESC, u.is_active DESC, u.name`, [operator.outletKey])).rows;
}

export async function shiftsData(operator: Operator, page = 1, pageSize = 25) {
  const result = await query<{
    id: string; business_date: string; status: string; opened_at: Date; closed_at: Date | null; opening_cash: string;
    expected_cash: string; actual_cash: string | null; cash_difference: string; order_count: number;
    cash_payment_total: string; digital_payment_total: string; opened_by_name: string | null; closed_by_name: string | null; cash_in: string; cash_out: string; from_tablet: boolean; notes: string | null; total_count: number;
  }>(
    `SELECT s.id::text,s.business_date::text,s.status,s.opened_at,s.closed_at,s.opening_cash::text,s.expected_cash::text,
       s.actual_cash::text,s.cash_difference::text,s.order_count,s.cash_payment_total::text,s.digital_payment_total::text,
       u.name AS opened_by_name,c.name AS closed_by_name,
       coalesce((SELECT sum(amount) FROM shift_cash_movements m WHERE m.shift_id=s.id AND m.kind='in'),0)::text AS cash_in,
       coalesce((SELECT sum(amount) FROM shift_cash_movements m WHERE m.shift_id=s.id AND m.kind='out'),0)::text AS cash_out,(s.device_id IS NOT NULL) AS from_tablet,s.notes,count(*) OVER()::int AS total_count
     FROM pos_shifts s LEFT JOIN users u ON u.id=s.opened_by LEFT JOIN users c ON c.id=s.closed_by
     WHERE s.outlet_key=$1 ORDER BY (s.status='open') DESC, s.opened_at DESC LIMIT $2 OFFSET $3`, [operator.outletKey, pageSize, (page - 1) * pageSize]);
  return { rows: result.rows, total: result.rows[0]?.total_count ?? 0 };
}

export const auditKinds = {
  all: { label: "All", prefixes: [] as string[] },
  money: { label: "Money", prefixes: ["order.", "shift.", "promotion.", "expense."] },
  menu: { label: "Menu", prefixes: ["product.", "category.", "menu."] },
  team: { label: "Team & settings", prefixes: ["user.", "outlet.", "table."] },
} as const;
export type AuditKind = keyof typeof auditKinds;

export async function auditData(operator: Operator, kind: AuditKind, search: string, page: number, pageSize: number) {
  const prefixes = auditKinds[kind].prefixes.map((prefix) => `${prefix}%`);
  const result = await query<{ id: string; action: string; reason: string | null; summary: string | null; actor_name: string | null; approver_name: string | null; created_at: Date; difference: string | null; total_count: number }>(
    `SELECT a.id::text,a.action,a.reason,a.metadata->>'summary' AS summary,u.name AS actor_name,ap.name AS approver_name,
       coalesce((a.metadata->>'at')::timestamptz, a.created_at) AS created_at, a.metadata->>'difference' AS difference, count(*) OVER()::int AS total_count
     FROM pos_audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users ap ON ap.id=a.approved_by
     WHERE a.outlet_key=$1 AND (cardinality($2::text[]) = 0 OR a.action LIKE ANY($2::text[]))
       AND ($3 = '' OR a.metadata->>'summary' ILIKE '%'||$3||'%' OR a.reason ILIKE '%'||$3||'%' OR u.name ILIKE '%'||$3||'%')
     ORDER BY coalesce((a.metadata->>'at')::timestamptz, a.created_at) DESC LIMIT $4 OFFSET $5`,
    [operator.outletKey, prefixes, search, pageSize, (page - 1) * pageSize]);
  return { rows: result.rows, total: result.rows[0]?.total_count ?? 0 };
}

export const reportRanges = { today: "Today", "7": "7 days", "30": "30 days", "90": "90 days", month: "This month", custom: "Custom" } as const;
export type ReportRange = keyof typeof reportRanges;
export type ReportPeriod = { range: ReportRange; from: string; to: string };

// Rentang laporan dalam tanggal lokal outlet. Rentang bebas dibatasi 366 hari.
export function reportPeriod(timezone: string, range: string, from = "", to = ""): ReportPeriod {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const shift = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  if (range === "custom" && valid(from) && valid(to)) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    const capped = shift(end, -365) > start ? shift(end, -365) : start;
    const last = end > today ? today : end;
    return { range: "custom", from: capped > last ? last : capped, to: last };
  }
  if (range === "today") return { range, from: today, to: today };
  if (range === "month") return { range, from: `${today.slice(0, 8)}01`, to: today };
  const days = range === "7" ? 7 : range === "90" ? 90 : 30;
  return { range: range === "7" || range === "90" ? range : "30", from: shift(today, -(days - 1)), to: today };
}

