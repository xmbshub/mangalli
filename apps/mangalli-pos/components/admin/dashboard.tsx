import { ArrowRight, BellRing, CircleDollarSign, ReceiptText, Wallet } from "lucide-react";
import Link from "next/link";

import { Badge, EmptyState, Kpi, PageHeader, Panel, paymentMethodLabel } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { dashboardData } from "@/server/admin";
import { outletFormat } from "@/server/format";
import { formatIdr } from "@/server/pos";

export async function DashboardSection({ operator }: { operator: Operator }) {
  const data = await dashboardData(operator);
  const { formatDateTime, formatTime, todayLabel } = outletFormat(operator.timezone);
  const change = data.yesterdaySameTime ? (data.sales - data.yesterdaySameTime) / data.yesterdaySameTime : null;
  const attention = data.unpaid + data.kitchen;
  const peak = Math.max(...data.byHour, 1);
  const firstHour = Math.min(7, ...data.byHour.flatMap((value, hour) => (value ? [hour] : [])));
  const lastHour = Math.max(22, ...data.byHour.flatMap((value, hour) => (value ? [hour] : [])));
  const hours = data.byHour.slice(firstHour, lastHour + 1).map((value, index) => ({ hour: firstHour + index, value }));
  const methodTotal = data.methods.reduce((sum, item) => sum + item.total, 0);
  const canSeeOrders = operator.role !== "viewer";

  return (
    <div className="page">
      <PageHeader title="Overview" description={todayLabel()} action={canSeeOrders ? <Link className="button primary" href="/admin/orders">Orders <ArrowRight size={16} /></Link> : undefined} />
      <div className="bento">
        <Kpi icon={<CircleDollarSign size={16} />} label="Sales" value={formatIdr(data.sales)}
          hint={change === null ? "Today" : `${change >= 0 ? "+" : ""}${Math.round(change * 100)}% vs yesterday`}
          tone={change === null ? undefined : change >= 0 ? "up" : "down"} />
        <Kpi icon={<ReceiptText size={16} />} label="Paid orders" value={data.count} hint="Today" />
        <Kpi icon={<Wallet size={16} />} label="Average order" value={formatIdr(data.average)} hint="Today" />
        <Kpi icon={<BellRing size={16} />} label="Needs attention" value={attention}
          hint={`${data.unpaid} unpaid · ${data.kitchen} cooking · ${data.ready} ready`}
          href={canSeeOrders && attention ? (data.unpaid ? "/admin/orders?tab=unpaid" : "/admin/kitchen") : undefined} />

        <Panel className="span-8" title="Sales by hour">
          {data.sales ? (
            <div>
              <div className="bars">{hours.map((item) => <span aria-label={`${String(item.hour).padStart(2, "0")}:00 · ${formatIdr(item.value)}`} className={item.value ? "bar has" : "bar"} tabIndex={0} data-label={`${String(item.hour).padStart(2, "0")}:00 · ${formatIdr(item.value)}`} key={item.hour} style={{ height: `${Math.max(1, (item.value / peak) * 100)}%` }} />)}</div>
              <div className="bar-axis">{hours.map((item) => <span key={item.hour}>{item.hour % 3 === 0 ? String(item.hour).padStart(2, "0") : ""}</span>)}</div>
            </div>
          ) : <EmptyState title="No sales yet" />}
        </Panel>
        <Panel className="span-4" title="Payment methods">
          {data.methods.length ? (
            <div className="list">{data.methods.map((item) => (
              <div className="list-row" key={item.method}>
                <div style={{ flex: 1 }}><strong>{paymentMethodLabel[item.method] ?? item.method}</strong><span className="cell-sub">{item.count} orders</span><div className="meter"><span style={{ width: `${methodTotal ? (item.total / methodTotal) * 100 : 0}%` }} /></div></div>
                <span className="num">{formatIdr(item.total)}</span>
              </div>
            ))}</div>
          ) : <EmptyState title="No payments yet" />}
        </Panel>

        <Panel className="span-8 row-2" title="Latest orders" action={canSeeOrders ? <Link className="button small ghost" href="/admin/orders">View all</Link> : undefined}>
          {data.recent.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="right">Total</th></tr></thead>
              <tbody>{data.recent.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">{canSeeOrders ? <Link href={`/admin/orders?order=${row.id}`}><strong>{row.order_code}</strong></Link> : <strong>{row.order_code}</strong>}<span className="cell-sub">{formatDateTime(row.created_at)}</span></td>
                  <td>{row.customer_name || "Walk-in"}</td>
                  <td><Badge value={row.restaurant_status} /></td>
                  <td className="right num">{formatIdr(Number(row.amount ?? 0))}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <EmptyState title="No orders yet" />}
        </Panel>
        <Panel className="span-4" title="Best sellers">
          {data.top.length ? <div className="list">{data.top.map((item, index) => (
            <div className="list-row" key={item.name}><span><strong>{index + 1}. {item.name}</strong><span className="cell-sub">{formatIdr(item.revenue)}</span></span><span className="num muted">{item.qty} sold</span></div>
          ))}</div> : <EmptyState title="Nothing sold yet" />}
        </Panel>
        <Panel className="span-4" title="Cashier shift" action={<Badge value={data.openShift ? "open" : "closed"} />}>
          {data.openShift ? (
            <div className="panel-body"><dl className="detail-list">
              <dt>Opened</dt><dd>{formatTime(data.openShift.opened_at)}</dd>
              <dt>Opening cash</dt><dd className="num">{formatIdr(Number(data.openShift.opening_cash))}</dd>
              <dt>Cash sales</dt><dd className="num">{formatIdr(Number(data.openShift.cash_payment_total))}</dd>
              <dt>Digital sales</dt><dd className="num">{formatIdr(Number(data.openShift.digital_payment_total))}</dd>
            </dl></div>
          ) : <EmptyState title="No open shift" />}
        </Panel>
      </div>
    </div>
  );
}
