import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { businessWindow, dueDates, localNow, shiftDate } from "./business-day";
import { query } from "./db";
import { formatDate } from "./format";
import { mailConfigured, sendMail } from "./mailer";
import type { OpeningHour } from "./opening-hours";
import { formatIdr } from "./pos";
import { change, sumMoney } from "./report-math";
import { paidOrdersBetween } from "./reports";
import { availableStockSql } from "./stock";

// Email laporan harian (permintaan owner 4 Okt 2026): owner dan manager aktif
// menerima ringkasan hari usaha 30 menit setelah jam tutup outlet. Penjadwal di
// instrumentation.ts memanggil POST /api/daily-report/run tiap 5 menit; baris
// daily_report_runs mencegah kirim ganda dan mencatat hasilnya.

const appUrl = () => (process.env.MANGALLI_PUBLIC_URL ?? "https://app.mangalli.web.id").replace(/\/+$/, "");
const secret = () => process.env.POS_SESSION_SECRET ?? "";

// Token internal penjadwal dan token berhenti berlangganan, diturunkan dari
// rahasia sesi supaya tidak ada rahasia baru yang perlu dipasang.
export const cronToken = () => createHmac("sha256", secret()).update("mangalli:daily-report:cron").digest("hex");
export const unsubscribeToken = (userId: string) => createHmac("sha256", secret()).update(`mangalli:daily-report:unsubscribe:${userId}`).digest("base64url").slice(0, 32);
export function validToken(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return secret().length >= 16 && a.length === b.length && timingSafeEqual(a, b);
}

type Outlet = { outlet_key: string; name: string; timezone: string; opening_hours: OpeningHour[] | null };
type Recipient = { id: string; name: string; email: string };

export async function dailyReportRecipients(outletKey: string, userId?: string): Promise<Recipient[]> {
  const result = await query<Recipient>(
    `SELECT u.id::text, u.name, u.email FROM users u JOIN outlet_members m ON m.user_id = u.id AND m.outlet_key = $1
      WHERE u.is_active AND m.pos_role IN ('owner', 'manager')
        AND ($2::bigint IS NOT NULL OR NOT u.daily_report_opt_out) AND ($2::bigint IS NULL OR u.id = $2) AND u.email LIKE '%@%.%'
      ORDER BY m.pos_role, u.name`, [outletKey, userId ?? null]);
  return result.rows;
}

async function digest(outlet: Outlet, date: string) {
  const hours = outlet.opening_hours ?? [];
  const window = businessWindow(hours, date);
  const range = (day: string) => { const value = businessWindow(hours, day); return paidOrdersBetween(outlet.outlet_key, outlet.timezone, value.start, value.end); };
  const args = [outlet.outlet_key, outlet.timezone, window.start, window.end];
  const within = (column: string) => `${column} >= ($3::timestamp AT TIME ZONE $2) AND ${column} < ($4::timestamp AT TIME ZONE $2)`;
  const [today, yesterday, lastWeek, top, shifts, leaks, stock, problems] = await Promise.all([
    paidOrdersBetween(outlet.outlet_key, outlet.timezone, window.start, window.end),
    range(shiftDate(date, -1)),
    range(shiftDate(date, -7)),
    query<{ name: string; qty: string; revenue: string }>(
      `SELECT coalesce(pr.name, i.item_name, 'Custom amount') AS name, sum(i.quantity)::text AS qty, sum(i.quantity * i.unit_price)::text AS revenue
         FROM order_items i JOIN orders o ON o.id = i.order_id JOIN payments p ON p.order_id = o.id LEFT JOIN products pr ON pr.id = i.product_id
        WHERE o.outlet_key = $1 AND p.status = 'completed' AND ${within("p.paid_at")}
        GROUP BY 1 ORDER BY sum(i.quantity * i.unit_price) DESC LIMIT 5`, args),
    query<{ closed_by: string | null; expected: string; actual: string | null; difference: string }>(
      `SELECT u.name AS closed_by, s.expected_cash::text AS expected, s.actual_cash::text AS actual, s.cash_difference::text AS difference
         FROM pos_shifts s LEFT JOIN users u ON u.id = s.closed_by
        WHERE s.outlet_key = $1 AND s.status = 'closed' AND ${within("s.closed_at")} ORDER BY s.closed_at`, args),
    query<{ refunds: string; refund_total: string; voids: string; cash_out: string; expired: string }>(
      `SELECT (SELECT count(*) FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.outlet_key = $1 AND p.status = 'refunded' AND ${within("p.refunded_at")})::text AS refunds,
              (SELECT coalesce(sum(p.refund_amount), 0) FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.outlet_key = $1 AND p.status = 'refunded' AND ${within("p.refunded_at")})::text AS refund_total,
              (SELECT count(*) FROM pos_audit_logs WHERE outlet_key = $1 AND action = 'order.item_voided' AND ${within("created_at")})::text AS voids,
              (SELECT coalesce(sum(amount), 0) FROM shift_cash_movements WHERE outlet_key = $1 AND kind = 'out' AND ${within("created_at")})::text AS cash_out,
              (SELECT count(*) FROM orders WHERE outlet_key = $1 AND channel = 'menu' AND restaurant_status = 'cancelled' AND ${within("created_at")}
                  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.status IN ('completed', 'refunded')))::text AS expired`, args),
    query<{ name: string; stock: number }>(
      `SELECT name, stock FROM (SELECT p.name, ${availableStockSql("p")} AS stock FROM products p WHERE p.outlet_key = $1 AND p.stock_quantity IS NOT NULL AND p.availability <> 'hidden') x
        WHERE stock <= 5 ORDER BY stock, name LIMIT 8`, [outlet.outlet_key]),
    query<{ count: string }>("SELECT count(*)::text FROM support_reports WHERE outlet_key = $1 AND status = 'open'", [outlet.outlet_key]),
  ]);
  const money = sumMoney(today);
  const methods = new Map<string, number>();
  for (const row of today) methods.set(row.payment_method ?? "other", (methods.get(row.payment_method ?? "other") ?? 0) + Number(row.amount));
  return {
    outlet, date, window, money, yesterday: sumMoney(yesterday), lastWeek: sumMoney(lastWeek),
    menuOrders: today.filter((row) => row.channel === "menu").length,
    methods: [...methods.entries()].sort((a, b) => b[1] - a[1]),
    top: top.rows.map((row) => ({ name: row.name, qty: Number(row.qty), revenue: Number(row.revenue) })),
    shifts: shifts.rows.map((row) => ({ closedBy: row.closed_by, expected: Number(row.expected), actual: row.actual === null ? null : Number(row.actual), difference: Number(row.difference) })),
    refunds: Number(leaks.rows[0]?.refunds ?? 0), refundTotal: Number(leaks.rows[0]?.refund_total ?? 0), voids: Number(leaks.rows[0]?.voids ?? 0),
    cashOut: Number(leaks.rows[0]?.cash_out ?? 0), expiredMenuOrders: Number(leaks.rows[0]?.expired ?? 0),
    lowStock: stock.rows, problems: Number(problems.rows[0]?.count ?? 0),
  };
}
type Digest = Awaited<ReturnType<typeof digest>>;

