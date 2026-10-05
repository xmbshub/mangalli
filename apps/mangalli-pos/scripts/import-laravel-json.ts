import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { Client } from "pg";

type LegacyRow = Record<string, unknown>;
type ExportDocument = {
  format: string;
  sourceSha256: string;
  counts: Record<string, number>;
  tables: Record<string, LegacyRow[]>;
};
type TableSpec = {
  source: string;
  target?: string;
  columns: string[];
  map?: (row: LegacyRow, context: ImportContext) => LegacyRow;
};
type ImportContext = { defaultOutletKey: string; now: string };

const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
const path = arguments_.find((argument) => !argument.startsWith("--"));
const dryRun = arguments_.includes("--dry-run");
if (!path) throw new Error("Usage: import-laravel-json.ts <export.json> [--dry-run]");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const raw = await readFile(path, "utf8");
const document = JSON.parse(raw) as ExportDocument;
if (document.format !== "mangalli-laravel-sqlite-v1" || !/^[a-f0-9]{64}$/.test(document.sourceSha256)) {
  throw new Error("Unsupported or invalid legacy export.");
}

const rows = (table: string) => {
  const value = document.tables?.[table];
  if (!Array.isArray(value) || document.counts?.[table] !== value.length) throw new Error(`Invalid count for ${table}.`);
  return value;
};
const timestamp = (value: unknown, fallback: string) => typeof value === "string" && value ? value : fallback;
const boolean = (value: unknown) => value === true || value === 1 || value === "1";
const json = (value: unknown, fallback: unknown) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error("Invalid JSON value in legacy export."); }
};

const outlets = rows("outlets");
if (outlets.length !== 1 || typeof outlets[0]?.outlet_key !== "string") {
  throw new Error("Legacy migration currently requires exactly one explicit outlet.");
}
const context: ImportContext = { defaultOutletKey: String(outlets[0].outlet_key), now: new Date().toISOString() };
const commonTimes = (row: LegacyRow) => ({
  ...row,
  created_at: timestamp(row.created_at, context.now),
  updated_at: timestamp(row.updated_at, context.now),
});

