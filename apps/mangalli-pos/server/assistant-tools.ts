import "server-only";

import { ordersData, orderDetail, productsData, reportPeriod, type OrderTab } from "./admin";
import type { Operator } from "./auth";
import { menuMode } from "./branches";
import { pool, query } from "./db";
import { MAX_MENU_TEXT, readMenu } from "./menu-import";
import { formatDate, outletFormat } from "./format";
import { buildPdf, type PdfSection } from "./pdf";
import { formatIdr } from "./pos";
import { loadPromotions } from "./promotions";
import { expenseCategories, reportPack, type ExpenseCategory } from "./reports";
import { buildXlsx, type CellKind, type Sheet } from "./xlsx";

// Alat baca-saja untuk Ask Eline (permintaan owner 4 Okt 2026): model membaca
// data dashboard lewat fungsi ini, tidak pernah menebak angka. Semua kueri
// dibatasi outlet operator, dan alat yang terlihat oleh model mengikuti peran:
// owner/manager semua, kasir pesanan/produk/stok, viewer tidak ada.

type Role = Operator["role"];
type ToolArgs = Record<string, unknown>;
type Tool = { roles: Role[]; status: string; spec: { name: string; description: string; parameters: Record<string, unknown> }; run: (operator: Operator, args: ToolArgs) => Promise<unknown> };

const management: Role[] = ["owner", "manager"];
const operations: Role[] = ["owner", "manager", "staff"];
const str = (value: unknown, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const dateArg = { type: "string", description: "Local date YYYY-MM-DD" };

// Rentang dari argumen model; tanpa tanggal = 30 hari terakhir.
function period(operator: Operator, args: ToolArgs) {
  const from = str(args.from, 10);
  const to = str(args.to, 10);
  return from || to ? reportPeriod(operator.timezone, "custom", from || to, to || from) : reportPeriod(operator.timezone, "30");
}

const round = (value: number) => Math.round(value);

async function salesReport(operator: Operator, args: ToolArgs) {
  const data = await reportPack(operator, period(operator, args));
  const busiest = Object.entries(data.heat).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([key, value]) => { const [dow, hour] = key.split(":").map(Number); return { day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow - 1], hour, sales: round(value) }; });
  return {
    period: data.period, previousPeriod: data.previous,
    sales: { beforeDiscounts: round(data.money.gross), discounts: round(data.money.discounts), net: round(data.money.net), taxCollected: round(data.money.tax), collected: round(data.money.collected), paidOrders: data.money.orders, averageOrder: data.money.orders ? round(data.money.net / data.money.orders) : 0 },
    previous: { net: round(data.prev.net), paidOrders: data.prev.orders },
    profit: data.hasCosts ? { costOfItems: round(data.money.cost), grossProfit: round(data.grossProfit), expenses: round(data.expenseTotal), netProfit: round(data.netProfit), costCoveragePercent: Math.round(data.costCoverage * 100) } : { note: "No product costs set, so profit is unknown. Expenses recorded: " + round(data.expenseTotal) },
    expenses: data.expenses.map((item) => ({ category: item.label, total: round(item.total), entries: item.count })),
    channels: data.channels.map((item) => ({ name: item.name, net: round(item.net), orders: item.orders })),
    orderTypes: data.modes.map((item) => ({ name: item.name, net: round(item.net), orders: item.orders })),
    paymentMethods: data.methods.map((item) => ({ method: item.name, collected: round(item.collected), orders: item.orders })),
    topProducts: data.products.slice(0, 15).map((item) => ({ name: item.name, category: item.category, sold: item.qty, sales: round(item.revenue), profit: item.profit === null ? null : round(item.profit) })),
    categories: data.categories.map((item) => ({ name: item.name, sold: item.qty, sales: round(item.revenue) })),
    productsWithNoSales: data.unsold.slice(0, 20),
    busiestTimes: busiest,
    refunds: { count: data.leakage.refunds, total: round(data.leakage.refundTotal) }, voids: { count: data.leakage.voids, total: round(data.leakage.voidTotal) },
    shifts: { closed: data.shifts.count, cashShort: round(data.shifts.short), cashOver: round(data.shifts.over) },
  };
}

