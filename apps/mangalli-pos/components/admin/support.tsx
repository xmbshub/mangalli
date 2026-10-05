import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";

import { reportProblemAction, resolveReportAction } from "@/app/actions";
import { ActionForm, Drawer, FormFooter, SubmitButton } from "@/components/interactive";
import { EmptyState, PAGE_SIZE, PageHeader, Pagination, Panel, Tabs } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { supportData } from "@/server/admin";
import { outletFormat } from "@/server/format";

const categories: Record<string, [string, string]> = {
  crash: ["App crash", "danger"], error: ["Error", "danger"], payment: ["Payment", "warning"], printer: ["Printer", "info"],
  sync: ["Sync", "info"], menu: ["Menu", "neutral"], other: ["Other", "neutral"],
};

const choices = [
  ["payment", "Payment", "Money received, QRIS, Midtrans, refunds"],
  ["printer", "Printer", "Receipts or kitchen tickets"],
  ["sync", "Sync", "Orders missing on the dashboard"],
  ["menu", "Menu", "Prices, photos, sold out, digital menu"],
  ["error", "Something broke", "An error message or a stuck screen"],
  ["other", "Other", "Anything else"],
] as const;

const sources: Record<string, string> = { tablet: "Tablet", dashboard: "Dashboard", system: "Automatic" };

function CategoryBadge({ category }: { category: string }) {
  const [label, tone] = categories[category] ?? [category, "neutral"];
  return <span className={`badge tone-${tone}`}>{label}</span>;
}

// Laporan masalah: crash dan galat tablet, galat dashboard, dan pembayaran
// online yang gagal masuk otomatis; tim juga bisa melapor sendiri.
export async function SupportSection({ operator, status, open, creating, page }: { operator: Operator; status: "open" | "resolved"; open: string; creating: boolean; page: number }) {
  const data = await supportData(operator, status, page, PAGE_SIZE);
  const manager = operator.role === "owner" || operator.role === "manager";
  const tabBase = status === "resolved" ? "/admin/support?tab=resolved" : "/admin/support";
  const pageHref = (next: number) => next > 1 ? `${tabBase}${tabBase.includes("?") ? "&" : "?"}page=${next}` : tabBase;
  const base = pageHref(page);
  if (!data.rows.length && page > 1) redirect(tabBase);
  const withParam = (key: string, value: string) => `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  const current = data.rows.find((row) => row.id === open);
  const { formatDateTime } = outletFormat(operator.timezone);
  return (
    <div className="page">
      <PageHeader
        title="Support"
        description={manager ? "Crashes, errors, and problems from the tablet, dashboard, and payments." : "Problems you reported."}
        action={<Link className="button primary" href={withParam("new", "1")} scroll={false}><Plus size={16} /> Report a problem</Link>}
      />
      <Tabs items={[
        { href: "/admin/support", label: "Open", count: data.open, active: status === "open" },
        { href: "/admin/support?tab=resolved", label: "Resolved", count: data.resolved, active: status === "resolved" },
      ]} />
      <Panel>
        {data.rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Type</th><th className="hide-sm">From</th><th className="right">Times</th><th className="hide-sm">Last seen</th><th /></tr></thead>
            <tbody>{data.rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={withParam("report", row.id)} scroll={false}><strong>{row.title}</strong></Link>{row.message && row.message !== row.title ? <span className="cell-sub clamp-1">{row.message}</span> : null}</td>
                <td><CategoryBadge category={row.category} /></td>
                <td className="hide-sm">{sources[row.source] ?? row.source}<span className="cell-sub">{row.reporter ?? (typeof row.context.device === "string" ? row.context.device : "—")}</span></td>
                <td className="right num">{row.occurrences}</td>
                <td className="hide-sm num nowrap">{formatDateTime(row.last_seen_at)}</td>
                <td className="right"><Link className="button small ghost" href={withParam("report", row.id)} scroll={false}>View</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title={status === "open" ? "No open problems" : "No resolved problems"} />}
        <Pagination href={pageHref} page={page} total={status === "open" ? data.open : data.resolved} />
      </Panel>

      {current ? (
        <Drawer closeHref={base} title={current.title} description={`${sources[current.source] ?? current.source} · ${formatDateTime(current.created_at)}`}>
          <div className="form">
            <div className="action-row"><CategoryBadge category={current.category} />{current.occurrences > 1 ? <span className="badge tone-neutral">{current.occurrences} times</span> : null}</div>
            {current.message ? <p className="support-message">{current.message}</p> : null}
            <dl className="detail-list">
              {current.reporter ? <><dt>Reported by</dt><dd>{current.reporter}</dd></> : null}
              <dt>Last seen</dt><dd>{formatDateTime(current.last_seen_at)}</dd>
              {Object.entries(current.context).filter(([, value]) => value !== null && value !== "").map(([key, value]) => (
                <Fragment key={key}><dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</dt><dd className="break">{String(value)}</dd></Fragment>
              ))}
              {current.resolver ? <><dt>Resolved by</dt><dd>{current.resolver}{current.resolved_at ? ` · ${formatDateTime(current.resolved_at)}` : ""}</dd></> : null}
            </dl>
            {manager ? (
              <ActionForm action={resolveReportAction} successHref={tabBase}>
                <input name="id" type="hidden" value={current.id} />
                <input name="status" type="hidden" value={current.status === "open" ? "resolved" : "open"} />
                <FormFooter><SubmitButton className={current.status === "open" ? "button primary" : "button"} pendingLabel="Saving…">{current.status === "open" ? "Mark as resolved" : "Reopen"}</SubmitButton></FormFooter>
              </ActionForm>
            ) : null}
          </div>
        </Drawer>
      ) : null}

      {creating ? (
        <Drawer closeHref={base} title="Report a problem" description="Tell us what happened.">
          <ActionForm action={reportProblemAction} successHref="/admin/support">
            <input name="page" type="hidden" value="dashboard" />
            <fieldset className="check-group">
              <legend>What is it about?</legend>
              <div className="option-cards">{choices.map(([value, label, help], index) => (
                <label className="option-card" key={value}><input defaultChecked={index === 0} name="category" type="radio" value={value} /><span><strong>{label}</strong><span>{help}</span></span></label>
              ))}</div>
            </fieldset>
            <label className="field">What happened?<textarea maxLength={4000} minLength={5} name="message" placeholder="e.g. A QRIS payment of Rp 48.000 at 12:30 didn't reach the order." required rows={5} /></label>
            <FormFooter><SubmitButton pendingLabel="Sending…">Send report</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}
