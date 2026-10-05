import { Download, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";

import { addTablesAction, deleteAreaAction, sendTestDailyReportAction, setDailyReportAction, deleteTableAction, renameAreaAction, saveAndroidSyncTimesAction, saveBusinessRulesAction, saveMenuPaymentsAction, saveOpeningHoursAction, saveOutletAction, saveTableAction, setTableActiveAction } from "@/app/actions";
import { ActionForm, FieldLabel, AreaPicker, Drawer, FormFooter, Hint, ImageField, Select, SubmitButton, ToggleSwitch } from "@/components/interactive";
import { DataImport } from "@/components/data-import";
import { QrisField } from "@/components/qris-field";
import { EmptyState, PageHeader, Panel, Tabs, paymentMethodLabel } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { outletData, tablesData } from "@/server/admin";
import { latestRelease } from "@/server/app-releases";
import { businessWindow } from "@/server/business-day";
import { outletIsEmpty } from "@/server/data-transfer";
import { outletFormat } from "@/server/format";
import { query } from "@/server/db";
import { mailConfigured } from "@/server/mailer";
import { enabledPaymentMethods, midtransServerKey } from "@/server/menu-orders";
import { qrisMerchantName } from "@/server/qris";

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const timezones = [["Asia/Jakarta", "WIB · UTC+7"], ["Asia/Makassar", "WITA · UTC+8"], ["Asia/Jayapura", "WIT · UTC+9"]];
const halfHours = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

function TimeSelect({ name, value, label }: { name: string; value: string; label: string }) {
  const options = halfHours.includes(value) ? halfHours : [...halfHours, value].sort();
  return <Select defaultValue={value} label={label} name={name} options={options.map((time) => ({ value: time, label: time }))} />;
}

// Satu halaman bento: setiap kartu satu form dengan tombol simpan sendiri.
export async function OutletSection({ operator }: { operator: Operator }) {
  const outlet = await outletData(operator);
  if (!outlet) return <div className="page"><PageHeader title="Outlet" /><Panel><EmptyState title="Outlet not found" /></Panel></div>;
  const syncTimes = [...new Set([...halfHours.filter((time) => time.endsWith(":00")), ...outlet.android_sync_times])].sort();
  const hours = new Map((outlet.opening_hours ?? []).map((hour) => [hour.key, hour]));
  const isOwner = operator.role === "owner";
  const ownerOnly = isOwner ? undefined : "Only the owner can change this.";
  // Penerima email laporan harian: owner dan manager aktif outlet ini.
  const reportPeople = (await query<{ id: string; name: string; email: string; pos_role: string; daily_report_opt_out: boolean }>(
    `SELECT u.id::text, u.name, u.email, m.pos_role, u.daily_report_opt_out FROM users u JOIN outlet_members m ON m.user_id = u.id AND m.outlet_key = $1
      WHERE u.is_active AND m.pos_role IN ('owner','manager') ORDER BY m.pos_role, u.name`,
    [operator.outletKey])).rows;
  // Tablet tersambung dan versi aplikasinya (dikirim tablet saat sinkron).
  const [tablets, release, empty] = await Promise.all([
    query<{ id: string; label: string | null; app_version: string | null; app_version_code: number | null; last_seen_at: Date | null }>(
      `SELECT id::text, label, app_version, app_version_code, last_seen_at FROM android_pos_devices
        WHERE outlet_key = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST`, [operator.outletKey]).then((result) => result.rows),
    latestRelease("android"),
    isOwner ? outletIsEmpty(operator.outletKey) : false,
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: operator.timezone });
  const sendTime = businessWindow(outlet.opening_hours ?? [], today).sendAt.slice(11);
  return (
    <div className="page">
      <PageHeader title="Outlet settings" description="Used by the tablet and digital menu." />
      <div className="stack-columns">
        <div className="stack">
          <Panel padded title="Profile" description="On receipts and the digital menu.">
            <ActionForm action={saveOutletAction}>
              <div className="form-grid">
                <label className="field">Internal name<input defaultValue={outlet.name} name="name" required /></label>
                <label className="field">Public name<input defaultValue={outlet.public_name ?? ""} name="publicName" /></label>
                <label className="field">Tagline<input defaultValue={outlet.tagline ?? ""} name="tagline" /></label>
                <label className="field">Phone<input defaultValue={outlet.phone ?? ""} inputMode="tel" name="phone" /></label>
                <label className="field field-wide">Address<textarea defaultValue={outlet.address ?? ""} name="address" rows={2} /></label>
                <ImageField defaultValue={outlet.logo_image_url} hint="Square, light background. Printed on receipts." kind="logo" label="Logo" name="logoImageUrl" shape="round" />
                <ImageField defaultValue={outlet.banner_image_url} hint="Wide photo for the top of the digital menu." kind="banner" label="Banner" name="bannerImageUrl" shape="wide" />
              </div>
              <FormFooter><SubmitButton pendingLabel="Saving…">Save</SubmitButton></FormFooter>
            </ActionForm>
          </Panel>
          <Panel padded title="Opening hours" description="When the digital menu takes orders.">
            <ActionForm action={saveOpeningHoursAction}>
              <div className="hours-list">{weekdays.map((key) => {
                const hour = hours.get(key);
                return (
                  <div className="hours-row" key={key}>
                    <label className="chip"><input defaultChecked={hour?.is_open ?? true} name={`open_${key}`} type="checkbox" /> {key.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())}</label>
                    <TimeSelect label={`${key} opens`} name={`from_${key}`} value={hour?.open_time ?? "08:00"} />
                    <span className="muted">to</span>
                    <TimeSelect label={`${key} closes`} name={`to_${key}`} value={hour?.close_time ?? "22:00"} />
                  </div>
                );
              })}</div>
              <FormFooter><SubmitButton pendingLabel="Saving…">Save</SubmitButton></FormFooter>
            </ActionForm>
          </Panel>
          {isOwner ? (
            <Panel title="Your data" description="Download or move all outlet data."
              info="One file with menu, tables, team, orders, shifts, expenses, promos and settings. Passwords and PINs are never included.">
              <div className="list">
                <div className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}><strong>Download</strong><span className="cell-sub">Sync the tablet first.</span></div>
                  <a className="button small" download href="/api/data/export"><Download size={15} /> Download all data</a>
                </div>
                <div className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}><strong>Import<Hint>Moves a downloaded file into this outlet. Add your team first so their history keeps their names.</Hint></strong><span className="cell-sub">Only into an outlet with no menu and no orders.</span></div>
                  <DataImport empty={empty} />
                </div>
              </div>
            </Panel>
          ) : null}
          <Panel title="Daily report email" description={`Sent after closing · today ~${sendTime}`}>
            {mailConfigured() ? null : <p className="notice" style={{ margin: 16 }}>Email isn&apos;t set up on this server yet.</p>}
            <div className="list">{reportPeople.map((person) => {
              const canChange = isOwner || person.id === operator.id;
              return (
                <div className="list-row" key={person.id}>
                  <div style={{ flex: 1, minWidth: 0 }}><strong>{person.name}{person.id === operator.id ? " (you)" : ""}</strong><span className="cell-sub truncate">{person.email} · {person.pos_role === "owner" ? "Owner" : "Manager"}</span></div>
                  {canChange ? <ToggleSwitch action={setDailyReportAction} checked={!person.daily_report_opt_out} fields={{ id: person.id, on: person.daily_report_opt_out ? "1" : "0" }} label={`Daily report for ${person.name}`} />
                    : <span className="muted small">{person.daily_report_opt_out ? "Off" : "On"}</span>}
                </div>
              );
            })}</div>
            <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}>
              <ActionForm action={sendTestDailyReportAction} className="inline-form">
                <p className="muted small" style={{ flex: 1 }}>Sends today&apos;s report to you.</p>
                <SubmitButton className="button small" pendingLabel="Sending…">Send me a test</SubmitButton>
              </ActionForm>
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel padded title="Tax & order types" description={ownerOnly ?? "Applied on the tablet after its next sync."}>
            <ActionForm action={saveBusinessRulesAction}>
              <fieldset className="lock" disabled={!isOwner}>
                <div className="form-grid">
                  <label className="field">Tax<span className="input-affix"><input className="end" defaultValue={Math.round(Number(outlet.tax_rate) * 10_000) / 100} max="25" min="0" name="taxPercent" required step="0.5" type="number" /><span className="end">%</span></span></label>
                  <div className="field">Timezone<Select defaultValue={outlet.timezone} label="Timezone" name="timezone" options={timezones.map(([value, label]) => ({ value, label }))} /></div>
                </div>
                <div className="field">Digital menu order types<div className="chips">
                  <label className="chip"><input defaultChecked={outlet.order_modes.includes("dinein")} name="mode_dinein" type="checkbox" /> Dine in</label>
                  <label className="chip"><input defaultChecked={outlet.order_modes.includes("takeaway")} name="mode_takeaway" type="checkbox" /> Takeaway</label>
                </div></div>
                {isOwner ? <FormFooter><SubmitButton pendingLabel="Saving…">Save</SubmitButton></FormFooter> : null}
              </fieldset>
            </ActionForm>
          </Panel>
          <Panel padded title="Digital menu & payments" description={ownerOnly ?? "Where customer payments go."}>
            <ActionForm action={saveMenuPaymentsAction}>
              <fieldset className="lock" disabled={!isOwner}>
                <label className="field"><FieldLabel hint="Table QR codes open this page.">Menu address</FieldLabel><input defaultValue={outlet.menu_url ?? ""} name="menuUrl" placeholder="https://" type="url" /></label>
                <div className="field">Payment methods<div className="chips">
                  <label className="chip"><input defaultChecked={outlet.menu_payment_methods.includes("cashier")} name="method_cashier" type="checkbox" /> Cashier</label>
                  <label className="chip"><input defaultChecked={outlet.menu_payment_methods.includes("qris")} name="method_qris" type="checkbox" /> QRIS</label>
                  <label className="chip"><input defaultChecked={outlet.menu_payment_methods.includes("midtrans")} name="method_midtrans" type="checkbox" /> Midtrans</label>
                </div><small>Live: {enabledPaymentMethods(outlet).map((method) => paymentMethodLabel[method]).join(", ") || "none"}{midtransServerKey(outlet.outlet_key) ? "" : " · Midtrans needs a merchant key"}</small></div>
                {isOwner ? <QrisField merchantName={outlet.qris_payload ? qrisMerchantName(outlet.qris_payload) : null} /> : <div className="field">Store QRIS<small>{outlet.qris_payload ? `Saved · ${qrisMerchantName(outlet.qris_payload) ?? "merchant"}` : "Not set"}</small></div>}
                {isOwner ? <FormFooter><SubmitButton pendingLabel="Saving…">Save</SubmitButton></FormFooter> : null}
              </fieldset>
            </ActionForm>
          </Panel>
          <Panel padded title="Tablet sync" description="Also on demand and at every shift close.">
            <ActionForm action={saveAndroidSyncTimesAction}>
              <div className="chips hours">{syncTimes.map((time) => (
                <label className="chip" key={time}><input defaultChecked={outlet.android_sync_times.includes(time)} name="syncTime" type="checkbox" value={time} />{time}</label>
              ))}</div>
              <FormFooter><SubmitButton pendingLabel="Saving…">Save</SubmitButton></FormFooter>
            </ActionForm>
          </Panel>
          <Panel title="Tablets" description={release ? `Latest app ${release.version_name}. Tablets offer the update themselves.` : "Connected cashier tablets."}
            action={release?.apk_url ? <a className="button small" download href={release.apk_url}><Download size={14} /> APK</a> : undefined}>
            {tablets.length ? <div className="list">{tablets.map((tablet) => {
              const outdated = release && tablet.app_version_code !== null && tablet.app_version_code < release.version_code;
              return (
                <div className="list-row" key={tablet.id}>
                  <div style={{ flex: 1, minWidth: 0 }}><strong className="truncate">{tablet.label || "Cashier tablet"}</strong>
                    <span className="cell-sub">{tablet.app_version ? `App ${tablet.app_version}` : "App version not reported yet"}{tablet.last_seen_at ? ` · last sync ${outletFormat(operator.timezone).formatDateTime(tablet.last_seen_at)}` : ""}</span></div>
                  {tablet.app_version_code === null ? null : <span className={`badge ${outdated ? "tone-warning" : "tone-success"}`}>{outdated ? "Update available" : "Up to date"}</span>}
                </div>
              );
            })}</div> : <EmptyState title="No tablets connected yet" />}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// Meja dikelompokkan per area (tab + bagian), tiap meja satu kartu yang sama
