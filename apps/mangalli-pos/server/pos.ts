import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "pg";

import { config } from "./config";
import { HttpError } from "./http";
import { normalizeStatus, statusLabel } from "./workflow";
import { availableStockSql } from "./stock";

export { canTransition, legacyStatus, normalizeStatus, restaurantStatuses, statusLabel, type RestaurantStatus } from "./workflow";

// Tarif pajak per outlet (0 untuk UMKM tanpa pajak, 0.10 untuk PB1, dst.).
export async function outletTaxRate(client: Pick<PoolClient, "query">, outletKey: string): Promise<number> {
  const result = await client.query<{ tax_rate: string }>("SELECT tax_rate::text FROM outlets WHERE outlet_key=$1", [outletKey]);
  return Number(result.rows[0]?.tax_rate ?? 0);
}

export type Device = {
  id: string;
  outlet_key: string;
  device_key: string;
  label: string | null;
  token_hash: string;
  last_seen_at: Date | null;
  created_at: Date;
};

export type StaffSession = {
  id: string;
  user_id: string;
  outlet_key: string;
  token_hash: string;
  last_seen_at: Date | null;
  user_name: string;
  user_email: string;
  pos_role: "owner" | "manager" | "staff";
};

export type SyncItemInput = {
  type?: "product" | "custom_amount";
  productId?: string | null;
  name?: string | null;
  unitPrice?: number | null;
  quantity: number;
  modifierOptionIds?: number[] | null;
  notes?: string | null;
};

