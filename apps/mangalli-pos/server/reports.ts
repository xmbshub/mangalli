import "server-only";

import type { ReportPeriod } from "./admin";
import type { Operator } from "./auth";
import { query } from "./db";
import { shiftDate } from "./business-day";
import { previousPeriod, sumMoney, type PaidOrder } from "./report-math";

export { change } from "./report-math";

// Laporan bisnis untuk owner tanpa latar keuangan (permintaan owner 4 Okt 2026).
// Semua angka berasal dari pembayaran lunas dalam rentang tanggal lokal outlet.
//
// Cara total pesanan terbentuk (diverifikasi pada data produksi): unit_price item
// sudah termasuk harga opsinya, diskon dipotong dari jumlah item, lalu pajak
// ditambahkan. Jadi per pesanan:
//   penjualan kotor = Σ jumlah × unit_price
//   penjualan bersih = kotor − diskon
//   pajak = jumlah dibayar − penjualan bersih (persis, walau tarif pernah berubah)
// Harga modal memakai unit_cost yang dibekukan saat pesanan dibuat, atau harga
// modal produk sekarang untuk penjualan lama sebelum HPP diisi.

export const expenseCategories = {
  ingredients: "Ingredients & supplies",
  salaries: "Salaries & wages",
  rent: "Rent",
  utilities: "Bills & utilities",
  marketing: "Marketing & promotion",
  equipment: "Equipment & repairs",
  transport: "Transport & delivery",
  fees: "Bank & app fees",
  other: "Other",
} as const;
export type ExpenseCategory = keyof typeof expenseCategories;

// Pesanan lunas dalam rentang tanggal lokal (termasuk kedua ujung).
function paidOrders(outletKey: string, timezone: string, from: string, to: string) {
  return paidOrdersBetween(outletKey, timezone, `${from} 00:00`, `${shiftDate(to, 1)} 00:00`);
}

// Pesanan lunas di antara dua waktu lokal outlet "YYYY-MM-DD HH:MM" (awal ikut,
// akhir tidak). Dipakai juga oleh email laporan harian untuk jendela hari usaha.
export async function paidOrdersBetween(outletKey: string, timezone: string, start: string, end: string) {
  const result = await query<PaidOrder>(
    `WITH paid AS (
       SELECT o.id, o.channel, o.order_mode, o.discount_amount, p.amount, p.payment_method, (p.paid_at AT TIME ZONE $2) AS local_at
         FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.outlet_key = $1 AND p.status = 'completed'
          AND p.paid_at >= ($3::timestamp AT TIME ZONE $2) AND p.paid_at < ($4::timestamp AT TIME ZONE $2)
     ), lines AS (
       SELECT i.order_id, sum(i.quantity * i.unit_price) AS gross,
              sum(i.quantity * coalesce(i.unit_cost, pr.cost_price)) AS cost,
              sum(i.quantity * i.unit_price) FILTER (WHERE coalesce(i.unit_cost, pr.cost_price) IS NOT NULL) AS costed
         FROM order_items i JOIN paid ON paid.id = i.order_id LEFT JOIN products pr ON pr.id = i.product_id
        GROUP BY i.order_id
     )
     SELECT paid.id::text, paid.channel, paid.order_mode, paid.payment_method, paid.amount::text, paid.discount_amount::text AS discount,
            lines.gross::text, lines.cost::text, lines.costed::text, paid.local_at::date::text AS day,
            extract(hour FROM paid.local_at)::int AS hour, extract(isodow FROM paid.local_at)::int AS dow
       FROM paid LEFT JOIN lines ON lines.order_id = paid.id`,
    [outletKey, timezone, start, end],
  );
  return result.rows;
}

