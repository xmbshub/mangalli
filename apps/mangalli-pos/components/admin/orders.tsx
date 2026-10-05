import { Tablet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { cancelUnpaidMenuOrderAction, markMenuOrderPaidAction, updateOrderStatusAction } from "@/app/actions";
import { ActionForm, AutoRefresh, DateField, Drawer, FilterForm, SearchField, Select, SubmitButton } from "@/components/interactive";
import { Badge, EmptyState, PAGE_SIZE, PageHeader, Pagination, Panel, Tabs, paymentMethodLabel } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { kitchenData, orderDetail, ordersData, orderTabs, type OrderRow, type OrderSort, type OrderTab } from "@/server/admin";
import { minutesSince, outletFormat } from "@/server/format";
import { formatIdr } from "@/server/pos";

const nextStep: Record<string, { status: string; label: string }> = {
  new: { status: "accepted", label: "Accept" },
  accepted: { status: "preparing", label: "Start cooking" },
  preparing: { status: "ready", label: "Mark ready" },
  ready: { status: "completed", label: "Complete" },
};

const tabLabels: Record<OrderTab, string> = { all: "All", unpaid: "Awaiting payment", active: "In progress", completed: "Completed", cancelled: "Cancelled" };

function where(order: Pick<OrderRow, "order_mode" | "table_label" | "pickup_name">) {
  return order.order_mode === "dinein" ? order.table_label || "Dine in" : `Takeaway${order.pickup_name ? ` · ${order.pickup_name}` : ""}`;
}

// Quick actions shared by the table row, the detail drawer, and the kitchen
// board. Orders taken on the tablet are managed on the tablet.
function OrderActions({ order, size = "small" }: { order: OrderRow; size?: "small" | "regular" }) {
  const button = size === "small" ? "button small" : "button";
  if (order.restaurant_status === "pending_payment") {
    if (order.payment_method === "midtrans") return <span className="cell-sub">Paying online</span>;
    return (
      <div className="action-row">
        <ActionForm action={markMenuOrderPaidAction} className="inline-form" confirm={`Mark ${order.order_code ?? "this order"} as paid? It goes to the kitchen.`} confirmLabel="Mark paid">
          <input name="orderId" type="hidden" value={order.id} />
          <div className="action-row">
            <SubmitButton className={`${button} primary`} name="method" value="cash">Paid · Cash</SubmitButton>
            <SubmitButton className={`${button} primary`} name="method" value="qris">Paid · QRIS</SubmitButton>
          </div>
        </ActionForm>
        <ActionForm action={cancelUnpaidMenuOrderAction} className="inline-form" confirm="Cancel this unpaid order?" confirmLabel="Cancel order">
          <input name="orderId" type="hidden" value={order.id} />
          <SubmitButton className={`${button} danger`}>Cancel</SubmitButton>
        </ActionForm>
      </div>
    );
  }
  const next = nextStep[order.restaurant_status];
  if (!next) return null;
  if (order.from_tablet) return <span className="cell-sub">Managed on tablet</span>;
  return (
    <ActionForm action={updateOrderStatusAction} className="inline-form">
      <input name="orderId" type="hidden" value={order.id} />
      <input name="status" type="hidden" value={next.status} />
      <SubmitButton className={next.status === "completed" ? button : `${button} primary`}>{next.label}</SubmitButton>
    </ActionForm>
  );
}

export async function OrdersSection({ operator, tab, search, openId, from, to, sort, page }: {
  operator: Operator; tab: OrderTab; search: string; openId: string; from: string; to: string; sort: OrderSort; page: number;
}) {
  const [{ rows, counts, total }, detail] = await Promise.all([
    ordersData(operator, { tab, search, from, to, sort, page, pageSize: PAGE_SIZE }),
    openId ? orderDetail(operator, openId) : null,
  ]);
  const filters = { ...(tab !== "all" ? { tab } : {}), ...(search ? { q: search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sort !== "newest" ? { sort } : {}) };
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ ...filters, ...(page > 1 ? { page: String(page) } : {}), ...extra });
    const text = params.toString();
    return `/admin/orders${text ? `?${text}` : ""}`;
  };
  const closeHref = query({});
  const tabHref = (key: OrderTab) => {
    const params = new URLSearchParams(filters);
    if (key === "all") params.delete("tab"); else params.set("tab", key);
    const text = params.toString();
    return `/admin/orders${text ? `?${text}` : ""}`;
  };
  if (!rows.length && page > 1) redirect(query({ page: "1" }));
  const { formatDateTime, formatTime } = outletFormat(operator.timezone);
  return (
    <div className="page">
      <AutoRefresh seconds={20} />
      <PageHeader title="Orders" description="From the cashier tablet and the digital menu." />
      <Tabs items={(Object.keys(orderTabs) as OrderTab[]).map((key) => ({
        href: tabHref(key),
        label: tabLabels[key], active: key === tab, count: key === "unpaid" ? counts.unpaid : key === "active" ? counts.active : undefined,
      }))} />
      <FilterForm action="/admin/orders">
        {tab !== "all" ? <input name="tab" type="hidden" value={tab} /> : null}
        <SearchField defaultValue={search} label="Search orders" placeholder="Search code, customer, or table" />
        <DateField defaultValue={from} label="From date" max={to || undefined} name="from" placeholder="From date" submitOnChange />
        <DateField defaultValue={to} label="To date" min={from || undefined} name="to" placeholder="To date" submitOnChange />
        <Select defaultValue={sort} label="Sort" name="sort" options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "highest", label: "Highest total" }]} submitOnChange />
        {from || to || search || sort !== "newest" ? <Link className="button ghost" href={tab !== "all" ? `/admin/orders?tab=${tab}` : "/admin/orders"}>Clear</Link> : null}
      </FilterForm>
      <Panel>
        {rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="hide-sm">Payment</th><th className="right">Total</th><th className="right">Action</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td className="nowrap"><Link href={query({ order: row.id })} scroll={false}><strong>{row.order_code}</strong></Link><span className="cell-sub">{formatDateTime(row.created_at)}</span></td>
                <td>{row.customer_name || "Walk-in"}<span className="cell-sub">{where(row)}{row.from_tablet ? " · Tablet" : ""}</span></td>
                <td><Badge value={row.restaurant_status} />{row.restaurant_status === "pending_payment" && row.payment_due_at ? <span className="cell-sub">Pay by {formatTime(row.payment_due_at)}</span> : null}</td>
                <td className="hide-sm"><Badge kind="payment" value={row.payment_status} /><span className="cell-sub">{paymentMethodLabel[row.payment_method ?? ""] ?? row.payment_method ?? "—"}</span></td>
                <td className="right num">{formatIdr(Number(row.amount ?? 0))}</td>
                <td className="right"><div className="row-actions"><OrderActions order={row} /></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title={search || from || to ? "No matching orders" : "No orders yet"} />}
        <Pagination href={(next) => query({ page: String(next) })} page={page} total={total} />
      </Panel>
      {detail ? (
        <Drawer closeHref={closeHref} description={formatDateTime(detail.order.created_at)} title={`Order ${detail.order.order_code ?? ""}`}>
          <div className="action-row"><Badge value={detail.order.restaurant_status} /><Badge kind="payment" value={detail.order.payment_status} />{detail.order.from_tablet ? <span className="badge plain tone-neutral"><Tablet size={12} /> Tablet</span> : null}</div>
          <dl className="detail-list">
            <dt>Customer</dt><dd>{detail.order.customer_name || "Walk-in"}</dd>
            <dt>Service</dt><dd>{where(detail.order)}</dd>
            <dt>Payment</dt><dd>{paymentMethodLabel[detail.order.payment_method ?? ""] ?? detail.order.payment_method ?? "—"}{detail.order.paid_at ? ` · paid ${formatTime(detail.order.paid_at)}` : ""}</dd>
            {detail.order.restaurant_status === "pending_payment" && detail.order.payment_due_at ? <><dt>Pay by</dt><dd>{formatTime(detail.order.payment_due_at)}</dd></> : null}
            {detail.order.notes ? <><dt>Notes</dt><dd>{detail.order.notes}</dd></> : null}
            {detail.order.void_reason ? <><dt>Cancel reason</dt><dd>{detail.order.void_reason}</dd></> : null}
          </dl>
          <div className="line-items">
            {detail.items.map((item, index) => (
              <div className="line-item" key={index}>
                <span>{item.quantity} × {item.name}{item.modifier_summary ? <span className="cell-sub">{item.modifier_summary}</span> : null}{item.notes ? <span className="cell-sub">Note: {item.notes}</span> : null}</span>
                <span className="num">{formatIdr(Number(item.unit_price) * item.quantity)}</span>
              </div>
            ))}
            {Number(detail.order.discount_amount) > 0 ? <div className="line-item discount"><span>{detail.order.discount_label ?? "Discount"}</span><span className="num">−{formatIdr(Number(detail.order.discount_amount))}</span></div> : null}
            <div className="line-item total"><span>Total</span><span className="num">{formatIdr(Number(detail.order.amount ?? 0))}</span></div>
          </div>
          <OrderActions order={detail.order} size="regular" />
        </Drawer>
      ) : null}
    </div>
  );
}