const methodLabel: Record<string, string> = { cash: "Cash", qris: "QRIS", midtrans: "Online payment", card: "Card", edc: "Card", transfer: "Transfer", cashier: "Pay at cashier", other: "Other" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const weekdayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

function verdict(d: Digest): string {
  if (!d.money.orders) return d.window.open ? "No paid orders were recorded today. If the outlet was open, check that the tablet synced." : "The outlet was closed today.";
  const vsYesterday = change(d.money.net, d.yesterday.net);
  if (vsYesterday === null) return `You sold ${formatIdr(d.money.net)} from ${d.money.orders} paid ${d.money.orders === 1 ? "order" : "orders"}.`;
  if (vsYesterday >= 10) return `A strong day: sales were ${vsYesterday}% higher than ${weekdayName(shiftDate(d.date, -1))}.`;
  if (vsYesterday <= -10) return `A quieter day: sales were ${Math.abs(vsYesterday)}% lower than ${weekdayName(shiftDate(d.date, -1))}.`;
  return `A steady day: sales were close to ${weekdayName(shiftDate(d.date, -1))} (${vsYesterday >= 0 ? "+" : ""}${vsYesterday}%).`;
}

// Email ditulis dengan tabel dan gaya inline supaya tampil sama di Gmail,
// Outlook, dan aplikasi ponsel. Warna mengikuti dashboard: oranye #EA580C, zinc.
export function renderDigest(d: Digest, recipient: Recipient) {
  const name = escapeHtml(d.outlet.name);
  const day = formatDate(d.date, true);
  const longDay = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const reportUrl = `${appUrl()}/admin/reports?range=custom&from=${d.date}&to=${d.date}`;
  const unsubscribeUrl = `${appUrl()}/api/daily-report/unsubscribe?u=${recipient.id}&t=${unsubscribeToken(recipient.id)}`;
  const chip = (label: string, now: number, before: number) => {
    const value = change(now, before);
    if (value === null) return "";
    const up = value >= 0;
    return `<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 10px;border-radius:999px;font-size:12px;background:${up ? "#ecfdf5" : "#fef2f2"};color:${up ? "#15803d" : "#dc2626"}">${up ? "▲" : "▼"} ${Math.abs(value)}% vs ${label}</span>`;
  };
  const row = (left: string, right: string, sub = "") => `<tr><td style="padding:10px 0;border-top:1px solid #f4f4f5;font-size:14px;color:#3f3f46">${left}${sub ? `<div style="font-size:12px;color:#71717a;margin-top:2px">${sub}</div>` : ""}</td><td style="padding:10px 0;border-top:1px solid #f4f4f5;font-size:14px;color:#18181b;text-align:right;white-space:nowrap">${right}</td></tr>`;
  const section = (title: string, body: string) => `<tr><td style="padding:20px 24px 4px"><div style="font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${title}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${body}</table></td></tr>`;
  const attention: string[] = [];
  for (const item of d.lowStock) attention.push(`${escapeHtml(item.name)}: ${item.stock <= 0 ? "out of stock" : `only ${item.stock} left`}`);
  const short = d.shifts.filter((shift) => shift.difference < 0);
  if (short.length) attention.push(`Cash drawer short by ${formatIdr(short.reduce((sum, shift) => sum - shift.difference, 0))}`);
  if (d.expiredMenuOrders) attention.push(`${d.expiredMenuOrders} digital menu ${d.expiredMenuOrders === 1 ? "order was" : "orders were"} never paid and cancelled`);
  if (d.refunds) attention.push(`${d.refunds} ${d.refunds === 1 ? "refund" : "refunds"} (${formatIdr(d.refundTotal)})`);
  if (d.problems) attention.push(`${d.problems} open problem ${d.problems === 1 ? "report" : "reports"} in Support`);

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e4e4e7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px"><img src="${appUrl()}/images/brands/mangalli-fnb-logo.png" width="36" height="36" alt="Mangalli" style="display:block;border-radius:50%;border:1px solid #e4e4e7;background:#fff"></td>
<td style="padding-left:12px"><div style="font-size:15px;color:#18181b">Daily report · ${name}</div><div style="font-size:12px;color:#71717a">${longDay}</div></td></tr></table></td></tr>
<tr><td style="padding:24px 24px 8px">
<div style="font-size:13px;color:#71717a">Sales</div>
<div style="font-size:32px;line-height:1.25;color:#18181b">${formatIdr(d.money.net)}</div>
<div style="font-size:13px;color:#71717a;margin-top:2px">${d.money.orders} paid ${d.money.orders === 1 ? "order" : "orders"}${d.money.orders ? ` · average ${formatIdr(d.money.net / d.money.orders)}` : ""}${d.menuOrders ? ` · ${d.menuOrders} from the digital menu` : ""}</div>
<div style="margin-top:8px">${chip(weekdayName(shiftDate(d.date, -1)), d.money.net, d.yesterday.net)}${chip(`last ${weekdayName(d.date)}`, d.money.net, d.lastWeek.net)}</div>
<p style="margin:16px 0 0;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;font-size:14px;line-height:1.55;color:#3f3f46">${escapeHtml(verdict(d))}</p>
</td></tr>
${d.money.orders ? section("Money in", [
    ...d.methods.map(([method, total]) => row(methodLabel[method] ?? method, formatIdr(total))),
    row("Tax collected", formatIdr(d.money.tax), "Set aside for tax, not income"),
    d.money.discounts ? row("Discounts given", `− ${formatIdr(d.money.discounts)}`) : "",
    d.money.cost ? row("Estimated gross profit", formatIdr(d.money.net - d.money.cost), "Sales minus the cost of the items sold") : "",
  ].join("")) : ""}
${d.top.length ? section("Best sellers", d.top.map((item, index) => row(`${index + 1}. ${escapeHtml(item.name)}`, formatIdr(item.revenue), `${item.qty} sold`)).join("")) : ""}
${d.shifts.length || d.cashOut ? section("Cash drawer", [
    ...d.shifts.map((shift) => row(`Shift closed${shift.closedBy ? ` by ${escapeHtml(shift.closedBy)}` : ""}`, shift.difference === 0 ? "Balanced" : `${shift.difference < 0 ? "Short" : "Over"} ${formatIdr(Math.abs(shift.difference))}`, `Expected ${formatIdr(shift.expected)}${shift.actual === null ? "" : ` · counted ${formatIdr(shift.actual)}`}`)),
    d.cashOut ? row("Cash paid out", formatIdr(d.cashOut), "Taken from the drawer for expenses") : "",
  ].join("")) : ""}
${attention.length ? `<tr><td style="padding:20px 24px 4px"><div style="font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Needs your attention</div>${attention.map((item) => `<div style="padding:9px 12px;margin-bottom:6px;background:#fef2f2;border-radius:10px;font-size:14px;color:#3f3f46">${item}</div>`).join("")}</td></tr>` : ""}
<tr><td style="padding:20px 24px 24px"><a href="${reportUrl}" style="display:inline-block;padding:11px 18px;background:#ea580c;color:#ffffff;text-decoration:none;border-radius:12px;font-size:14px">Open full report</a></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:16px 8px;font-size:12px;line-height:1.6;color:#71717a;text-align:center">
You get this email as an owner or manager at ${name}. <a href="${unsubscribeUrl}" style="color:#71717a">Stop daily reports</a><br>Mangalli POS · Developed by 1garis Studio</td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    `Daily report · ${d.outlet.name} · ${day}`,
    "",
    `Sales: ${formatIdr(d.money.net)} from ${d.money.orders} paid orders`,
    verdict(d),
    "",
    ...d.methods.map(([method, total]) => `${methodLabel[method] ?? method}: ${formatIdr(total)}`),
    `Tax collected: ${formatIdr(d.money.tax)}`,
    "",
    d.top.length ? "Best sellers:" : "",
    ...d.top.map((item, index) => `${index + 1}. ${item.name}: ${item.qty} sold, ${formatIdr(item.revenue)}`),
    "",
    ...(attention.length ? ["Needs your attention:", ...attention.map((item) => `- ${item.replace(/&amp;/g, "&").replace(/&#39;/g, "'")}`), ""] : []),
    `Full report: ${reportUrl}`,
    `Stop daily reports: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: `${d.outlet.name} · ${day}: ${formatIdr(d.money.net)} from ${d.money.orders} ${d.money.orders === 1 ? "order" : "orders"}`, html, text };
}

async function outletRow(outletKey: string): Promise<Outlet | null> {
  const result = await query<Outlet>(
    "SELECT outlet_key, coalesce(public_name, name) AS name, timezone, opening_hours FROM outlets WHERE outlet_key = $1 AND is_active", [outletKey]);
  return result.rows[0] ?? null;
}

// Mengirim laporan satu hari usaha. Dipakai penjadwal dan tombol "Send a test".
export async function sendDailyReport(outletKey: string, date: string, onlyUserId?: string): Promise<{ sent: number; skipped?: string }> {
  if (!mailConfigured()) throw new Error("Email isn't set up on this server yet.");
  const outlet = await outletRow(outletKey);
  if (!outlet) throw new Error("Outlet not found.");
  const recipients = await dailyReportRecipients(outletKey, onlyUserId);
  if (!recipients.length) return { sent: 0, skipped: "no recipients" };
  const data = await digest(outlet, date);
  if (!onlyUserId && !data.money.orders && !data.window.open) return { sent: 0, skipped: "closed with no sales" };
  let sent = 0;
  for (const recipient of recipients) {
    const mail = renderDigest(data, recipient);
    await sendMail({ to: recipient.email, ...mail, fromName: `${outlet.name} via Mangalli` });
    sent += 1;
  }
  return { sent };
}

export async function runDailyReports(now = new Date()) {
  if (!mailConfigured()) return { checked: 0, sent: 0, note: "email not configured" };
  const outlets = await query<Outlet>(
    `SELECT o.outlet_key, coalesce(o.public_name, o.name) AS name, o.timezone, o.opening_hours FROM outlets o
      WHERE o.is_active AND EXISTS (SELECT 1 FROM users u JOIN outlet_members m ON m.user_id = u.id
        WHERE m.outlet_key = o.outlet_key AND u.is_active AND m.pos_role IN ('owner', 'manager') AND NOT u.daily_report_opt_out)`);
  let sent = 0;
  for (const outlet of outlets.rows) {
    for (const date of dueDates(outlet.opening_hours ?? [], localNow(now, outlet.timezone))) {
      // Klaim hari ini untuk outlet ini; percobaan gagal diulang paling banyak tiga kali, tiap 30 menit.
      const claim = await query(
        `INSERT INTO daily_report_runs(outlet_key, business_date) VALUES ($1, $2)
         ON CONFLICT (outlet_key, business_date) DO UPDATE SET attempts = daily_report_runs.attempts + 1, started_at = now(), error = NULL
           WHERE daily_report_runs.sent_at IS NULL AND daily_report_runs.error IS NOT NULL AND daily_report_runs.attempts < 3
             AND daily_report_runs.started_at < now() - interval '30 minutes'
         RETURNING outlet_key`, [outlet.outlet_key, date]);
      if (!claim.rowCount) continue;
      try {
        const result = await sendDailyReport(outlet.outlet_key, date);
        await query("UPDATE daily_report_runs SET sent_at = now(), recipients = $3, error = $4 WHERE outlet_key = $1 AND business_date = $2",
          [outlet.outlet_key, date, result.sent, result.skipped ? `skipped: ${result.skipped}` : null]);
        sent += result.sent;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("daily report failed", outlet.outlet_key, date, message);
        await query("UPDATE daily_report_runs SET error = $3 WHERE outlet_key = $1 AND business_date = $2", [outlet.outlet_key, date, message.slice(0, 500)]);
      }
    }
  }
  return { checked: outlets.rowCount ?? 0, sent };
}