async function listOrders(operator: Operator, args: ToolArgs) {
  const range = str(args.from, 10) || str(args.to, 10) ? period(operator, args) : { from: "", to: "" };
  const tabs: OrderTab[] = ["all", "unpaid", "active", "completed", "cancelled"];
  const tab = tabs.includes(args.status as OrderTab) ? (args.status as OrderTab) : "all";
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  const data = await ordersData(operator, { tab, search: str(args.search), from: range.from, to: range.to, sort: "newest", page: 1, pageSize: limit });
  return {
    total: data.total,
    orders: data.rows.map((row) => ({ id: row.id, code: row.order_code, createdAt: row.created_at, type: row.order_mode, table: row.table_label, customer: row.customer_name, status: row.restaurant_status, payment: row.payment_status, method: row.payment_method, cashier: row.cashier_name, total: Number(row.amount ?? 0) })),
  };
}

async function getOrder(operator: Operator, args: ToolArgs) {
  const code = str(args.code, 40);
  const found = await query<{ id: string }>("SELECT id::text FROM orders WHERE outlet_key=$1 AND (order_code ILIKE $2 OR id::text = $2) LIMIT 1", [operator.outletKey, code]);
  if (!found.rows[0]) return { error: `No order ${code} in this outlet.` };
  const detail = await orderDetail(operator, found.rows[0].id);
  return detail;
}

async function listProducts(operator: Operator, args: ToolArgs) {
  const statusMap: Record<string, string> = { available: "available", unavailable: "unavailable", hidden: "hidden", low: "low_stock", out: "out_of_stock" };
  const status = statusMap[str(args.status)] ?? "";
  const data = await productsData(operator, { q: str(args.search), status });
  const showCost = management.includes(operator.role);
  return {
    total: data.total,
    products: data.products.map((product) => ({ name: product.name, category: product.category_name, price: Number(product.price), ...(showCost ? { cost: product.cost_price === null ? null : Number(product.cost_price) } : {}), status: product.availability, stockLeft: product.stock, options: product.modifier_count })),
  };
}

async function listShifts(operator: Operator, args: ToolArgs) {
  const range = period(operator, args);
  const result = await query<Record<string, unknown>>(
    `SELECT s.business_date::text AS date, s.status, u.name AS opened_by, c.name AS closed_by, s.opening_cash::float AS opening_cash, s.expected_cash::float AS expected_cash,
            s.actual_cash::float AS counted_cash, s.cash_difference::float AS difference, s.order_count AS orders, s.cash_payment_total::float AS cash_sales,
            s.digital_payment_total::float AS digital_sales, s.notes
       FROM pos_shifts s LEFT JOIN users u ON u.id = s.opened_by LEFT JOIN users c ON c.id = s.closed_by
      WHERE s.outlet_key = $1 AND s.business_date BETWEEN $2::date AND $3::date ORDER BY s.opened_at DESC LIMIT 100`, [operator.outletKey, range.from, range.to]);
  return { period: range, shifts: result.rows };
}

async function listExpenses(operator: Operator, args: ToolArgs) {
  const range = period(operator, args);
  const [rows, drawer] = await Promise.all([
    query<{ date: string; category: ExpenseCategory; amount: number; note: string | null }>(
      "SELECT spent_on::text AS date, category, amount::float AS amount, note FROM expenses WHERE outlet_key=$1 AND spent_on BETWEEN $2::date AND $3::date ORDER BY spent_on DESC LIMIT 300",
      [operator.outletKey, range.from, range.to]),
    query<{ at: Date; amount: number; reason: string }>(
      `SELECT created_at AS at, amount::float AS amount, reason FROM shift_cash_movements WHERE outlet_key=$1 AND kind='out'
         AND created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND created_at < ((($3::date) + 1)::timestamp AT TIME ZONE $4) ORDER BY created_at DESC LIMIT 100`,
      [operator.outletKey, range.from, range.to, operator.timezone]),
  ]);
  return { period: range, expenses: rows.rows.map((row) => ({ ...row, category: expenseCategories[row.category] })), tabletCashOut: drawer.rows };
}

