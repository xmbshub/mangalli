import { ArrowDownRight, ArrowUpRight, Download, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateField, FilterForm, Hint } from "@/components/interactive";
import { EmptyState, Kpi, PageHeader, Panel, Segmented, Tabs, paymentMethodLabel } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { reportRanges, type ReportPeriod, type ReportRange } from "@/server/admin";
import { formatDate } from "@/server/format";
import { formatIdr } from "@/server/pos";
import { change, reportPack, type ReportPack } from "@/server/reports";

// Reports untuk owner tanpa latar keuangan (permintaan owner 4 Okt 2026): empat
// tab dengan bahasa sehari-hari. Setiap angka penting punya penjelasan singkat
// di tooltip, dan Summary menceritakan hasilnya dalam kalimat.

export const reportTabs = { summary: "Summary", profit: "Profit & loss", sales: "Sales", products: "Products" } as const;
export type ReportTab = keyof typeof reportTabs;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Persen bulat; nilai kecil tapi ada ditulis "<1%" supaya tidak terbaca nol.
const percent = (part: number, whole: number) => {
  if (!whole) return "—";
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
};

function Delta({ now, before, label, invert = false }: { now: number; before: number; label: string; invert?: boolean }) {
  const value = change(now, before);
  if (value === null) return <>No data for the {label} before</>;
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`delta ${good ? "up" : "down"}`}><Icon size={13} />{Math.abs(value)}% vs {label} before</span>;
}

function Line({ label, hint, value, note, strong = false, minus = false, indent = false }: {
  label: string; hint?: ReactNode; value: number | null; note?: ReactNode; strong?: boolean; minus?: boolean; indent?: boolean;
}) {
  return (
    <div className={`statement-row${strong ? " total" : ""}${indent ? " indent" : ""}`}>
      <span className="statement-label">{label}{hint ? <Hint>{hint}</Hint> : null}</span>
      <span className="statement-note">{note}</span>
      <span className={`num statement-value${value !== null && value < 0 ? " negative" : ""}`}>{value === null ? "—" : `${minus ? "− " : ""}${formatIdr(Math.abs(value))}`}</span>
    </div>
  );
}

export async function ReportsSection({ operator, period, tab }: { operator: Operator; period: ReportPeriod; tab: ReportTab }) {
  const data = await reportPack(operator, period);
  const range = `range=${period.range}${period.range === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`;
  const label = period.from === period.to ? formatDate(period.from, true) : `${formatDate(period.from)} – ${formatDate(period.to)}`;
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1;
  const span = days === 1 ? "day" : `${days} days`;
  const href = (key: string) => `/admin/reports?tab=${key}&${range}`;
  return (
    <div className="page">
      <PageHeader
        title="Reports"
        description={`${label}. Paid orders only.`}
        action={<a className="button" download href={`/api/reports/export?${range}`}><Download size={16} /> CSV</a>}
      />
      <div className="report-range">
        <Segmented items={(["today", "7", "30", "90", "month"] as ReportRange[]).map((key) => ({ href: `/admin/reports?tab=${tab}&range=${key}`, label: reportRanges[key], active: key === period.range }))} />
        <FilterForm action="/admin/reports">
          <input name="tab" type="hidden" value={tab} />
          <input name="range" type="hidden" value="custom" />
          <DateField defaultValue={period.from} label="From date" max={period.to} name="from" placeholder="From" submitOnChange />
          <span className="muted">to</span>
          <DateField defaultValue={period.to} label="To date" min={period.from} name="to" placeholder="To" submitOnChange />
        </FilterForm>
      </div>
      <Tabs items={(Object.keys(reportTabs) as ReportTab[]).map((key) => ({ href: href(key), label: reportTabs[key], active: key === tab }))} />
      {data.money.orders === 0 && tab !== "profit" ? <Panel><EmptyState title="No paid orders in this period" /></Panel>
        : tab === "profit" ? <ProfitTab data={data} span={span} />
        : tab === "sales" ? <SalesTab data={data} />
        : tab === "products" ? <ProductsTab data={data} />
        : <SummaryTab data={data} label={label} span={span} />}
    </div>
  );
}