export type ValidatedItem = {
  productId: string | null;
  itemType: "product" | "custom_amount";
  itemName: string;
  quantity: number;
  unitPrice: number;
  modifierTotal: number;
  modifierSummary: string | null;
  selectedModifierOptions: Array<{ group: string; id: number; name: string; price_delta: number }>;
  notes: string | null;
  sendToKitchen: boolean;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function opaqueToken(prefix: string): string {
  return `${prefix}${randomBytes(48).toString("base64url")}`;
}

export function orderCode(): string {
  return `1GK-${String(randomInt(0, 10_000)).padStart(4, "0")}`;
}

export function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export async function activeShift(client: PoolClient, outletKey: string) {
  const result = await client.query<{
    id: string;
    business_date: string;
    opened_at: Date;
    opening_cash: string;
    status: "open";
  }>(
    `SELECT id, business_date::text, opened_at, opening_cash::text, status
       FROM pos_shifts WHERE outlet_key = $1 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
    [outletKey],
  );
  return result.rows[0] ?? null;
}

export async function refreshShiftTotals(client: PoolClient, shiftId: string | null) {
  if (!shiftId) return;
  await client.query(
    `UPDATE pos_shifts s SET
      order_count = totals.order_count,
      cash_payment_total = totals.cash_total,
      digital_payment_total = totals.digital_total,
      pending_payment_total = totals.pending_total,
      expected_cash = s.opening_cash + totals.cash_total
        + coalesce((SELECT sum(CASE WHEN m.kind='in' THEN m.amount ELSE -m.amount END) FROM shift_cash_movements m WHERE m.shift_id=s.id),0),
      updated_at = now()
     FROM (
       SELECT count(DISTINCT o.id)::integer AS order_count,
         coalesce(sum(p.amount) FILTER (WHERE p.status='completed' AND p.payment_method='cash'),0) AS cash_total,
         coalesce(sum(p.amount) FILTER (WHERE p.status='completed' AND p.payment_method<>'cash'),0) AS digital_total,
         coalesce(sum(p.amount) FILTER (WHERE p.status='pending'),0) AS pending_total
       FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.shift_id=$1
     ) totals WHERE s.id=$1`,
    [shiftId],
  );
}

export async function validateTable(client: PoolClient, outletKey: string, tableNumber: number) {
  const table = await client.query<{ table_code: string; table_label: string }>(
    `SELECT table_code, table_label FROM qr_tables
      WHERE outlet_key = $1 AND is_active = true
        AND (table_code = $2 OR upper(table_code) = upper($4) OR table_label = $3
          OR nullif(regexp_replace(table_code, '\\D', '', 'g'), '')::integer = $2::integer)
      LIMIT 1`,
    [outletKey, String(tableNumber), `Dine In - ${tableNumber}`, `T${tableNumber}`],
  );
  if (table.rows[0]) return table.rows[0];
  // Meja di dashboard (Tables & QR) satu-satunya patokan: nomor yang tidak
  // terdaftar atau nonaktif selalu ditolak, juga saat outlet belum punya meja.
  const registered = await client.query("SELECT 1 FROM qr_tables WHERE outlet_key = $1 AND is_active = true LIMIT 1", [outletKey]);
  throw new HttpError(422, registered.rowCount
    ? `Table ${tableNumber} isn't at this outlet. Check the number on your table or scan its QR code.`
    : "This outlet hasn't set up tables yet. Choose takeaway or ask the cashier.");
}

export async function validateItems(
  client: PoolClient,
  outletKey: string,
  inputs: SyncItemInput[],
): Promise<{ items: ValidatedItem[]; subtotal: number }> {
  const validated: ValidatedItem[] = [];
  let subtotal = 0;

  for (const [index, input] of inputs.entries()) {
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpError(422, "The given data was invalid.", { [`items.${index}.quantity`]: ["Quantity must be between 1 and 99."] });
    }

    if (input.type === "custom_amount") {
      const name = input.name?.trim() ?? "";
      const unitPrice = Number(input.unitPrice ?? 0);
      if (!name) throw new HttpError(422, "The given data was invalid.", { [`items.${index}.name`]: ["Custom amount name is required."] });
      if (unitPrice < 1 || unitPrice > config.customAmountMax) {
        throw new HttpError(422, "The given data was invalid.", { [`items.${index}.unitPrice`]: ["Custom amount is outside the allowed range."] });
      }
      validated.push({
        productId: null,
        itemType: "custom_amount",
        itemName: name,
        quantity,
        unitPrice,
        modifierTotal: 0,
        modifierSummary: null,
        selectedModifierOptions: [],
        notes: input.notes?.trim() || null,
        sendToKitchen: false,
      });
      subtotal += unitPrice * quantity;
      continue;
    }

    if (!input.productId) {
      throw new HttpError(422, "The given data was invalid.", { [`items.${index}.productId`]: ["Product is required."] });
    }
    const product = await client.query<{ id: string; name: string; price: string }>(
      `SELECT id, name, price::text FROM products
        WHERE id = $1 AND outlet_key = $2 AND availability = 'available'`,
      [input.productId, outletKey],
    );
    if (!product.rows[0]) {
      throw new HttpError(422, "The given data was invalid.", { [`items.${index}.productId`]: ["Product is unavailable."] });
    }

    const optionIds = [...new Set((input.modifierOptionIds ?? []).map(Number).filter(Number.isInteger))];
    const options = optionIds.length
      ? await client.query<{ id: number; group_id: number; group_name: string; name: string; price_delta: string }>(
          `SELECT o.id, o.group_id, g.name AS group_name, o.name, o.price_delta::text
             FROM product_modifier_options o
             JOIN product_modifier_groups g ON g.id = o.group_id
            WHERE g.product_id = $1 AND o.is_available = true AND o.id = ANY($2::bigint[])`,
          [input.productId, optionIds],
        )
      : { rows: [] as Array<{ id: number; group_id: number; group_name: string; name: string; price_delta: string }> };
    if (options.rows.length !== optionIds.length) {
      throw new HttpError(422, "The given data was invalid.", { [`items.${index}.modifierOptionIds`]: ["One or more modifier options are invalid."] });
    }

    const groups = await client.query<{ id: number; name: string; is_required: boolean; min_select: number; max_select: number }>(
      `SELECT id, name, is_required, min_select, max_select FROM product_modifier_groups WHERE product_id = $1`,
      [input.productId],
    );
    for (const group of groups.rows) {
      const count = options.rows.filter((option) => option.group_id === group.id).length;
      if (group.is_required && count < group.min_select) {
        throw new HttpError(422, "The given data was invalid.", { items: [`${group.name} requires at least ${group.min_select}.`] });
      }
      if (count > group.max_select) {
        throw new HttpError(422, "The given data was invalid.", { items: [`${group.name} allows up to ${group.max_select} selections.`] });
      }
    }

    const modifierTotal = options.rows.reduce((total, option) => total + Number(option.price_delta), 0);
    const unitPrice = Number(product.rows[0].price) + modifierTotal;
    subtotal += unitPrice * quantity;
    validated.push({
      productId: product.rows[0].id,
      itemType: "product",
      itemName: product.rows[0].name,
      quantity,
      unitPrice,
      modifierTotal,
      modifierSummary: options.rows.map((option) => option.name).join(" • ") || null,
      selectedModifierOptions: options.rows.map((option) => ({
        group: option.group_name,
        id: option.id,
        name: option.name,
        price_delta: Number(option.price_delta),
      })),
      notes: input.notes?.trim() || null,
      sendToKitchen: true,
    });
  }
  return { items: validated, subtotal };
}