async function listPromotions(operator: Operator) {
  const promos = await loadPromotions(pool, operator.outletKey);
  return { promotions: promos.map((promo) => ({ name: promo.name, kind: promo.kind, value: promo.value, active: promo.isActive, code: promo.code, used: promo.used, maxUses: promo.maxUses, channels: promo.channels, days: promo.days, hours: promo.startTime ? `${promo.startTime}-${promo.endTime}` : null })) };
}

async function listAudit(operator: Operator, args: ToolArgs) {
  const range = period(operator, args);
  const result = await query<{ at: Date; action: string; summary: string | null; reason: string | null; actor: string | null; approver: string | null }>(
    `SELECT coalesce((a.metadata->>'at')::timestamptz, a.created_at) AS at, a.action, a.metadata->>'summary' AS summary, a.reason, u.name AS actor, ap.name AS approver
       FROM pos_audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users ap ON ap.id = a.approved_by
      WHERE a.outlet_key = $1 AND a.created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND a.created_at < ((($3::date) + 1)::timestamp AT TIME ZONE $4)
        AND ($5 = '' OR a.action ILIKE $5 || '%') ORDER BY a.created_at DESC LIMIT 100`,
    [operator.outletKey, range.from, range.to, operator.timezone, str(args.action, 40)]);
  return { period: range, events: result.rows };
}

// ---------- File laporan ----------

type Cell = string | number | null;
type Block =
  | { kind: "stats"; items: Array<{ label: string; value: number; kind: CellKind; hint?: string }> }
  | { kind: "kv"; heading: string; rows: Array<[string, number | string, CellKind?, "strong"?]>; note?: string }
  | { kind: "table"; heading: string; columns: Array<{ header: string; kind?: CellKind; width?: number }>; rows: Cell[][]; total?: Cell[]; note?: string };
type ReportDoc = { title: string; subtitle: string; blocks: Block[] };

// Label yang sama dengan dashboard (components/ui.tsx), supaya file tidak berisi kode mentah.
const statusLabel: Record<string, string> = {
  pending_payment: "Awaiting payment", new: "New", accepted: "Accepted", preparing: "Preparing", ready: "Ready", completed: "Completed", cancelled: "Cancelled",
  available: "Available", unavailable: "Sold out", hidden: "Hidden", open: "Open", closed: "Closed",
};
const methodLabel: Record<string, string> = { cash: "Cash", qris: "QRIS", midtrans: "Midtrans", cashier: "Pay at cashier", card: "Card", edc: "Card", transfer: "Transfer", other: "Other" };
const paymentText = (payment: string | null, method: string | null) =>
  payment === "completed" ? methodLabel[method ?? ""] ?? method ?? "Paid" : payment === "refunded" ? "Refunded" : payment === "pending" || !payment ? "Unpaid" : statusLabel[payment] ?? payment;
const sum = (rows: Cell[][], index: number) => rows.reduce((total, row) => total + (typeof row[index] === "number" ? (row[index] as number) : 0), 0);

export const reportKinds = ["summary", "profit_loss", "sales_by_day", "products", "orders", "expenses", "shifts", "stock"] as const;
type ReportKind = (typeof reportKinds)[number];