export async function reportPack(operator: Operator, period: ReportPeriod) {
  const args = [operator.outletKey, operator.timezone, period.from, period.to];
  const within = (column: string) => `${column} >= (($3::date)::timestamp AT TIME ZONE $2) AND ${column} < ((($4::date) + 1)::timestamp AT TIME ZONE $2)`;
  const before = previousPeriod(period);
  const [current, previous, products, unsold, expenses, drawer, leakage, shifts, calendar, costSetup] = await Promise.all([
    paidOrders(operator.outletKey, operator.timezone, period.from, period.to),
    paidOrders(operator.outletKey, operator.timezone, before.from, before.to),
    query<{ id: string | null; name: string; category: string | null; qty: string; revenue: string; cost: string | null; costed: boolean }>(
      `SELECT pr.id, coalesce(pr.name, i.item_name, 'Custom amount') AS name, c.name AS category, sum(i.quantity)::text AS qty,
              sum(i.quantity * i.unit_price)::text AS revenue, sum(i.quantity * coalesce(i.unit_cost, pr.cost_price))::text AS cost,
              bool_and(coalesce(i.unit_cost, pr.cost_price) IS NOT NULL) AS costed
         FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments p ON p.order_id = o.id
         LEFT JOIN products pr ON pr.id = i.product_id LEFT JOIN categories c ON c.id = pr.category_id
        WHERE o.outlet_key = $1 AND p.status = 'completed' AND ${within("p.paid_at")}
        GROUP BY pr.id, 2, c.name ORDER BY sum(i.quantity * i.unit_price) DESC`, args),
    query<{ name: string }>(
      `SELECT pr.name FROM products pr WHERE pr.outlet_key = $1 AND pr.availability <> 'hidden'
          AND NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments p ON p.order_id = o.id
                           WHERE i.product_id = pr.id AND p.status = 'completed' AND ${within("p.paid_at")})
        ORDER BY pr.name`, args),
    query<{ category: ExpenseCategory; total: string; count: string }>(
      `SELECT category, sum(amount)::text AS total, count(*)::text AS count FROM expenses
        WHERE outlet_key = $1 AND spent_on BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY sum(amount) DESC`, [operator.outletKey, period.from, period.to]),
    query<{ total: string; count: string }>(
      `SELECT coalesce(sum(amount), 0)::text AS total, count(*)::text AS count FROM shift_cash_movements
        WHERE outlet_key = $1 AND kind = 'out' AND ${within("created_at")}`, args),
    query<{ refund_count: string; refund_total: string; void_count: string; void_total: string; discount_count: string }>(
      `SELECT (SELECT count(*) FROM orders o JOIN payments p ON p.order_id = o.id
                WHERE o.outlet_key = $1 AND p.status = 'completed' AND o.discount_amount > 0 AND ${within("p.paid_at")})::text AS discount_count,
              (SELECT count(*) FROM payments p JOIN orders o ON o.id = p.order_id
                WHERE o.outlet_key = $1 AND p.status = 'refunded' AND ${within("p.refunded_at")})::text AS refund_count,
              (SELECT coalesce(sum(p.refund_amount), 0) FROM payments p JOIN orders o ON o.id = p.order_id
                WHERE o.outlet_key = $1 AND p.status = 'refunded' AND ${within("p.refunded_at")})::text AS refund_total,
              (SELECT count(*) FROM pos_audit_logs WHERE outlet_key = $1 AND action = 'order.item_voided' AND ${within("created_at")})::text AS void_count,
              (SELECT coalesce(sum((metadata->>'amount')::numeric), 0) FROM pos_audit_logs
                WHERE outlet_key = $1 AND action = 'order.item_voided' AND ${within("created_at")})::text AS void_total`, args),
    query<{ count: string; short: string; over: string }>(
      `SELECT count(*)::text AS count, coalesce(sum(-cash_difference) FILTER (WHERE cash_difference < 0), 0)::text AS short,
              coalesce(sum(cash_difference) FILTER (WHERE cash_difference > 0), 0)::text AS over
         FROM pos_shifts WHERE outlet_key = $1 AND status = 'closed' AND ${within("closed_at")}`, args),
    query<{ day: string }>("SELECT d::date::text AS day FROM generate_series($1::date, $2::date, interval '1 day') d", [period.from, period.to]),
    query<{ total: string; costed: string }>(
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE cost_price IS NOT NULL)::text AS costed FROM products WHERE outlet_key = $1 AND availability <> 'hidden'",
      [operator.outletKey]),
  ]);

  const money = sumMoney(current);
  const prev = sumMoney(previous);
  const expenseTotal = expenses.rows.reduce((sum, row) => sum + Number(row.total), 0) + Number(drawer.rows[0]?.total ?? 0);
  const hasCosts = money.cost > 0;
  const grossProfit = money.net - money.cost;
  const netProfit = grossProfit - expenseTotal;

  const byDay = new Map<string, PaidOrder[]>();
  for (const row of current) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const daily = calendar.rows.map(({ day }) => {
    const sums = sumMoney(byDay.get(day) ?? []);
    const cash = (byDay.get(day) ?? []).filter((row) => row.payment_method === "cash").reduce((sum, row) => sum + Number(row.amount), 0);
    return { day, ...sums, cash, digital: sums.collected - cash, profit: sums.net - sums.cost };
  });

  const group = (key: (row: PaidOrder) => string) => {
    const map = new Map<string, PaidOrder[]>();
    for (const row of current) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
    return [...map.entries()].map(([name, rows]) => ({ name, ...sumMoney(rows) })).sort((a, b) => b.net - a.net);
  };

  // Jam ramai: penjualan bersih per hari dalam minggu (1 = Senin) dan jam.
  const heat: Record<string, number> = {};
  for (const row of current) {
    const key = `${row.dow}:${row.hour}`;
    heat[key] = (heat[key] ?? 0) + Math.max(0, Number(row.gross ?? 0) - Number(row.discount));
  }
  const hours = [...new Set(current.map((row) => row.hour))].sort((a, b) => a - b);

  const productRows = products.rows.map((row) => {
    const revenue = Number(row.revenue);
    const cost = row.costed ? Number(row.cost ?? 0) : null;
    return { id: row.id, name: row.name, category: row.category ?? "Other", qty: Number(row.qty), revenue, cost, profit: cost === null ? null : revenue - cost };
  });
  const categoryMap = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const row of productRows) {
    const item = categoryMap.get(row.category) ?? { name: row.category, qty: 0, revenue: 0 };
    item.qty += row.qty;
    item.revenue += row.revenue;
    categoryMap.set(row.category, item);
  }

  return {
    period, previous: before, money, prev,
    hasCosts, grossProfit, netProfit, expenseTotal,
    costCoverage: money.net ? Math.min(1, money.costedNet / money.net) : 0,
    productsCosted: { total: Number(costSetup.rows[0]?.total ?? 0), costed: Number(costSetup.rows[0]?.costed ?? 0) },
    expenses: [
      ...expenses.rows.map((row) => ({ category: row.category as ExpenseCategory | "drawer", label: expenseCategories[row.category] ?? row.category, total: Number(row.total), count: Number(row.count) })),
      ...(Number(drawer.rows[0]?.total ?? 0) ? [{ category: "drawer" as const, label: "Cash paid out at the tablet", total: Number(drawer.rows[0].total), count: Number(drawer.rows[0].count) }] : []),
    ].sort((a, b) => b.total - a.total),
    daily,
    channels: group((row) => (row.channel === "menu" ? "Digital menu" : "Cashier tablet")),
    modes: group((row) => (row.order_mode === "dinein" ? "Dine in" : "Takeaway")),
    methods: group((row) => row.payment_method ?? "other"),
    heat, hours,
    products: productRows,
    categories: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue),
    unsold: unsold.rows.map((row) => row.name),
    leakage: {
      discounts: Number(leakage.rows[0]?.discount_count ?? 0), discountTotal: money.discounts,
      refunds: Number(leakage.rows[0]?.refund_count ?? 0), refundTotal: Number(leakage.rows[0]?.refund_total ?? 0),
      voids: Number(leakage.rows[0]?.void_count ?? 0), voidTotal: Number(leakage.rows[0]?.void_total ?? 0),
    },
    shifts: { count: Number(shifts.rows[0]?.count ?? 0), short: Number(shifts.rows[0]?.short ?? 0), over: Number(shifts.rows[0]?.over ?? 0) },
  };
}
export type ReportPack = Awaited<ReturnType<typeof reportPack>>;

