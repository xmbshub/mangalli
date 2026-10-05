import { Plus } from "lucide-react";
import Link from "next/link";

import { deleteExpenseAction, saveExpenseAction } from "@/app/actions";
import { ActionForm, DateField, Drawer, FieldLabel, FilterForm, FormFooter, Select, SubmitButton } from "@/components/interactive";
import { EmptyState, Kpi, PAGE_SIZE, PageHeader, Pagination, Panel, Segmented } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { reportRanges, type ReportPeriod, type ReportRange } from "@/server/admin";
import { formatDate, outletFormat } from "@/server/format";
import { formatIdr } from "@/server/pos";
import { expenseCategories, expensesData, type ExpenseCategory } from "@/server/reports";

// Pengeluaran usaha (permintaan owner 4 Okt 2026): owner mencatat sewa, gaji,
// bahan, tagihan, dan lainnya supaya Reports bisa menghitung laba bersih. Kas
// keluar dari laci tablet ditampilkan di sini juga, tetapi dicatat di tablet.

const categoryOptions = (Object.keys(expenseCategories) as ExpenseCategory[]).map((key) => ({ value: key, label: expenseCategories[key] }));

export async function ExpensesSection({ operator, period, category, page, creating, edit }: {
  operator: Operator; period: ReportPeriod; category: string; page: number; creating: boolean; edit: string;
}) {
  const data = await expensesData(operator, period, category, page, PAGE_SIZE);
  const range = `range=${period.range}${period.range === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`;
  const base = `/admin/expenses?${range}${category ? `&category=${category}` : ""}`;
  const current = data.rows.find((row) => row.id === edit);
  const label = period.from === period.to ? formatDate(period.from, true) : `${formatDate(period.from)} – ${formatDate(period.to)}`;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: operator.timezone });
  const { formatDateTime } = outletFormat(operator.timezone);
  return (
    <div className="page">
      <PageHeader title="Expenses" description={`Money spent running the outlet, ${label}.`} action={<Link className="button primary" href={`${base}&new=1`} scroll={false}><Plus size={16} /> Add expense</Link>} />
      <div className="report-range">
        <Segmented items={(["today", "7", "30", "90", "month"] as ReportRange[]).map((key) => ({ href: `/admin/expenses?range=${key}${category ? `&category=${category}` : ""}`, label: reportRanges[key], active: key === period.range }))} />
        <FilterForm action="/admin/expenses">
          <input name="range" type="hidden" value="custom" />
          {category ? <input name="category" type="hidden" value={category} /> : null}
          <DateField defaultValue={period.from} label="From date" max={period.to} name="from" placeholder="From" submitOnChange />
          <span className="muted">to</span>
          <DateField defaultValue={period.to} label="To date" min={period.from} name="to" placeholder="To" submitOnChange />
        </FilterForm>
      </div>
      <div className="bento">
        <Kpi label="Total spent" value={formatIdr(data.recorded + data.drawerTotal)} hint="Including tablet cash out" />
        <Kpi label="Recorded here" value={formatIdr(data.recorded)} hint={`${data.byCategory.length} ${data.byCategory.length === 1 ? "category" : "categories"}`} />
        <Kpi label="Tablet cash out" value={formatIdr(data.drawerTotal)} hint={data.drawer.length === 1 ? "Once from the drawer" : `${data.drawer.length} times from the drawer`} />
        <Kpi label="Biggest cost" value={data.byCategory[0] ? formatIdr(data.byCategory[0].total) : "—"} hint={data.byCategory[0]?.label ?? "Nothing recorded yet"} />
        <Panel className="span-8" title="Expenses" action={
          <FilterForm action="/admin/expenses">
            <input name="range" type="hidden" value={period.range} />
            {period.range === "custom" ? <><input name="from" type="hidden" value={period.from} /><input name="to" type="hidden" value={period.to} /></> : null}
            <Select defaultValue={category} label="Category" name="category" options={[{ value: "", label: "All categories" }, ...categoryOptions]} submitOnChange />
          </FilterForm>
        }>
          {data.rows.length ? (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Category</th><th className="hide-sm">Note</th><th className="right">Amount</th><th /></tr></thead>
                <tbody>{data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{formatDate(row.spent_on)}</td>
                    <td><Link href={`${base}&edit=${row.id}`} scroll={false}><strong>{expenseCategories[row.category]}</strong></Link>{row.created_by ? <span className="cell-sub">by {row.created_by}</span> : null}</td>
                    <td className="hide-sm muted">{row.note ?? "—"}</td>
                    <td className="right num">{formatIdr(Number(row.amount))}</td>
                    <td className="right"><Link className="button small ghost" href={`${base}&edit=${row.id}`} scroll={false}>Edit</Link></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pagination href={(value) => `${base}&page=${value}`} page={page} total={data.total} />
            </>
          ) : <EmptyState title={category ? "No expenses in this category" : "No expenses recorded yet"} action={<Link className="button primary" href={`${base}&new=1`} scroll={false}>Add expense</Link>} />}
        </Panel>
        <div className="span-4 stack">
          <Panel title="By category">
            {data.byCategory.length ? <div className="list">{data.byCategory.map((item) => (
              <div className="list-row" key={item.category}>
                <div style={{ flex: 1 }}><strong>{item.label}</strong><div className="meter"><span style={{ width: `${(item.total / Math.max(data.byCategory[0].total, 1)) * 100}%` }} /></div></div>
                <span className="num">{formatIdr(item.total)}</span>
              </div>
            ))}</div> : <EmptyState title="Nothing recorded yet" />}
          </Panel>
          <Panel title="Cash out at the tablet" description="Recorded by cashiers on the Shift screen">
            {data.drawer.length ? <div className="list">{data.drawer.slice(0, 8).map((item) => (
              <div className="list-row" key={item.id}>
                <div style={{ flex: 1, minWidth: 0 }}><strong className="truncate">{item.reason}</strong><span className="cell-sub">{formatDateTime(item.created_at)}{item.created_by ? ` · ${item.created_by}` : ""}</span></div>
                <span className="num">{formatIdr(Number(item.amount))}</span>
              </div>
            ))}</div> : <EmptyState title="No cash out" />}
          </Panel>
        </div>
      </div>
      {creating || current ? (
        <Drawer closeHref={base} title={current ? "Edit expense" : "Add expense"} description="Counted as a cost in Reports.">
          <ActionForm action={saveExpenseAction} successHref={base}>
            {current ? <input name="id" type="hidden" value={current.id} /> : null}
            <div className="form-grid">
              <div className="field"><FieldLabel>Date</FieldLabel><DateField defaultValue={current?.spent_on ?? today} label="Date" max={today} name="spentOn" placeholder="Choose a date" /></div>
              <label className="field">Amount<span className="input-affix"><span>Rp</span><input defaultValue={current ? Number(current.amount) : undefined} inputMode="numeric" min="1" name="amount" required step="1" type="number" /></span></label>
              <div className="field field-wide">Category<Select defaultValue={current?.category ?? ""} label="Category" name="category" options={categoryOptions} placeholder="Choose a category" /></div>
              <label className="field field-wide"><FieldLabel hint="For example: September rent, 2 sacks of rice, electricity bill.">Note</FieldLabel><input defaultValue={current?.note ?? ""} maxLength={200} name="note" placeholder="Optional" /></label>
            </div>
            <FormFooter><SubmitButton pendingLabel="Saving…">{current ? "Save changes" : "Add expense"}</SubmitButton></FormFooter>
          </ActionForm>
          {current ? (
            <ActionForm action={deleteExpenseAction} className="form-section" confirm="Delete this expense?" confirmLabel="Delete" successHref={base}>
              <input name="id" type="hidden" value={current.id} />
              <h3>Delete expense</h3>
              <p>Removed from Reports, kept in the audit log.</p>
              <FormFooter><SubmitButton className="button danger">Delete expense</SubmitButton></FormFooter>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}