async function reportDoc(operator: Operator, kind: ReportKind, args: ToolArgs): Promise<ReportDoc> {
  const range = period(operator, args);
  const outlet = (await query<{ name: string }>("SELECT coalesce(public_name, name) AS name FROM outlets WHERE outlet_key=$1", [operator.outletKey])).rows[0]?.name ?? operator.outletKey;
  const span = range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
  const subtitle = `${outlet} · ${span}`;
  if (kind === "stock") {
    const products = await productsData(operator);
    return { title: "Stock", subtitle: `${outlet} · ${new Date().toLocaleDateString("en-GB", { timeZone: operator.timezone, day: "numeric", month: "short", year: "numeric" })}`, blocks: [
      { kind: "table", heading: "Products", columns: [{ header: "Product", width: 3 }, { header: "Category", width: 2 }, { header: "Status" }, { header: "Stock left", kind: "number" }],
        rows: products.products.map((product) => [product.name, product.category_name, statusLabel[product.availability] ?? product.availability, product.stock]), note: "Empty stock means the product is not tracked." },
    ] };
  }
  if (kind === "orders") {
    const result = await query<{ code: string; at: Date; mode: string; table_label: string | null; customer: string | null; cashier: string | null; status: string; method: string | null; payment: string | null; total: number }>(
      `SELECT o.order_code AS code, o.created_at AS at, o.order_mode AS mode, o.table_label, o.customer_name AS customer, u.name AS cashier,
              o.restaurant_status AS status, p.payment_method AS method, p.status AS payment, coalesce(p.amount, 0)::float AS total
         FROM orders o LEFT JOIN payments p ON p.order_id = o.id LEFT JOIN users u ON u.id = o.cashier_id
        WHERE o.outlet_key = $1 AND o.created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND o.created_at < ((($3::date) + 1)::timestamp AT TIME ZONE $4)
        ORDER BY o.created_at LIMIT 5000`, [operator.outletKey, range.from, range.to, operator.timezone]);
    const when = (at: Date) => outletFormat(operator.timezone).formatDateTime(at, true);
    const rows: Cell[][] = result.rows.map((row) => [row.code, when(row.at), row.mode === "dinein" ? `Dine in${row.table_label ? ` · ${row.table_label.replace(/^Dine In - /i, "Table ")}` : ""}` : "Takeaway", row.customer, row.cashier, statusLabel[row.status] ?? row.status, paymentText(row.payment, row.method), row.total]);
    const counted = result.rows.map((row, index) => (row.payment === "completed" && row.status !== "cancelled" ? rows[index] : null)).filter((row): row is Cell[] => row !== null);
    return { title: "Orders", subtitle, blocks: [{ kind: "table", heading: "Orders",
      columns: [{ header: "Code" }, { header: "Date & time" }, { header: "Service", width: 1.4 }, { header: "Customer", width: 1.4 }, { header: "Cashier", width: 1.2 }, { header: "Status" }, { header: "Payment" }, { header: "Total", kind: "money" }],
      rows, total: [`${result.rows.length} orders`, null, null, null, null, null, "Paid", sum(counted, 7)], note: "The total counts paid orders only; cancelled and unpaid orders are listed but not added up." }] };
  }
  if (kind === "expenses") {
    const data = await listExpenses(operator, args);
    return { title: "Expenses", subtitle, blocks: [
      { kind: "table", heading: "Recorded expenses", columns: [{ header: "Date", kind: "date" }, { header: "Category", width: 2 }, { header: "Note", width: 2.5 }, { header: "Amount", kind: "money" }],
        rows: data.expenses.map((row) => [row.date, row.category, row.note, row.amount]), total: ["Total", null, null, data.expenses.reduce((total, row) => total + row.amount, 0)] },
      { kind: "table", heading: "Cash out at the tablet", columns: [{ header: "When" }, { header: "Reason", width: 3 }, { header: "Amount", kind: "money" }],
        rows: data.tabletCashOut.map((row) => [outletFormat(operator.timezone).formatDateTime(row.at, true), row.reason, row.amount]),
        total: ["Total", null, data.tabletCashOut.reduce((total, row) => total + row.amount, 0)] },
    ] };
  }
  if (kind === "shifts") {
    const data = await listShifts(operator, args);
    const rows: Cell[][] = data.shifts.map((row) => [row.date as string, row.opened_by as string, (row.closed_by as string | null) ?? (row.status === "open" ? "Still open" : null), row.orders as number, row.cash_sales as number, row.digital_sales as number, row.expected_cash as number, row.counted_cash as number | null, row.status === "open" ? null : row.difference as number]);
    return { title: "Shifts", subtitle, blocks: [{ kind: "table", heading: "Shifts", columns: [{ header: "Date", kind: "date" }, { header: "Opened by" }, { header: "Closed by" }, { header: "Orders", kind: "number" }, { header: "Cash sales", kind: "money" }, { header: "Digital sales", kind: "money" }, { header: "Expected cash", kind: "money" }, { header: "Counted", kind: "money" }, { header: "Difference", kind: "money" }],
      rows, total: [`${rows.length} shifts`, null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), null, null, sum(rows, 8)], note: "Difference = counted cash minus expected cash. A minus means the drawer was short." }] };
  }
  const data = await reportPack(operator, range);
  const dailyRows: Cell[][] = data.daily.filter((day) => day.orders).map((day) => [day.day, day.orders, round(day.net), round(day.tax), round(day.collected), data.hasCosts ? round(day.profit) : null]);
  const daily: Block = { kind: "table", heading: "Sales by day", columns: [{ header: "Date", kind: "date" }, { header: "Orders", kind: "number" }, { header: "Sales", kind: "money" }, { header: "Tax", kind: "money" }, { header: "Collected", kind: "money" }, { header: "Gross profit", kind: "money" }],
    rows: dailyRows, total: ["Total", sum(dailyRows, 1), sum(dailyRows, 2), sum(dailyRows, 3), sum(dailyRows, 4), data.hasCosts ? sum(dailyRows, 5) : null], note: "Sales are after discounts and without tax. Collected = sales + tax." };
  const productRows: Cell[][] = data.products.map((item) => [item.name, item.category, item.qty, round(item.revenue), item.cost === null ? null : round(item.cost), item.profit === null ? null : round(item.profit)]);
  const products: Block = { kind: "table", heading: "Products", columns: [{ header: "Product", width: 2.4 }, { header: "Category", width: 1.4 }, { header: "Sold", kind: "number" }, { header: "Sales", kind: "money" }, { header: "Cost", kind: "money" }, { header: "Profit", kind: "money" }],
    rows: productRows, total: ["Total", null, sum(productRows, 2), sum(productRows, 3), sum(productRows, 4), sum(productRows, 5)], note: `Product sales are before order discounts.${data.hasCosts ? " Products without a cost show no cost or profit." : " Add product costs to see profit."}` };
  const pnl: Block = { kind: "kv", heading: "Profit & loss", rows: [
    ["Sales before discounts", round(data.money.gross), "money"], ["Discounts", -round(data.money.discounts), "money"], ["Sales", round(data.money.net), "money", "strong"],
    ...(data.hasCosts ? [["Cost of items sold", -round(data.money.cost), "money"], ["Gross profit", round(data.grossProfit), "money", "strong"]] as Array<[string, number, CellKind, "strong"?]> : []),
    ...data.expenses.map((item) => [item.label, -round(item.total), "money"] as [string, number, CellKind]),
    ...(data.hasCosts ? [["Net profit", round(data.netProfit), "money", "strong"]] as Array<[string, number, CellKind, "strong"]> : []),
    ["Tax collected (not income)", round(data.money.tax), "money"], ["Paid orders", data.money.orders, "number"],
  ], note: data.hasCosts ? `Costs cover ${Math.round(data.costCoverage * 100)}% of sales.` : "Add product costs to see profit." };
  const change = (now: number, before: number) => (before > 0 ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% vs previous period` : undefined);
  const stats: Block = { kind: "stats", items: [
    { label: "Sales", value: round(data.money.net), kind: "money", hint: change(data.money.net, data.prev.net) },
    { label: "Paid orders", value: data.money.orders, kind: "number", hint: change(data.money.orders, data.prev.orders) },
    { label: "Average order", value: data.money.orders ? round(data.money.net / data.money.orders) : 0, kind: "money" },
    data.hasCosts ? { label: "Net profit", value: round(data.netProfit), kind: "money" } : { label: "Tax collected", value: round(data.money.tax), kind: "money" },
  ] };
  if (kind === "sales_by_day") return { title: "Sales by day", subtitle, blocks: [daily] };
  if (kind === "products") return { title: "Product sales", subtitle, blocks: [products] };
  if (kind === "profit_loss") return { title: "Profit & loss", subtitle, blocks: [stats, pnl, daily] };
  return { title: "Sales report", subtitle, blocks: [stats, pnl, daily, products] };
}

const money = (value: number) => (value < 0 ? `- ${formatIdr(-value)}` : formatIdr(value));
const cellText = (value: Cell, kind?: CellKind) => (value === null ? "" : typeof value === "number" ? (kind === "money" ? money(value) : kind === "percent" ? `${Math.round(value * 100)}%` : value.toLocaleString("id-ID")) : kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value, true) : value);

function render(doc: ReportDoc, format: "xlsx" | "pdf", generated: string): Buffer {
  if (format === "xlsx") {
    const sheets: Sheet[] = doc.blocks.flatMap((block): Sheet[] => block.kind === "stats" ? []
      : block.kind === "kv"
        ? [{ name: block.heading, columns: [{ header: "Item" }, { header: "Amount", kind: block.rows.some((row) => row[2] === "money") ? "money" : "number" }], rows: block.rows.map(([label, value]) => [label, value]) }]
        : [{ name: block.heading, columns: block.columns.map((column) => ({ header: column.header, kind: column.kind })), rows: block.total && block.rows.length ? [...block.rows, block.total] : block.rows }]);
    return buildXlsx(sheets);
  }
  const sections: PdfSection[] = doc.blocks.map((block): PdfSection => block.kind === "stats"
    ? { kind: "stats", items: block.items.map((item) => ({ label: item.label, value: cellText(item.value, item.kind), hint: item.hint })) }
    : block.kind === "kv"
      ? { kind: "kv", heading: block.heading, rows: block.rows.map(([label, value, kind, tone]) => (tone ? [label, cellText(value, kind), tone] : [label, cellText(value, kind)])), note: block.note }
      : { kind: "table", heading: block.heading, note: block.note, columns: block.columns.map((column) => ({ header: column.header, width: column.width, align: column.kind && column.kind !== "text" && column.kind !== "date" ? "right" : "left" })),
        rows: block.rows.map((row) => row.map((value, index) => cellText(value, block.columns[index]?.kind))), total: block.total?.map((value, index) => cellText(value, block.columns[index]?.kind)) });
  return buildPdf({ title: doc.title, subtitle: doc.subtitle, generated, sections });
}

async function createReportFile(operator: Operator, args: ToolArgs) {
  const report = str(args.report, 30).toLowerCase().replace(/[\s&-]+/g, "_");
  const kind = reportKinds.includes(report as ReportKind) ? (report as ReportKind) : "summary";
  // Model kadang menulis "PDF" atau "excel"; huruf besar-kecil tidak berpengaruh.
  const format = /pdf/i.test(str(args.format, 10)) ? "pdf" : "xlsx";
  const doc = await reportDoc(operator, kind, args);
  const generated = `Generated ${outletFormat(operator.timezone).formatDateTime(new Date(), true)} by ${operator.name}`;
  const file = render(doc, format, generated);
  const name = `${doc.title} ${doc.subtitle.split(" · ").slice(1).join(" ")}`.replace(/[^\w\s.&–-]+/g, "").replace(/\s+/g, " ").trim() + `.${format}`;
  await query("DELETE FROM assistant_files WHERE created_at < now() - interval '7 days'");
  const saved = await query<{ id: string }>(
    "INSERT INTO assistant_files(outlet_key, created_by, name, mime, bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id::text",
    [operator.outletKey, operator.id, name, format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file]);
  return { name, url: `/api/assistant/files/${saved.rows[0].id}`, sizeKb: Math.ceil(file.length / 1024), note: "Give the user this exact markdown link: [Download " + name + "](" + `/api/assistant/files/${saved.rows[0].id}` + ")" };
}

// Draf menu dari percakapan: deskripsi lengkap dari model dibaca oleh pembaca
// menu Import with Eline (prompt yang sudah teruji untuk level, topping,
// ukuran), lalu disimpan sebagai draf yang owner periksa di halaman Import.
// Alat ini tidak pernah menulis ke menu.
async function prepareMenuDraft(operator: Operator, args: ToolArgs) {
  const description = str(args.description, 6000);
  if (!description) return { error: "Describe every category, product, price and option to add." };
  if ((await menuMode(operator.outletKey)).kind === "branch") return { error: "The menu is managed at the main branch. Add products there." };
  const [categories, products] = await Promise.all([
    query<{ name: string }>("SELECT name FROM categories WHERE outlet_key=$1 ORDER BY sort_order, name", [operator.outletKey]),
    query<{ name: string }>("SELECT name FROM products WHERE outlet_key=$1 ORDER BY name LIMIT 300", [operator.outletKey]),
  ]);
  const context = `\n\nExisting categories (reuse these exact names when an item belongs there): ${categories.rows.map((row) => row.name).join(", ") || "none yet"}.\nProducts already on the menu (do not add them again): ${products.rows.map((row) => row.name).join(", ") || "none yet"}.`;
  const { draft } = await readMenu({ images: [], text: (description + context).slice(0, MAX_MENU_TEXT) });
  await query("DELETE FROM menu_drafts WHERE created_at < now() - interval '1 day'");
  const saved = await query<{ id: string }>("INSERT INTO menu_drafts(outlet_key, created_by, draft) VALUES ($1,$2,$3::jsonb) RETURNING id::text", [operator.outletKey, operator.id, JSON.stringify(draft)]);
  const url = `/admin/products/import?draft=${saved.rows[0].id}`;
  return {
    url,
    categories: draft.categories.map((category) => ({
      name: category.name, isNew: !categories.rows.some((row) => row.name.toLowerCase() === category.name.toLowerCase()),
      products: category.products.map((product) => ({ name: product.name, price: product.price, options: product.optionGroups.map((group) => `${group.name}: ${group.options.map((option) => option.priceDelta ? `${option.name} +${option.priceDelta}` : option.name).join(", ")}`) })),
    })),
    warnings: draft.warnings,
    note: `Nothing is saved yet. Summarise the draft briefly, then give the user this exact markdown link on its own line: [Review and add to the menu](${url})`,
  };
}

const tools: Tool[] = [
  { roles: management, status: "Reading the sales report", spec: { name: "get_sales_report", description: "Sales, discounts, tax, profit (when product costs are set), expenses, channels, order types, payment methods, top products, categories, products with no sales, busiest times, refunds, voids and cash drawer results for a date range, with the previous period of the same length for comparison. Use this for any question about sales, income, profit or performance.", parameters: { type: "object", properties: { from: dateArg, to: dateArg } } }, run: salesReport },
  { roles: operations, status: "Looking up orders", spec: { name: "list_orders", description: "Orders from the tablet and the digital menu, newest first, with status, payment, cashier and total. Filter by date range, status (all, unpaid, active, completed, cancelled) and search (order code, customer, table, cashier name).", parameters: { type: "object", properties: { from: dateArg, to: dateArg, status: { type: "string", enum: ["all", "unpaid", "active", "completed", "cancelled"] }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } } } }, run: listOrders },
  { roles: operations, status: "Opening the order", spec: { name: "get_order", description: "One order with its items, options, notes, discount, payment, the cashier who served it, and who cancelled or refunded it, by order code.", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } }, run: getOrder },
  { roles: operations, status: "Checking the menu", spec: { name: "list_products", description: "Menu products with category, price, cost (owner/manager), status and stock left. Filter by search text or status (available, unavailable = sold out, hidden, low = 5 or fewer left, out = out of stock).", parameters: { type: "object", properties: { search: { type: "string" }, status: { type: "string", enum: ["available", "unavailable", "hidden", "low", "out"] } } } }, run: listProducts },
  { roles: management, status: "Checking shifts", spec: { name: "list_shifts", description: "Cashier shifts in a date range: who opened and closed, cash and digital sales, expected and counted cash, and the difference.", parameters: { type: "object", properties: { from: dateArg, to: dateArg } } }, run: listShifts },
  { roles: management, status: "Reading expenses", spec: { name: "list_expenses", description: "Expenses recorded in the dashboard and cash paid out at the tablet in a date range.", parameters: { type: "object", properties: { from: dateArg, to: dateArg } } }, run: listExpenses },
  { roles: management, status: "Checking promotions", spec: { name: "list_promotions", description: "All promotions and coupons with value, active state, how many times used, channels, days and hours.", parameters: { type: "object", properties: {} } }, run: (operator) => listPromotions(operator) },
  { roles: management, status: "Preparing the menu draft", spec: { name: "prepare_menu_draft", description: "Prepare new menu items from the conversation as a draft the user reviews and imports: new or existing categories, products with prices, descriptions, and option groups (sizes, spice levels, sugar or ice levels, toppings, add-ons) with extra prices and whether a choice is required. Put EVERYTHING the user described into description in plain words, e.g. 'Category Minuman: Es Teh Manis 5k, Jeruk 6k with Panas/Es (Es +1k). Toppings for all seblak: telur +3k'. Returns a link to the review page; nothing is saved until the user taps Import.", parameters: { type: "object", properties: { description: { type: "string", description: "Full plain-text description of all categories, products, prices and options to add" } }, required: ["description"] } }, run: prepareMenuDraft },
  { roles: ["owner"], status: "Reading the audit log", spec: { name: "list_audit_log", description: "Audit log events (voids, refunds, discounts, price and cost changes, expenses, team changes, shifts) in a date range, optionally filtered by action prefix such as order., product., expense., shift., user.", parameters: { type: "object", properties: { from: dateArg, to: dateArg, action: { type: "string" } } } }, run: listAudit },
  // Format ada di nama alat, bukan argumen: lewat gateway, model kadang tidak
  // mengirim argumen format sama sekali sehingga permintaan PDF menjadi Excel.
  ...(["pdf", "excel"] as const).map((format): Tool => ({
    roles: management, status: format === "pdf" ? "Making the PDF" : "Making the Excel file",
    spec: { name: `create_${format}_report`, description: `Create a downloadable ${format === "pdf" ? "PDF report (for sharing or printing)" : "Excel spreadsheet (.xlsx, for data to edit or analyse)"} built straight from the outlet's data, so every number matches the dashboard. Reports: summary (profit & loss + sales by day + products), profit_loss, sales_by_day, products, orders, expenses, shifts, stock. Returns a markdown link to give the user.`,
      parameters: { type: "object", properties: { report: { type: "string", enum: [...reportKinds] }, from: dateArg, to: dateArg }, required: ["report"] } },
    run: (operator, args) => createReportFile(operator, { ...args, format: format === "pdf" ? "pdf" : "xlsx" }),
  })),
];

export function toolsFor(role: Role) {
  return tools.filter((tool) => tool.roles.includes(role));
}

export async function runTool(operator: Operator, name: string, args: ToolArgs): Promise<{ status: string; result: unknown }> {
  const tool = toolsFor(operator.role).find((item) => item.spec.name === name);
  if (!tool) return { status: "Checking", result: { error: `Tool ${name} isn't available for this role.` } };
  try {
    return { status: tool.status, result: await tool.run(operator, args) };
  } catch (error) {
    console.error("assistant tool failed", name, error);
    return { status: tool.status, result: { error: "This data couldn't be read right now." } };
  }
}