// ukuran. Tambah satu meja atau banyak sekaligus; QR bisa dicetak per area.
export async function TablesSection({ operator, edit, creating, area, managingArea }: { operator: Operator; edit: string; creating: string; area: string; managingArea: boolean }) {
  const [tables, outlet] = await Promise.all([tablesData(operator), outletData(operator)]);
  const current = tables.find((table) => table.id === edit);
  const areas = [...new Set(tables.map((table) => table.table_area))];
  const selected = areas.includes(area) ? area : "";
  const visible = selected ? tables.filter((table) => table.table_area === selected) : tables;
  const groups = (selected ? [selected] : areas).map((name) => ({ name, tables: visible.filter((table) => table.table_area === name) }));
  const base = selected ? `/admin/outlet/tables?area=${encodeURIComponent(selected)}` : "/admin/outlet/tables";
  const withParam = (key: string, value: string) => `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  const canPrint = Boolean(outlet?.menu_url) && visible.some((table) => table.is_active);
  const printHref = `/api/qr/sheet${selected ? `?area=${encodeURIComponent(selected)}` : ""}`;

  return (
    <div className="page">
      <PageHeader
        title="Tables & QR"
        description={`${tables.filter((table) => table.is_active).length} active tables in ${areas.length || 0} area${areas.length === 1 ? "" : "s"}`}
        action={<>
          {canPrint ? <a className="button" href={printHref} rel="noreferrer" target="_blank"><Printer size={16} /> Print QR{selected ? ` · ${selected}` : ""}</a> : null}
          <Link className="button primary" href={withParam("new", "bulk")} scroll={false}><Plus size={16} /> Add tables</Link>
        </>}
      />
      {!outlet?.menu_url ? <p className="notice">QR codes need a menu address. <Link href="/admin/outlet/settings"><u>Add it in Outlet settings</u></Link>.</p> : null}
      {areas.length > 1 ? (
        <Tabs items={[
          { href: "/admin/outlet/tables", label: "All", count: tables.length, active: !selected },
          ...areas.map((name) => ({ href: `/admin/outlet/tables?area=${encodeURIComponent(name)}`, label: name, count: tables.filter((table) => table.table_area === name).length, active: name === selected })),
        ]} />
      ) : null}
      {tables.length ? groups.map((group) => (
        <section className="table-area" key={group.name}>
          <header>
            <h2>{group.name}</h2>
            <span className="muted">{group.tables.length} tables · {group.tables.reduce((sum, table) => sum + (table.pax_capacity ?? 0), 0) || "—"} seats</span>
            <div className="action-row">
              <Link className="button small ghost" href={`/admin/outlet/tables?area=${encodeURIComponent(group.name)}&manage=area`} scroll={false}><Pencil size={14} /> Edit area</Link>
              <Link className="button small ghost" href={`/admin/outlet/tables?area=${encodeURIComponent(group.name)}&new=bulk`} scroll={false}><Plus size={14} /> Add here</Link>
            </div>
          </header>
          <div className="table-grid">
            {group.tables.map((table) => (
              <article className={`table-card${table.is_active ? "" : " inactive"}`} key={table.id}>
                <Link className="table-card-main" href={withParam("edit", table.id)} scroll={false}>
                  <strong>{table.table_label}</strong>
                  <span>{table.table_code}{table.pax_capacity ? ` · ${table.pax_capacity} seats` : ""}</span>
                </Link>
                <footer>
                  <ToggleSwitch action={setTableActiveAction} checked={table.is_active} fields={{ id: table.id, active: String(!table.is_active) }} label={table.is_active ? `Deactivate ${table.table_label}` : `Activate ${table.table_label}`} />
                  {table.is_active && outlet?.menu_url ? <a aria-label={`Download QR for ${table.table_label}`} className="icon-button small" download href={`/api/qr/${encodeURIComponent(table.qr_token)}`}><Download size={15} /></a> : null}
                </footer>
              </article>
            ))}
          </div>
        </section>
      )) : <Panel><EmptyState title="No tables yet" action={<Link className="button primary" href="/admin/outlet/tables?new=bulk" scroll={false}>Add tables</Link>} /></Panel>}

      {creating === "bulk" ? (
        <Drawer closeHref={base} title="Add tables" description="Creates numbered tables in one area.">
          <ActionForm action={addTablesAction}>
            <AreaPicker areas={areas} defaultValue={selected || areas[0]} name="tableArea" />
            <div className="form-grid">
              <label className="field"><FieldLabel hint="Letters only. T gives T01, T02…">Code prefix</FieldLabel><input defaultValue="T" maxLength={8} name="codePrefix" /></label>
              <label className="field"><FieldLabel hint="Seen by customers.">Name prefix</FieldLabel><input defaultValue="Table" maxLength={30} name="namePrefix" /></label>
              <label className="field">First number<input defaultValue={String(nextNumber(tables))} min="1" name="from" type="number" /></label>
              <label className="field">How many<input defaultValue="10" max="100" min="1" name="count" type="number" /></label>
              <label className="field">Seats per table<input min="1" name="paxCapacity" placeholder="Optional" type="number" /></label>
            </div>
            <FormFooter>
              <Link className="button ghost" href={withParam("new", "one")} scroll={false}>Add one table instead</Link>
              <SubmitButton pendingLabel="Adding…">Add tables</SubmitButton>
            </FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
      {creating === "one" || current ? (
        <Drawer closeHref={base} title={current ? current.table_label : "Add a table"}>
          <ActionForm action={saveTableAction} successHref={base}>
            {current ? <input name="id" type="hidden" value={current.id} /> : null}
            <AreaPicker areas={areas} defaultValue={current?.table_area ?? (selected || areas[0])} name="tableArea" />
            <div className="form-grid">
              <label className="field"><FieldLabel hint="Printed on the table.">Code</FieldLabel><input defaultValue={current?.table_code} name="tableCode" placeholder="T01" required /></label>
              <label className="field"><FieldLabel hint="Seen by customers.">Name</FieldLabel><input defaultValue={current?.table_label} name="tableLabel" placeholder="Table 1" required /></label>
              <label className="field">Seats<input defaultValue={current?.pax_capacity ?? ""} min="1" name="paxCapacity" type="number" /></label>
            </div>
            <FormFooter><SubmitButton pendingLabel="Saving…">{current ? "Save changes" : "Add table"}</SubmitButton></FormFooter>
          </ActionForm>
          {current ? (
            <ActionForm action={deleteTableAction} className="form-section" confirm={`Delete ${current.table_label}? Its printed QR code stops working. Past orders keep the table name.`} confirmLabel="Delete table">
              <input name="id" type="hidden" value={current.id} />
              <h3>Delete table</h3>
              <p>To pause it, switch it off instead.</p>
              <FormFooter><SubmitButton className="button danger" pendingLabel="Deleting…"><Trash2 size={15} /> Delete table</SubmitButton></FormFooter>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : null}
      {managingArea && selected ? (
        <Drawer closeHref={base} title={`Edit ${selected}`} description={`${visible.length} tables in this area.`}>
          <ActionForm action={renameAreaAction}>
            <input name="area" type="hidden" value={selected} />
            <label className="field"><FieldLabel hint="Using the name of another area moves these tables there.">Area name</FieldLabel><input defaultValue={selected} maxLength={40} name="name" required /></label>
            <FormFooter><SubmitButton pendingLabel="Saving…">Save name</SubmitButton></FormFooter>
          </ActionForm>
          <ActionForm action={deleteAreaAction} className="form-section" confirm={`Delete ${selected} and all ${visible.length} tables in it? Their printed QR codes stop working.`} confirmLabel="Delete area">
            <input name="area" type="hidden" value={selected} />
            <h3>Delete area</h3>
            <p>Also deletes its {visible.length} tables.</p>
            <FormFooter><SubmitButton className="button danger" pendingLabel="Deleting…"><Trash2 size={15} /> Delete area</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}

function nextNumber(tables: Array<{ table_code: string }>): number {
  const numbers = tables.map((table) => Number(table.table_code.match(/\d+/)?.[0] ?? 0));
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}