export type ExpenseRow = { id: string; spent_on: string; category: ExpenseCategory; amount: string; note: string | null; created_by: string | null };

// Halaman Expenses: catatan dashboard dalam rentang (opsional per kategori) dan
// kas keluar dari laci tablet yang ikut dihitung laporan (hanya dibaca).
export async function expensesData(operator: Operator, period: ReportPeriod, category: string, page: number, pageSize: number) {
  const filter = Object.hasOwn(expenseCategories, category) ? category : null;
  const args = [operator.outletKey, period.from, period.to, filter];
  const [rows, totals, drawer] = await Promise.all([
    query<ExpenseRow & { total_count: number }>(
      `SELECT e.id::text, e.spent_on::text, e.category, e.amount::text, e.note, u.name AS created_by, count(*) OVER()::int AS total_count
         FROM expenses e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.outlet_key = $1 AND e.spent_on BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR e.category = $4)
        ORDER BY e.spent_on DESC, e.id DESC LIMIT $5 OFFSET $6`, [...args, pageSize, (page - 1) * pageSize]),
    query<{ category: ExpenseCategory; total: string }>(
      "SELECT category, sum(amount)::text AS total FROM expenses WHERE outlet_key = $1 AND spent_on BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY sum(amount) DESC",
      [operator.outletKey, period.from, period.to]),
    query<{ id: string; amount: string; reason: string; created_at: Date; created_by: string | null }>(
      `SELECT m.id::text, m.amount::text, m.reason, m.created_at, u.name AS created_by FROM shift_cash_movements m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.outlet_key = $1 AND m.kind = 'out'
          AND m.created_at >= (($2::date)::timestamp AT TIME ZONE $4) AND m.created_at < ((($3::date) + 1)::timestamp AT TIME ZONE $4)
        ORDER BY m.created_at DESC LIMIT 50`, [operator.outletKey, period.from, period.to, operator.timezone]),
  ]);
  const drawerTotal = drawer.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    rows: rows.rows, total: rows.rows[0]?.total_count ?? 0,
    byCategory: totals.rows.map((row) => ({ category: row.category, label: expenseCategories[row.category], total: Number(row.total) })),
    recorded: totals.rows.reduce((sum, row) => sum + Number(row.total), 0),
    drawer: drawer.rows, drawerTotal,
  };
}
