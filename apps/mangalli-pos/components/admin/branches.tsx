import { ArrowDownRight, ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";

import { createBranchAction, switchOutletAction } from "@/app/actions";
import { ActionForm, Drawer, FieldLabel, FormFooter, Hint, SubmitButton } from "@/components/interactive";
import { EmptyState, Kpi, PageHeader, Panel, Segmented } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { reportPeriod, reportRanges, type ReportRange } from "@/server/admin";
import { brandOutlets } from "@/server/branches";
import { config } from "@/server/config";
import { formatIdr } from "@/server/pos";
import { change, reportPack } from "@/server/reports";

// Multi cabang (permintaan owner 4 Okt 2026): perbandingan cabang dalam satu
// brand untuk rentang yang dipilih, pindah cabang, dan tambah cabang (owner).
// Angka hanya untuk cabang tempat operator menjadi anggota.

export async function BranchesSection({ operator, range, creating, created }: { operator: Operator; range: string; creating: boolean; created: string }) {
  const period = reportPeriod(operator.timezone, range || "7");
  const outlets = await brandOutlets(operator);
  const visible = outlets.filter((outlet) => outlet.role);
  const rows = await Promise.all(visible.map(async (outlet) => {
    const data = await reportPack({ ...operator, outletKey: outlet.outlet_key, role: outlet.role! }, period);
    return { outlet, data };
  }));
  const total = rows.reduce((sum, row) => ({ net: sum.net + row.data.money.net, orders: sum.orders + row.data.money.orders, profit: sum.profit + (row.data.hasCosts ? row.data.netProfit : 0), prev: sum.prev + row.data.prev.net }), { net: 0, orders: 0, profit: 0, prev: 0 });
  const best = [...rows].sort((a, b) => b.data.money.net - a.data.money.net)[0];
  const isOwner = operator.role === "owner";
  const fresh = outlets.find((outlet) => outlet.outlet_key === created);
  return (
    <div className="page">
      <PageHeader title="Branches" description={`${outlets.length} ${outlets.length === 1 ? "branch" : "branches"} · ${period.from === period.to ? "today" : `${reportRanges[period.range]}`}`}
        action={isOwner ? <Link className="button primary" href="/admin/branches?new=1" scroll={false}><Plus size={16} /> Add branch</Link> : undefined} />
      {fresh ? <p className="notice"><strong>{fresh.name}</strong> is ready · outlet code <strong>{fresh.outlet_key}</strong><Hint>Open it to set tables, opening hours and team, then sign in on a tablet with this outlet code.</Hint></p> : null}
      <Segmented items={(["today", "7", "30", "month"] as ReportRange[]).map((key) => ({ href: `/admin/branches?range=${key}`, label: reportRanges[key], active: key === period.range }))} />
      <div className="bento">
        <Kpi label="Sales, all branches" value={formatIdr(total.net)} hint={change(total.net, total.prev) === null ? "No data for the period before" : `${change(total.net, total.prev)! >= 0 ? "+" : ""}${change(total.net, total.prev)}% vs the period before`} tone={change(total.net, total.prev) !== null ? (change(total.net, total.prev)! >= 0 ? "up" : "down") : undefined} />
        <Kpi label="Paid orders" value={total.orders} hint={`${visible.length} ${visible.length === 1 ? "branch" : "branches"}`} />
        <Kpi label="Best branch" value={best?.outlet.name ?? "—"} hint={best ? formatIdr(best.data.money.net) : undefined} />
        <Kpi label="Profit" value={!total.net ? formatIdr(0) : rows.some((row) => row.data.hasCosts) ? formatIdr(total.profit) : "—"} hint={!total.net ? "No sales in this period" : rows.some((row) => row.data.hasCosts) ? "Branches with product costs" : "Add product costs to see it"} />
        <Panel className="span-12" title="Compare branches" description="Sales exclude tax">
          {rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Branch</th><th className="right">Sales</th><th className="right">Orders</th><th className="right hide-sm">Average</th><th className="right hide-sm">Profit</th><th className="right">Change</th><th /></tr></thead>
              <tbody>{rows.map(({ outlet, data }) => {
                const delta = change(data.money.net, data.prev.net);
                const current = outlet.outlet_key === operator.outletKey;
                return (
                  <tr key={outlet.outlet_key}>
                    <td><strong>{outlet.name}</strong><span className="cell-sub">{outlet.is_main ? "Main branch · menu source" : outlet.address ?? outlet.outlet_key}</span>
                      <div className="meter"><span style={{ width: `${total.net ? (data.money.net / total.net) * 100 : 0}%` }} /></div></td>
                    <td className="right num">{formatIdr(data.money.net)}</td>
                    <td className="right num">{data.money.orders}</td>
                    <td className="right num hide-sm">{formatIdr(data.money.orders ? data.money.net / data.money.orders : 0)}</td>
                    <td className="right num hide-sm">{data.hasCosts ? formatIdr(data.netProfit) : "—"}</td>
                    <td className={`right num${delta === null ? " muted" : ""}`}>{delta === null ? "—" : <span className={`delta ${delta >= 0 ? "up" : "down"}`}>{delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(delta)}%</span>}</td>
                    <td className="right">{current ? <span className="badge tone-warning">Current</span> : (
                      <form action={switchOutletAction}><input name="outlet" type="hidden" value={outlet.outlet_key} /><button className="button small" type="submit">Open <ArrowRight size={14} /></button></form>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <EmptyState title="No branches yet" />}
        </Panel>
      </div>
      {creating && isOwner ? (
        <Drawer closeHref="/admin/branches" title="Add branch" description="Copies this brand's menu and settings.">
          <ActionForm action={createBranchAction} successHref="/admin/branches">
            <label className="field">Branch name<input maxLength={80} name="name" placeholder="e.g. Kopi Senja Sanur" required /></label>
            <label className="field">Address<textarea maxLength={300} name="address" rows={2} /></label>
            <label className="field"><FieldLabel hint="Shown on receipts and the digital menu of this branch.">Phone</FieldLabel><input inputMode="tel" maxLength={40} name="phone" /></label>
            {config.identityProxyEnabled ? <p className="notice">Billed as its own outlet.<Hint>Each branch is its own Mangalli subscription on your next 1garis Studio invoice. The menu stays shared with the main branch.</Hint></p> : null}
            <FormFooter><SubmitButton pendingLabel="Creating…">Create branch</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}