function SummaryTab({ data, label, span }: { data: ReportPack; label: string; span: string }) {
  const { money, prev } = data;
  const best = data.products[0];
  const busiest = Object.entries(data.heat).sort((a, b) => b[1] - a[1])[0];
  const salesChange = change(money.net, prev.net);
  const peak = Math.max(...data.daily.map((day) => day.net), 1);
  const insights: ReactNode[] = [];
  if (best) insights.push(<><strong>{best.name}</strong> brought in the most money: {formatIdr(best.revenue)} from {best.qty} sold.</>);
  if (busiest) {
    const [dow, hour] = busiest[0].split(":").map(Number);
    insights.push(<>Your busiest time is <strong>{DAYS[dow - 1]} around {String(hour).padStart(2, "0")}:00</strong>. Have enough staff and stock ready then.</>);
  }
  if (money.discounts) insights.push(<>Discounts cost you <strong>{formatIdr(money.discounts)}</strong>, {percent(money.discounts, money.gross)} of sales before discounts.</>);
  if (data.unsold.length) insights.push(<><strong>{data.unsold.length} {data.unsold.length === 1 ? "product" : "products"}</strong> didn&apos;t sell at all{data.unsold.length <= 3 ? ` (${data.unsold.join(", ")})` : ""}. Consider a promo or taking them off the menu.</>);
  if (!data.hasCosts) insights.push(<>Add a <strong>Cost</strong> to your products to see how much profit each sale makes. <Link className="link" href="/admin/products">Go to Products</Link></>);
  if (data.shifts.short) insights.push(<>Cash drawers were <strong>{formatIdr(data.shifts.short)} short</strong> across closed shifts. Check Shifts for the notes.</>);
  return (
    <div className="bento">
      <Panel className="span-12 story" padded>
        <p className="story-text">
          In {label.toLowerCase().startsWith("today") ? "today's sales" : `these ${span}`} you made <strong>{formatIdr(money.net)}</strong> in sales from <strong>{money.orders} paid {money.orders === 1 ? "order" : "orders"}</strong>
          {salesChange === null ? "." : <>, {Math.abs(salesChange)}% {salesChange >= 0 ? "more" : "less"} than the {span} before.</>}
          {" "}{data.hasCosts
            ? <>After the cost of the items you sold{data.expenseTotal ? " and your expenses" : ""}, about <strong>{formatIdr(data.netProfit)}</strong> was left as profit.</>
            : <>Add product costs and expenses to see your profit too.</>}
        </p>
      </Panel>
      <Kpi label="Sales" value={formatIdr(money.net)} hint={<Delta before={prev.net} label={span} now={money.net} />} />
      <Kpi label="Paid orders" value={money.orders} hint={<Delta before={prev.orders} label={span} now={money.orders} />} />
      <Kpi label="Average order" value={formatIdr(money.orders ? money.net / money.orders : 0)} hint={<Delta before={prev.orders ? prev.net / prev.orders : 0} label={span} now={money.orders ? money.net / money.orders : 0} />} />
      <Kpi label="Profit" value={data.hasCosts ? formatIdr(data.netProfit) : "—"} hint={data.hasCosts ? `${percent(data.netProfit, money.net)} of sales` : <Link className="link" href="/admin/products">Add product costs</Link>} />
      <Panel className="span-8" title="Sales by day" description="Tap a bar for the numbers">
        <div className="report-chart">
          <div className="bars">{data.daily.map((day) => <span aria-label={`${formatDate(day.day)} · ${formatIdr(day.net)}`} className={day.net ? "bar has" : "bar"} tabIndex={0} data-label={`${formatDate(day.day)} · ${formatIdr(day.net)}${data.hasCosts ? ` · profit ${formatIdr(day.profit)}` : ""}`} key={day.day} style={{ height: `${Math.max(2, (day.net / peak) * 100)}%` }} />)}</div>
          <div className="bar-axis">{data.daily.map((day, index) => <span key={day.day}>{index === 0 || index === data.daily.length - 1 ? formatDate(day.day).replace(/ \d{4}$/, "") : ""}</span>)}</div>
        </div>
      </Panel>
      <Panel className="span-4" title="What stands out">
        <ul className="insights">{insights.map((item, index) => <li key={index}><Lightbulb size={15} /><span>{item}</span></li>)}</ul>
      </Panel>
      <BusyTimes data={data} className="span-8" />
      <Panel className="span-4" title="Top products" description="By sales">
        <div className="list">{data.products.slice(0, 6).map((item) => (
          <div className="list-row" key={item.name}>
            <div style={{ flex: 1, minWidth: 0 }}><strong className="truncate">{item.name}</strong><span className="cell-sub">{item.qty} sold</span><div className="meter"><span style={{ width: percent(item.revenue, data.products[0]?.revenue ?? 1) }} /></div></div>
            <span className="num">{formatIdr(item.revenue)}</span>
          </div>
        ))}</div>
      </Panel>
    </div>
  );
}

