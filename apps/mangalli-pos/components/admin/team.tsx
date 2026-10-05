import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { addCashierAction, closeShiftAction, openShiftAction, saveUserAction, setUserActiveAction, removeBranchAccessAction, saveBranchAccessAction } from "@/app/actions";
import { ActionForm, FieldLabel, Drawer, FilterForm, Hint, SearchField, FormFooter, SubmitButton, ToggleSwitch } from "@/components/interactive";
import { Badge, EmptyState, PAGE_SIZE, PageHeader, Pagination, Panel, Tabs } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { brandOutlets } from "@/server/branches";
import { config } from "@/server/config";
import { auditData, auditKinds, shiftsData, usersData, type AuditKind } from "@/server/admin";
import { formatDate, outletFormat } from "@/server/format";
import { formatIdr } from "@/server/pos";

const roleName: Record<string, string> = { owner: "Owner", manager: "Manager", staff: "Cashier", viewer: "Viewer" };

// Ringkasan hak akses; aturan lengkapnya di README (Roles and approvals).
const roleHelp: Record<string, string> = {
  owner: "Everything, including team, tax, payments, and the audit log",
  manager: "Menu, tables, reports, shifts. Approves voids and refunds with a PIN",
  staff: "Sells on the tablet. Voids and refunds need a manager",
  viewer: "Overview only",
};

// Aksi tanpa label tetap ditulis sentence case, misalnya "product.stock_set" → "Product stock set".
const actionLabel = (action: string) => auditLabels[action] ?? action.replace(/[._]/g, " ").replace(/^./, (char) => char.toUpperCase());
const auditLabels: Record<string, string> = {
  "order.item_voided": "Item voided", "order.cancelled": "Order cancelled", "order.refunded": "Refund",
  "order.total_reduced": "Total reduced", "order.status_changed": "Order status", "order.menu_payment_received": "Menu order paid",
  "order.menu_unpaid_cancelled": "Unpaid menu order cancelled", "android.offline_price_differs": "Tablet price differs",
  "shift.opened": "Shift opened", "shift.closed": "Shift closed", "shift.cash_out": "Cash out", "shift.cash_in": "Cash in", "product.created": "Product added",
  "product.price_changed": "Price changed", "product.cost_changed": "Cost changed", "product.options_deleted": "Options removed",
  "expense.created": "Expense added", "expense.updated": "Expense changed", "expense.deleted": "Expense deleted", "category.deleted": "Category deleted",
  "outlet.business_rules": "Tax and order types", "outlet.payments": "Payment settings", "outlet.update": "Outlet updated",
  "promotion.created": "Promo created", "promotion.updated": "Promo changed", "promotion.activated": "Promo on", "promotion.paused": "Promo off",
  "promotion.deleted": "Promo deleted", "order.discount_manual": "Manual discount", "menu.imported": "Menu imported", "product.photos_replaced": "Photos replaced",
  "product.deleted": "Product deleted", "product.stock_set": "Stock set", "outlet.branch_created": "Branch created", "user.branch_access": "Branch access", "table.deleted": "Table deleted", "table.area_renamed": "Area renamed", "table.area_deleted": "Area deleted",
  "user.created": "Member added", "outlet.data_reset": "Test data cleared", "outlet.data_imported": "Data imported", "outlet.data_exported": "Data downloaded", "outlet.created": "Outlet created", "user.updated": "Member changed", "user.activated": "Member activated", "user.deactivated": "Member deactivated",
};

// Kejadian uang dan akses yang perlu dilihat owner lebih dulu.
const riskyActions = new Set(["shift.cash_out", "product.deleted", "table.area_deleted", "order.discount_manual", "order.item_voided", "order.refunded", "order.total_reduced", "order.cancelled", "outlet.payments", "outlet.business_rules", "product.price_changed", "expense.deleted"]);