export async function insertItems(client: PoolClient, orderId: string, items: ValidatedItem[]) {
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items(
        order_id, product_id, item_type, item_name, quantity, unit_price, modifier_total,
        selected_modifier_options, modifier_summary, notes, send_to_kitchen
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [
        orderId,
        item.productId,
        item.itemType,
        item.itemName,
        item.quantity,
        item.unitPrice,
        item.modifierTotal,
        JSON.stringify(item.selectedModifierOptions),
        item.modifierSummary,
        item.notes,
        item.sendToKitchen,
      ],
    );
  }
}

export async function uniqueOrderCode(client: PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = orderCode();
    const exists = await client.query("SELECT 1 FROM orders WHERE order_code = $1", [candidate]);
    if (!exists.rowCount) return candidate;
  }
  return `1GK-${randomBytes(3).toString("hex").slice(0, 4).toUpperCase()}`;
}

export async function catalogRevision(client: PoolClient, outletKey: string): Promise<string> {
  const result = await client.query<{ revision: string }>(
    `SELECT concat_ws('|',
      coalesce((SELECT max(updated_at)::text FROM categories WHERE outlet_key = $1), ''),
      coalesce((SELECT max(updated_at)::text FROM products WHERE outlet_key = $1), ''),
      coalesce((SELECT max(g.updated_at)::text FROM product_modifier_groups g JOIN products p ON p.id = g.product_id WHERE p.outlet_key = $1), ''),
      coalesce((SELECT max(o.updated_at)::text FROM product_modifier_options o JOIN product_modifier_groups g ON g.id = o.group_id JOIN products p ON p.id = g.product_id WHERE p.outlet_key = $1), ''),
      coalesce((SELECT max(updated_at)::text FROM qr_tables WHERE outlet_key = $1), ''),
      (SELECT count(*)::text || '@' || coalesce(max(updated_at)::text, '') FROM promotions WHERE outlet_key = $1)
    ) AS revision`,
    [outletKey],
  );
  return createHash("sha1").update(result.rows[0]?.revision ?? "").digest("hex");
}