const specs: TableSpec[] = [
  { source: "outlets", columns: ["id", "outlet_key", "name", "public_name", "tagline", "address", "phone", "logo_image_url", "banner_image_url", "opening_hours", "is_active", "sort_order", "created_at", "updated_at"], map: (row) => ({ ...commonTimes(row), opening_hours: json(row.opening_hours, null), is_active: boolean(row.is_active) }) },
  { source: "users", columns: ["id", "outlet_key", "name", "email", "password_hash", "pos_role", "approval_pin_hash", "is_active", "email_verified_at", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, password_hash: row.password, is_active: boolean(row.is_active) }) },
  { source: "categories", columns: ["id", "outlet_key", "name", "sort_order", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: ctx.defaultOutletKey, sort_order: row.sort_order ?? 0 }) },
  { source: "products", columns: ["id", "outlet_key", "category_id", "name", "description", "price", "availability", "sort_order", "is_best_seller", "is_people_love_this", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: ctx.defaultOutletKey, is_best_seller: boolean(row.is_best_seller), is_people_love_this: boolean(row.is_people_love_this) }) },
  { source: "product_photos", columns: ["id", "product_id", "url", "is_primary", "created_at", "updated_at"], map: (row) => ({ ...commonTimes(row), is_primary: boolean(row.is_primary) }) },
  { source: "product_modifier_groups", columns: ["id", "product_id", "name", "is_required", "min_select", "max_select", "sort_order", "created_at", "updated_at"], map: (row) => ({ ...commonTimes(row), is_required: boolean(row.is_required) }) },
  { source: "product_modifier_options", columns: ["id", "group_id", "name", "price_delta", "is_available", "sort_order", "created_at", "updated_at"], map: (row) => ({ ...commonTimes(row), is_available: boolean(row.is_available) }) },
  { source: "qr_tables", columns: ["id", "outlet_key", "qr_token", "table_code", "table_label", "table_area", "pax_capacity", "notes", "sort_order", "is_active", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, is_active: boolean(row.is_active) }) },
  { source: "pos_shifts", columns: ["id", "outlet_key", "business_date", "status", "opened_by", "closed_by", "opened_at", "closed_at", "opening_cash", "expected_cash", "actual_cash", "cash_difference", "order_count", "cash_payment_total", "digital_payment_total", "pending_payment_total", "notes", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, opened_at: timestamp(row.opened_at, ctx.now) }) },
  { source: "orders", columns: ["id", "outlet_key", "shift_id", "order_code", "public_token", "business_date", "customer_name", "customer_phone", "customer_email", "order_mode", "table_number", "table_code", "table_label", "pickup_name", "notes", "status", "restaurant_status", "voided_at", "voided_by", "void_reason", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, order_mode: row.order_mode || "dinein" }) },
  { source: "order_items", columns: ["id", "order_id", "product_id", "item_type", "item_name", "quantity", "unit_price", "modifier_total", "selected_modifier_options", "modifier_summary", "notes", "send_to_kitchen", "kitchen_printed_quantity", "created_at", "updated_at"], map: (row) => ({ ...commonTimes(row), unit_price: row.unit_price ?? 0, selected_modifier_options: json(row.selected_modifier_options, []), send_to_kitchen: boolean(row.send_to_kitchen) }) },
  { source: "payments", columns: ["id", "order_id", "amount", "status", "payment_method", "transaction_id", "paid_at", "notes", "refunded_at", "refunded_by", "refund_amount", "refund_reason", "created_at", "updated_at"], map: (row) => commonTimes(row) },
  { source: "pos_audit_logs", columns: ["id", "outlet_key", "actor_id", "approved_by", "action", "auditable_type", "auditable_id", "reason", "metadata", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, metadata: json(row.metadata, {}) }) },
  { source: "pos_cash_handovers", columns: ["id", "outlet_key", "shift_id", "handed_over_by", "received_by", "system_cash", "counted_cash", "cash_difference", "active_order_count", "pending_payment_count", "pending_payment_total", "open_bill_count", "notes", "approval_by", "approval_reason", "created_by", "snapshot", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, snapshot: json(row.snapshot, {}) }) },
  { source: "android_pos_devices", columns: ["id", "outlet_key", "device_key", "label", "token_digest", "token_hash", "last_seen_at", "revoked_at", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey }) },
  { source: "android_pos_staff_sessions", columns: ["id", "device_id", "user_id", "outlet_key", "token_digest", "token_hash", "last_seen_at", "revoked_at", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey }) },
  { source: "android_pos_sync_events", columns: ["id", "device_id", "staff_session_id", "user_id", "outlet_key", "local_uuid", "idempotency_key", "event_type", "status", "payload", "order_id", "payment_id", "created_at", "updated_at"], map: (row, ctx) => ({ ...commonTimes(row), outlet_key: row.outlet_key || ctx.defaultOutletKey, payload: json(row.payload, {}) }) },
];

const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30_000 });
await client.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query<{ count: string }>("SELECT count(*)::text FROM outlets");
  if (Number(existing.rows[0]?.count ?? 0) !== 0) throw new Error("Target database is not empty; import aborted.");

  for (const spec of specs) {
    const target = spec.target ?? spec.source;
    const sourceRows = rows(spec.source);
    for (const sourceRow of sourceRows) {
      const row = spec.map ? spec.map(sourceRow, context) : sourceRow;
      const values = spec.columns.map((column) => row[column] ?? null);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
      await client.query(
        `INSERT INTO ${target} (${spec.columns.join(",")}) VALUES (${placeholders})`,
        values.map((value) => value && typeof value === "object" ? JSON.stringify(value) : value),
      );
    }
  }

  const serialTables = specs.filter((spec) => spec.columns.includes("id") && spec.source !== "products");
  for (const spec of serialTables) {
    const target = spec.target ?? spec.source;
    await client.query(`SELECT setval(pg_get_serial_sequence('${target}','id'),coalesce(max(id),1),max(id) IS NOT NULL) FROM ${target}`);
  }

  const imported: Record<string, number> = {};
  for (const spec of specs) {
    const target = spec.target ?? spec.source;
    const count = await client.query<{ count: string }>(`SELECT count(*)::text FROM ${target}`);
    imported[target] = Number(count.rows[0]?.count ?? 0);
    if (imported[target] !== document.counts[spec.source]) throw new Error(`Post-import count mismatch for ${target}.`);
  }
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.info(JSON.stringify({
    status: dryRun ? "dry-run-verified" : "imported",
    sourceSha256: document.sourceSha256,
    exportSha256: createHash("sha256").update(raw).digest("hex"),
    outletKey: context.defaultOutletKey,
    counts: imported,
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