const columns = [
  { status: "new", title: "New" },
  { status: "accepted", title: "Accepted" },
  { status: "preparing", title: "Preparing" },
  { status: "ready", title: "Ready" },
] as const;

export async function KitchenSection({ operator }: { operator: Operator }) {
  const orders = await kitchenData(operator);
  return (
    <div className="page">
      <AutoRefresh seconds={15} />
      <PageHeader title="Kitchen" description="Oldest first. Updates every 15 seconds." />
      <div className="board">{columns.map((column) => {
          const tickets = orders.filter((order) => order.restaurant_status === column.status);
          return (
            <section className="board-col" key={column.status}>
              <header><span>{column.title}</span><span className="tab-count">{tickets.length}</span></header>
              {tickets.length ? null : <p className="board-empty">{orders.length ? "Nothing here" : "No orders to prepare"}</p>}
              {tickets.map((order) => {
                const waited = minutesSince(order.created_at);
                return (
                  <article className="ticket" key={order.id}>
                    <div className="ticket-head"><strong>{order.order_code}</strong><span className={waited >= 15 && column.status !== "ready" ? "late" : ""}>{waited} min</span></div>
                    <span className="cell-sub">{where(order)}{order.customer_name ? ` · ${order.customer_name}` : ""}</span>
                    <ul>{order.items.map((item, index) => <li key={index}><span className="qty">{item.quantity}×</span> {item.name}{item.modifier_summary ? <small>{item.modifier_summary}</small> : null}{item.notes ? <small>Note: {item.notes}</small> : null}</li>)}</ul>
                    <OrderActions order={order} />
                  </article>
                );
              })}
            </section>
          );
        })}</div>
    </div>
  );
}