export async function loadCatalog(client: PoolClient, outletKey: string) {
  const categories = await client.query<{ id: string; name: string }>(
    "SELECT id, name FROM categories WHERE outlet_key = $1 ORDER BY sort_order, name",
    [outletKey],
  );
  const tables = await client.query(
    `SELECT id, table_code AS "tableCode", table_label AS "tableLabel", table_area AS "tableArea",
      pax_capacity AS "paxCapacity", sort_order AS "sortOrder"
      FROM qr_tables WHERE outlet_key = $1 AND is_active = true ORDER BY sort_order, id`,
    [outletKey],
  );
  const products = await client.query<{
    id: string;
    category_id: string;
    category_name: string;
    name: string;
    description: string | null;
    price: string;
    availability: string;
    is_best_seller: boolean;
    is_people_love_this: boolean;
    sort_order: number;
    photo_url: string | null;
    stock: number | null;
  }>(
    `SELECT p.id, p.category_id, c.name AS category_name, p.name, p.description, p.price::text,
      p.availability, p.is_best_seller, p.is_people_love_this, p.sort_order, ${availableStockSql("p")} AS stock,
      (SELECT ph.url FROM product_photos ph WHERE ph.product_id = p.id ORDER BY ph.is_primary DESC, ph.id LIMIT 1) AS photo_url
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.outlet_key = $1 AND p.availability <> 'hidden'
      ORDER BY p.sort_order, p.name`,
    [outletKey],
  );
  const output = [];
  for (const product of products.rows) {
    const groups = await client.query<{
      id: string;
      name: string;
      is_required: boolean;
      min_select: number;
      max_select: number;
      sort_order: number;
    }>(
      "SELECT id, name, is_required, min_select, max_select, sort_order FROM product_modifier_groups WHERE product_id = $1 ORDER BY sort_order, id",
      [product.id],
    );
    const modifierGroups = [];
    for (const group of groups.rows) {
      const options = await client.query(
        `SELECT id, name, price_delta::float8 AS "priceDelta", sort_order AS "sortOrder"
          FROM product_modifier_options WHERE group_id = $1 AND is_available = true ORDER BY sort_order, id`,
        [group.id],
      );
      modifierGroups.push({
        id: Number(group.id),
        name: group.name,
        isRequired: group.is_required,
        minSelect: group.min_select,
        maxSelect: group.max_select,
        sortOrder: group.sort_order,
        options: options.rows,
      });
    }
    output.push({
      id: product.id,
      categoryId: Number(product.category_id),
      categoryName: product.category_name,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      availability: product.availability,
      // Sisa stok (null = tidak dilacak). Tablet dan menu digital membatasi jumlah pesanan dengan ini.
      stock: product.stock === null ? null : Math.max(0, Number(product.stock)),
      isBestSeller: product.is_best_seller,
      isPeopleLoveThis: product.is_people_love_this,
      sortOrder: product.sort_order,
      photoUrl: product.photo_url,
      modifierGroups,
    });
  }
  return { categories: categories.rows.map((row) => ({ id: Number(row.id), name: row.name })), tables: tables.rows, products: output };
}

type OrderRow = {
  id: string;
  order_code: string | null;
  customer_name: string | null;
  restaurant_status: string;
  order_mode: string;
  table_number: number;
  table_label: string | null;
  pickup_name: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  payment_status: string | null;
  payment_method: string | null;
  payment_amount: string | null;
  refunded_at: Date | null;
  tax_rate: string;
};

export async function loadOrder(client: PoolClient, outletKey: string, orderId: string): Promise<OrderRow> {
  const result = await client.query<OrderRow>(
    `SELECT o.*, p.status AS payment_status, p.payment_method, p.amount::text AS payment_amount, p.refunded_at, t.tax_rate::text AS tax_rate
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id JOIN outlets t ON t.outlet_key = o.outlet_key
      WHERE o.id = $1 AND o.outlet_key = $2`,
    [orderId, outletKey],
  );
  if (!result.rows[0]) throw new HttpError(404, "Order not found.");
  return result.rows[0];
}

export async function loadOrderItems(client: PoolClient, orderId: string) {
  const result = await client.query<{
    id: string;
    product_id: string | null;
    item_type: string;
    item_name: string | null;
    product_name: string | null;
    quantity: number;
    unit_price: string;
    modifier_total: string;
    selected_modifier_options: Array<{ id?: number }>;
    modifier_summary: string | null;
    notes: string | null;
    send_to_kitchen: boolean;
    kitchen_printed_quantity: number;
  }>(
    `SELECT i.*, p.name AS product_name FROM order_items i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.order_id = $1 ORDER BY i.id`,
    [orderId],
  );
  return result.rows;
}

export async function androidOrderPayload(client: PoolClient, order: OrderRow) {
  const items = await loadOrderItems(client, order.id);
  const status = normalizeStatus(order.restaurant_status);
  const totalFromItems = Math.round(items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0) * (1 + Number(order.tax_rate)) * 100) / 100;
  const mapped = items.map((item) => ({
    id: Number(item.id),
    itemType: item.item_type,
    name: item.item_name || item.product_name || "Item",
    quantity: item.quantity,
    unitPrice: Number(item.unit_price),
    subtotal: Number(item.unit_price) * item.quantity,
    modifierSummary: item.modifier_summary,
    notes: item.notes,
  }));
  return {
    id: Number(order.id),
    orderCode: order.order_code || `1GK-${String(Number(order.id) % 10_000).padStart(4, "0")}`,
    customerName: order.customer_name || "Walk-in Customer",
    restaurantStatus: status,
    statusLabel: statusLabel(status),
    orderMode: order.order_mode || "dinein",
    tableNumber: order.table_number,
    tableLabel: order.table_label,
    pickupName: order.pickup_name,
    notes: order.notes,
    totalAmount: Number(order.payment_amount ?? 0) || totalFromItems,
    paymentStatus: order.refunded_at ? "refunded" : order.payment_status,
    paymentMethod: order.payment_method,
    createdAt: order.created_at.toISOString(),
    items: mapped,
    itemSummary: mapped.map((item) => `${item.quantity}x ${item.name}`).join(", "),
  };
}