function BusyTimes({ data, className }: { data: ReportPack; className: string }) {
  const max = Math.max(...Object.values(data.heat), 1);
  return (
    <Panel className={className} title="Busy times" description="Sales by day and hour. Darker means busier">
      {data.hours.length ? (
        <div className="heatmap" style={{ gridTemplateColumns: `40px repeat(${data.hours.length}, minmax(0, 1fr))` }}>
          <span />
          {data.hours.map((hour) => <span className="heat-hour" key={hour}>{String(hour).padStart(2, "0")}</span>)}
          {DAYS.map((day, index) => [
            <span className="heat-day" key={day}>{day}</span>,
            ...data.hours.map((hour) => {
              const value = data.heat[`${index + 1}:${hour}`] ?? 0;
              return <span className="heat-cell" data-label={`${day} ${String(hour).padStart(2, "0")}:00 · ${formatIdr(value)}`} key={`${day}-${hour}`} style={{ "--heat": value ? 0.12 + (value / max) * 0.88 : 0 } as React.CSSProperties} />;
            }),
          ])}
        </div>
      ) : <EmptyState title="No sales" />}
    </Panel>
  );
}

function ProfitTab({ data, span }: { data: ReportPack; span: string }) {
  const { money } = data;
  const coverage = Math.round(data.costCoverage * 100);
  return (
    <div className="bento">
      <Kpi label="Sales" value={formatIdr(money.net)} hint={<Delta before={data.prev.net} label={span} now={money.net} />} />
      <Kpi label="Gross profit" value={data.hasCosts ? formatIdr(data.grossProfit) : "—"} hint={data.hasCosts ? `${percent(data.grossProfit, money.net)} of sales` : "Needs product costs"} />
      <Kpi label="Expenses" value={formatIdr(data.expenseTotal)} hint={`${percent(data.expenseTotal, money.net)} of sales`} />
      <Kpi label="Net profit" value={data.hasCosts ? formatIdr(data.netProfit) : "—"} tone={data.netProfit < 0 ? "down" : undefined} hint={data.hasCosts ? `${percent(data.netProfit, money.net)} of sales` : "Needs product costs"} />
      <Panel className="span-8" title="Profit & loss" description="Income first, then costs">
        <div className="statement">
          <Line hint="Everything customers paid for food and drinks at menu price, before discounts. Tax is not included." label="Sales before discounts" value={money.gross} />
          <Line hint="Promos, coupons and manual discounts given at the cashier and on the digital menu." indent label="Discounts" minus note={money.gross ? percent(money.discounts, money.gross) : null} value={money.discounts} />
          <Line hint="What you really charged for what you sold. This is your income from sales." label="Sales" strong value={money.net} />
          <Line hint={<>What the items you sold cost you to make, from each product&apos;s <strong>Cost</strong>. {coverage < 100 ? `Only ${coverage}% of sales have a cost, so the real number is higher.` : ""}</>} indent label="Cost of items sold" minus note={data.hasCosts ? percent(money.cost, money.net) : "No costs yet"} value={data.hasCosts ? money.cost : null} />
          <Line hint="Sales minus the cost of the items. This money pays for rent, salaries and bills." label="Gross profit" note={data.hasCosts ? percent(data.grossProfit, money.net) : null} strong value={data.hasCosts ? data.grossProfit : null} />
          {data.expenses.length ? data.expenses.map((item) => <Line indent key={item.category} label={item.label} minus note={`${item.count} ${item.count === 1 ? "entry" : "entries"}`} value={item.total} />)
            : <Line hint="Rent, salaries, bills and other costs you record on the Expenses page. Cash paid out at the tablet is added automatically." indent label="Expenses" minus note="None recorded" value={0} />}
          {data.expenses.length > 1 ? <Line hint="All the expenses above added together: rent, salaries, bills and cash paid out at the tablet." label="Total expenses" minus note={percent(data.expenseTotal, money.net)} value={data.expenseTotal} /> : null}
          <Line hint="What the business earned after every cost you recorded. If it is negative, costs were higher than sales." label="Net profit" note={data.hasCosts ? percent(data.netProfit, money.net) : null} strong value={data.hasCosts ? data.netProfit : null} />
        </div>
      </Panel>
      <div className="span-4 stack">
        <Panel title="Good to know">
          <div className="list">
            <div className="list-row"><div style={{ flex: 1 }}><strong>Tax collected <Hint>Tax added to bills on top of prices. It belongs to the tax office, so it is not counted as income.</Hint></strong><span className="cell-sub">Set aside for tax</span></div><span className="num">{formatIdr(money.tax)}</span></div>
            <div className="list-row"><div style={{ flex: 1 }}><strong>Money collected</strong><span className="cell-sub">Sales plus tax, all payments</span></div><span className="num">{formatIdr(money.collected)}</span></div>
            <div className="list-row"><div style={{ flex: 1 }}><strong>Refunds</strong><span className="cell-sub">{data.leakage.refunds} orders, already left out of sales</span></div><span className="num">{formatIdr(data.leakage.refundTotal)}</span></div>
            <div className="list-row"><div style={{ flex: 1 }}><strong>Voided items</strong><span className="cell-sub">{data.leakage.voids} items removed from bills</span></div><span className="num">{formatIdr(data.leakage.voidTotal)}</span></div>
          </div>
        </Panel>
        <Panel title="Make it accurate" padded>
          <p className="muted small">{data.productsCosted.costed} of {data.productsCosted.total} products have a cost. {coverage < 100 ? `${coverage}% of this period's sales are covered.` : "All sales are covered."}</p>
          <div className="button-row">
            <Link className="button small" href="/admin/products">Set product costs</Link>
            <Link className="button small primary" href="/admin/expenses?new=1"><Plus size={14} /> Add expense</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SalesTab({ data }: { data: ReportPack }) {
  const shareList = (rows: ReportPack["channels"], name: (value: string) => string) => (
    <div className="list">{rows.map((item) => (
      <div className="list-row" key={item.name}>
        <div style={{ flex: 1 }}><strong>{name(item.name)}</strong><span className="cell-sub">{item.orders} orders · {percent(item.net, data.money.net)}</span><div className="meter"><span style={{ width: percent(item.net, data.money.net) }} /></div></div>
        <span className="num">{formatIdr(item.net)}</span>
      </div>
    ))}</div>
  );
  return (
    <div className="bento">
      <Panel className="span-4" title="Where orders came from">{shareList(data.channels, (value) => value)}</Panel>
      <Panel className="span-4" title="Order types">{shareList(data.modes, (value) => value)}</Panel>
      <Panel className="span-4" title="Payment methods">{shareList(data.methods, (value) => paymentMethodLabel[value] ?? value)}</Panel>
      <BusyTimes data={data} className="span-12" />
      <Panel className="span-12" title="By day" description="Sales exclude tax" info="Collected is what customers paid, tax included.">
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th className="right">Orders</th><th className="right">Sales</th><th className="right">Tax</th><th className="right hide-sm">Cash</th><th className="right hide-sm">Digital</th><th className="right">Collected</th></tr></thead>
          <tbody>{[...data.daily].reverse().filter((day) => day.orders).map((day) => (
            <tr key={day.day}><td>{formatDate(day.day, true)}</td><td className="right num">{day.orders}</td><td className="right num">{formatIdr(day.net)}</td><td className="right num muted">{formatIdr(day.tax)}</td>
              <td className="right num hide-sm">{formatIdr(day.cash)}</td><td className="right num hide-sm">{formatIdr(day.digital)}</td><td className="right num"><strong>{formatIdr(day.collected)}</strong></td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}

function ProductsTab({ data }: { data: ReportPack }) {
  const total = data.products.reduce((sum, item) => sum + item.revenue, 0);
  return (
    <div className="bento">
      <Panel className="span-8" title="Products" description="Sales at menu price before order discounts">
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th className="right">Sold</th><th className="right">Sales</th><th className="right hide-sm">Cost</th><th className="right">Profit <Hint>Sales minus the cost of the items sold. Set a Cost on the product to see it.</Hint></th><th className="right hide-sm">Share</th></tr></thead>
          <tbody>{data.products.map((item) => (
            <tr key={`${item.id}-${item.name}`}>
              <td><strong>{item.name}</strong><span className="cell-sub">{item.category}</span></td>
              <td className="right num">{item.qty}</td><td className="right num">{formatIdr(item.revenue)}</td>
              <td className="right num hide-sm muted">{item.cost === null ? "—" : formatIdr(item.cost)}</td>
              <td className="right num">{item.profit === null ? <Link className="link muted" href={item.id ? `/admin/products?edit=${item.id}` : "/admin/products"}>Add cost</Link> : <>{formatIdr(item.profit)}<span className="cell-sub">{percent(item.profit, item.revenue)} margin</span></>}</td>
              <td className="right num hide-sm muted">{percent(item.revenue, total)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <div className="span-4 stack">
        <Panel title="Categories">
          <div className="list">{data.categories.map((item) => (
            <div className="list-row" key={item.name}>
              <div style={{ flex: 1 }}><strong>{item.name}</strong><span className="cell-sub">{item.qty} sold · {percent(item.revenue, total)}</span><div className="meter"><span style={{ width: percent(item.revenue, total) }} /></div></div>
              <span className="num">{formatIdr(item.revenue)}</span>
            </div>
          ))}</div>
        </Panel>
        <Panel title="Didn't sell" description={data.unsold.length ? `${data.unsold.length} products with no paid orders` : undefined}>
          {data.unsold.length ? <div className="list">{data.unsold.slice(0, 12).map((name) => <div className="list-row" key={name}><span>{name}</span></div>)}</div> : <EmptyState title="Every product sold at least once" />}
        </Panel>
      </div>
    </div>
  );
}