export async function UsersSection({ operator, edit, creating }: { operator: Operator; edit: string; creating: boolean }) {
  const [users, branches] = await Promise.all([usersData(operator), brandOutlets(operator)]);
  // Cabang lain dalam brand tempat operator juga owner: hanya di sana ia boleh memberi akses.
  const grantable = branches.filter((branch) => branch.outlet_key !== operator.outletKey && branch.role === "owner");
  const current = users.find((user) => user.id === edit);
  const approvers = users.filter((user) => user.is_active && (user.pos_role === "owner" || user.pos_role === "manager"));
  const approver = (user: { pos_role: string }) => user.pos_role === "owner" || user.pos_role === "manager";
  return (
    <div className="page">
      <PageHeader title="Team" description="Your team and their roles."
        info={config.identityProxyEnabled ? "Add cashiers here. Owners and managers who use the dashboard are added by 1garis Studio." : "Add cashiers here. To make someone a manager, add them, then change their role in Edit."}
        action={<Link className="button primary" href="/admin/users?new=1" scroll={false}><Plus size={16} /> Add cashier</Link>} />
      {approvers.some((user) => !user.has_pin) ? (
        <p className="notice">Set an approval PIN for {approvers.filter((user) => !user.has_pin).map((user) => user.name).join(", ")}.<Hint>The 6-digit PIN approves voids, refunds and manual discounts on the tablet, and unlocks protected settings here.</Hint></p>
      ) : null}
      <Panel>
        {users.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Member</th><th>Role</th><th className="hide-sm">Approval PIN</th><th>Active</th><th /></tr></thead>
            <tbody>{users.map((user) => (
              <tr key={user.id}>
                <td><div className="cell-main"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><Link href={`/admin/users?edit=${user.id}`} scroll={false}><strong>{user.name}</strong></Link><span className="cell-sub">{user.email}{user.id === operator.id ? " · you" : ""}{user.is_home ? (user.access.length ? ` · also ${user.access.length} other ${user.access.length === 1 ? "branch" : "branches"}` : "") : ` · from ${user.home_name}`}</span></span></div></td>
                <td><Badge value={user.pos_role} /></td>
                <td className="hide-sm">{approver(user) ? (user.has_pin ? <span className="badge tone-success">Set</span> : <span className="badge tone-warning">Not set</span>) : <span className="muted">—</span>}</td>
                <td>{user.id === operator.id || !user.is_home ? <Badge value={user.is_active ? "active" : "inactive"} /> : <ToggleSwitch action={setUserActiveAction} checked={user.is_active} confirmOff={`Deactivate ${user.name}? They are signed out on the dashboard and every tablet.`} confirmOffLabel="Deactivate" fields={{ id: user.id, active: String(!user.is_active) }} label={user.is_active ? `Deactivate ${user.name}` : `Activate ${user.name}`} />}</td>
                <td className="right"><Link className="button small ghost" href={`/admin/users?edit=${user.id}`} scroll={false}>Edit</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title="No team members yet" />}
      </Panel>
      {current && !current.is_home ? (
        <Drawer closeHref="/admin/users" title={current.name} description={`${current.email} · account from ${current.home_name}`}>
          <p className="muted small">Managed at {current.home_name}. Role here: {roleName[current.pos_role] ?? current.pos_role}.</p>
          {current.id !== operator.id ? (
            <ActionForm action={removeBranchAccessAction} className="form-section" confirm={`Remove ${current.name}'s access to this branch?`} confirmLabel="Remove access" successHref="/admin/users">
              <input name="id" type="hidden" value={current.id} />
              <h3>Remove access</h3>
              <p>They lose access to this branch.</p>
              <FormFooter><SubmitButton className="button danger">Remove access</SubmitButton></FormFooter>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : creating ? (
        <Drawer closeHref="/admin/users" title="Add cashier" description="Tablet sign-in only.">
          <ActionForm action={addCashierAction} successHref="/admin/users">
            <label className="field">Name<input autoComplete="off" maxLength={255} name="name" required /></label>
            <label className="field">Email<input autoComplete="off" name="email" required type="email" /></label>
            <label className="field"><FieldLabel hint="The cashier types this on the tablet the first time with internet; after that it also works offline. Change it later in their profile.">Tablet password</FieldLabel><input autoComplete="new-password" maxLength={128} minLength={6} name="password" required type="password" /></label>
            <FormFooter><SubmitButton pendingLabel="Adding…">Add cashier</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : current ? (
        <Drawer closeHref="/admin/users" title={current.name} description={current?.email}>
          <ActionForm action={saveUserAction} successHref="/admin/users">
            <input name="id" type="hidden" value={current.id} />
            <label className="field">Name<input defaultValue={current?.name} name="name" required /></label>
            <label className="field">Email<input autoComplete="off" defaultValue={current?.email} name="email" required type="email" /></label>
            <fieldset className="check-group">
              <legend>Role</legend>
              <div className="option-cards">{Object.entries(roleHelp).map(([role, help]) => (
                <label className="option-card" key={role}><input defaultChecked={(current?.pos_role ?? "staff") === role} disabled={current?.id === operator.id && role !== "owner"} name="role" type="radio" value={role} /><span><strong>{roleName[role]}</strong><span>{help}</span></span></label>
              ))}</div>
            </fieldset>
            <label className="field"><FieldLabel>New password</FieldLabel><input autoComplete="new-password" maxLength={128} minLength={6} name="password" placeholder="Leave empty to keep it" type="password" /></label>
            <label className="field approval-pin"><FieldLabel hint="Typed on the tablet to approve voids, refunds, and discounts. Different from the password, so a leaked password can't approve.">{current?.has_pin ? "New approval PIN" : "Approval PIN"}</FieldLabel><input autoComplete="off" inputMode="numeric" maxLength={6} minLength={6} name="pin" pattern="[0-9]{6}" placeholder={current?.has_pin ? "Set · leave empty to keep it" : "6 digits"} type="password" /></label>
            <FormFooter><SubmitButton pendingLabel="Saving…">Save changes</SubmitButton></FormFooter>
          </ActionForm>
          {grantable.length ? (
            <ActionForm action={saveBranchAccessAction} className="form-section" successHref={`/admin/users?edit=${current.id}`}>
              <input name="id" type="hidden" value={current.id} />
              <h3>Branch access</h3>
              <p>Same role and tablet sign-in at other branches.</p>
              <div className="chips">{grantable.map((branch) => (
                <label className="chip" key={branch.outlet_key}><input defaultChecked={current.access.includes(branch.outlet_key)} name="outlet" type="checkbox" value={branch.outlet_key} /> {branch.name}</label>
              ))}</div>
              <FormFooter><SubmitButton className="button" pendingLabel="Saving…">Save access</SubmitButton></FormFooter>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}

export async function ShiftsSection({ operator, opening, page }: { operator: Operator; opening: boolean; page: number }) {
  const { rows: shifts, total } = await shiftsData(operator, page, PAGE_SIZE);
  if (!shifts.length && page > 1) redirect("/admin/shifts");
  const { formatDateTime } = outletFormat(operator.timezone);
  const open = shifts.filter((shift) => shift.status === "open");
  const webShift = open.find((shift) => !shift.from_tablet);
  return (
    <div className="page">
      <PageHeader title="Shifts" description="Opened and closed on the cashier tablet." action={webShift ? undefined : <Link className="button" href="/admin/shifts?open=1" scroll={false}>Open dashboard shift</Link>} />
      <div className="bento">
        {open.map((shift) => (
          <Panel className="span-6" key={shift.id} title={shift.from_tablet ? "Tablet shift" : "Dashboard shift"} description={`Since ${formatDateTime(shift.opened_at)}${shift.opened_by_name ? ` · ${shift.opened_by_name}` : ""}`} action={<Badge value="open" />}>
            <div className="panel-body">
              <dl className="detail-list">
                <dt>Opening cash</dt><dd className="num">{formatIdr(Number(shift.opening_cash))}</dd>
                <dt>Cash sales</dt><dd className="num">{formatIdr(Number(shift.cash_payment_total))}</dd>
                <dt>Digital sales</dt><dd className="num">{formatIdr(Number(shift.digital_payment_total))}</dd>
                <dt>Expected cash</dt><dd className="num">{formatIdr(Number(shift.expected_cash))}</dd>
                <dt>Orders</dt><dd className="num">{shift.order_count}</dd>
              </dl>
              {shift.from_tablet ? <p className="hint" style={{ marginTop: "auto" }}>Close it on the tablet.</p> : (
                <ActionForm action={closeShiftAction} confirm="Close this shift?" confirmLabel="Close shift">
                  <input name="shiftId" type="hidden" value={shift.id} />
                  <label className="field">Counted cash<span className="input-affix"><span>Rp</span><input min="0" name="actualCash" required type="number" /></span></label>
                  <FormFooter><SubmitButton pendingLabel="Closing…">Close shift</SubmitButton></FormFooter>
                </ActionForm>
              )}
            </div>
          </Panel>
        ))}
        <Panel className="span-12" title="History" description="Open shifts first, then newest">
          {shifts.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th className="hide-sm">Opened / closed by</th><th className="right">Orders</th><th className="right hide-sm">Cash</th><th className="right hide-sm">Digital</th><th className="right">Expected</th><th className="right">Counted</th><th className="right">Difference</th><th>Status</th></tr></thead>
              <tbody>{shifts.map((shift) => {
                const difference = Number(shift.cash_difference);
                return (
                  <tr key={shift.id}>
                    <td className="nowrap">{formatDate(shift.business_date)}<span className="cell-sub">{formatDateTime(shift.opened_at)}</span>{shift.notes ? <span className="cell-sub clamp-1" title={shift.notes}>Note: {shift.notes}</span> : null}</td>
                    <td className="hide-sm">{shift.opened_by_name ?? "—"}<span className="cell-sub">{shift.closed_by_name && shift.closed_by_name !== shift.opened_by_name ? `Closed by ${shift.closed_by_name} · ` : ""}{shift.from_tablet ? "Tablet" : "Dashboard"}</span></td>
                    <td className="right num">{shift.order_count}</td>
                    <td className="right num hide-sm">{formatIdr(Number(shift.cash_payment_total))}</td>
                    <td className="right num hide-sm">{formatIdr(Number(shift.digital_payment_total))}</td>
                    <td className="right num">{formatIdr(Number(shift.expected_cash))}{Number(shift.cash_out) || Number(shift.cash_in) ? <span className="cell-sub">{[Number(shift.cash_out) ? `Cash out −${formatIdr(Number(shift.cash_out))}` : "", Number(shift.cash_in) ? `Cash in +${formatIdr(Number(shift.cash_in))}` : ""].filter(Boolean).join(" · ")}</span> : null}</td>
                    <td className="right num">{shift.actual_cash === null ? "—" : formatIdr(Number(shift.actual_cash))}</td>
                    <td className={`right num ${shift.status === "closed" && difference < 0 ? "kpi-hint down" : ""}`}>{shift.status === "closed" ? `${difference > 0 ? "+" : ""}${formatIdr(difference)}` : "—"}</td>
                    <td><Badge value={shift.status} /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <EmptyState title="No shifts yet" />}
          <Pagination href={(next) => `/admin/shifts?page=${next}`} page={page} total={total} />
        </Panel>
      </div>
      {opening && !webShift ? (
        <Drawer closeHref="/admin/shifts" title="Open dashboard shift" description="Only for selling without the tablet.">
          <ActionForm action={openShiftAction} successHref="/admin/shifts">
            <label className="field">Opening cash<span className="input-affix"><span>Rp</span><input defaultValue="0" min="0" name="openingCash" required type="number" /></span></label>
            <FormFooter><SubmitButton pendingLabel="Opening…">Open shift</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}

export async function AuditSection({ operator, kind, search, page }: { operator: Operator; kind: AuditKind; search: string; page: number }) {
  const { rows, total } = await auditData(operator, kind, search, page, PAGE_SIZE);
  const { formatDateTime } = outletFormat(operator.timezone);
  const href = (params: Record<string, string>) => {
    const text = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
    return `/admin/audit-logs${text ? `?${text}` : ""}`;
  };
  if (!rows.length && page > 1) redirect(href({ kind: kind === "all" ? "" : kind, q: search }));
  return (
    <div className="page">
      <PageHeader title="Audit log" description="Money, access and menu changes." />
      <Tabs items={(Object.keys(auditKinds) as AuditKind[]).map((key) => ({
        href: href({ kind: key === "all" ? "" : key, q: search }), label: auditKinds[key].label, active: key === kind,
      }))} />
      <FilterForm action="/admin/audit-logs">
        {kind !== "all" ? <input name="kind" type="hidden" value={kind} /> : null}
        <SearchField defaultValue={search} label="Search the audit log" placeholder="Search detail, reason, or person" />
        {search ? <Link className="button ghost" href={href({ kind: kind === "all" ? "" : kind })}>Clear</Link> : null}
      </FilterForm>
      <Panel>
        {rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Time</th><th>Action</th><th>Detail</th><th>By</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td className="num nowrap">{formatDateTime(row.created_at)}</td>
                <td className="nowrap">{riskyActions.has(row.action) || Math.abs(Number(row.difference ?? 0)) >= 1 ? <span className="badge tone-warning">{actionLabel(row.action)}</span> : actionLabel(row.action)}</td>
                <td>{row.summary || "—"}{row.reason ? <span className="cell-sub">Reason: {row.reason}</span> : null}</td>
                <td className="nowrap">{row.actor_name || "System"}{row.approver_name ? <span className="cell-sub">Approved by {row.approver_name}</span> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title={search ? "No matching entries" : "No entries yet"} />}
        <Pagination href={(next) => href({ kind: kind === "all" ? "" : kind, q: search, page: String(next) })} page={page} total={total} />
      </Panel>
    </div>
  );
}