export async function androidBillPayload(client: PoolClient, order: OrderRow) {
  const items = await loadOrderItems(client, order.id);
  const mapped = items.map((item) => ({
    id: Number(item.id),
    itemType: item.item_type,
    productId: item.product_id || `custom:${item.id}`,
    name: item.item_name || item.product_name || "Item",
    quantity: item.quantity,
    sendToKitchen: item.send_to_kitchen,
    kitchenPrintedQuantity: item.kitchen_printed_quantity,
    pendingKitchenQuantity: item.send_to_kitchen ? Math.max(0, item.quantity - item.kitchen_printed_quantity) : 0,
    unitPrice: Number(item.unit_price),
    modifierOptionIds: (item.selected_modifier_options ?? []).flatMap((option) => (option.id ? [option.id] : [])),
    modifierSummary: item.modifier_summary,
    modifierTotal: Number(item.modifier_total),
    notes: item.notes,
  }));
  const subtotal = mapped.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const name = order.order_mode === "dinein" ? order.table_label || `Table ${order.table_number}` : order.pickup_name || order.customer_name;
  return {
    id: Number(order.id),
    orderCode: order.order_code || `1GK-${String(Number(order.id) % 10_000).padStart(4, "0")}`,
    name: name || `Bill #${order.id}`,
    customerName: order.customer_name,
    orderMode: order.order_mode || "takeaway",
    tableNumber: order.table_number || null,
    itemCount: mapped.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: Math.round(subtotal * (1 + Number(order.tax_rate)) * 100) / 100,
    items: mapped,
    updatedAt: order.updated_at.toISOString(),
  };
}

type AuditEntry = {
  outletKey: string;
  action: string;
  summary: string;
  actorId?: string | number | null;
  approvedBy?: string | number | null;
  type?: string;
  id?: string | number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

// Satu pintu untuk jejak audit. `summary` adalah kalimat yang dibaca owner di
// halaman Audit log; `metadata.event_id` mencegah catatan ganda saat sinkron ulang.
export async function audit(client: Pick<PoolClient, "query">, entry: AuditEntry) {
  const numericId = entry.id !== undefined && entry.id !== null && /^\d+$/.test(String(entry.id)) ? String(entry.id) : null;
  await client.query(
    `INSERT INTO pos_audit_logs(outlet_key,actor_id,approved_by,action,auditable_type,auditable_id,reason,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [entry.outletKey, entry.actorId ?? null, entry.approvedBy ?? null, entry.action, entry.type ?? null, numericId,
      entry.reason?.trim() || null, JSON.stringify({ ...entry.metadata, summary: entry.summary, ...(numericId ? {} : { ref: entry.id ?? null }) })],
  );
}

export async function auditLogged(client: Pick<PoolClient, "query">, outletKey: string, eventId: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM pos_audit_logs WHERE outlet_key=$1 AND metadata->>'event_id'=$2 LIMIT 1", [outletKey, eventId]);
  return Boolean(result.rowCount);
}

// Pesanan batal tidak pernah menyisakan pembayaran lunas: uang yang sudah
// diterima berubah menjadi refund, jadi laporan dan kas shift tidak lagi
// menghitungnya. Mengembalikan nominal yang direfund (0 bila belum dibayar).
export async function refundIfPaid(client: PoolClient, orderId: string, actorId: string | number | null, reason: string | null): Promise<number> {
  const result = await client.query<{ amount: string }>(
    `UPDATE payments SET status='refunded', refunded_at=coalesce(refunded_at, now()), refunded_by=$2, refund_amount=amount,
       refund_reason=$3, updated_at=now() WHERE order_id=$1 AND status='completed' RETURNING amount::text`,
    [orderId, actorId, reason],
  );
  return Number(result.rows[0]?.amount ?? 0);
}
