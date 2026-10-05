import Link from "next/link";
import type { ReactNode } from "react";

import { Hint } from "@/components/interactive";

// Komponen dasar design system dashboard. Semua halaman memakai bentuk yang
// sama: PageHeader, lalu Tabs/FilterForm, lalu kartu di grid bento
// (`.bento` + `span-*`). Buat dan edit selalu lewat Drawer (interactive.tsx).
// Teks: judul 1 sampai 3 kata, keterangan paling banyak satu kalimat pendek.

// info: penjelasan lengkap sebagai tooltip di samping judul, supaya keterangan tetap satu baris pendek.
export function PageHeader({ title, description, action, info }: { title: string; description?: string; action?: ReactNode; info?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}{info ? <Hint>{info}</Hint> : null}</h1>{description ? <p>{description}</p> : null}</div>{action ? <div className="page-action">{action}</div> : null}</div>;
}

export function Panel({ title, description, action, children, padded = false, className = "", info }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; padded?: boolean; className?: string; info?: ReactNode }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title ? <header className="panel-header"><div><h2>{title}{info ? <Hint>{info}</Hint> : null}</h2>{description ? <p>{description}</p> : null}</div>{action}</header> : null}
      {padded ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}

// Tabel atau kartu kosong: satu baris pendek di tengah, tanpa ikon. Tombol
// aksi (mis. "Add tables") di bawahnya bila ada yang bisa dilakukan.
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="empty-state"><p>{title}</p>{action}</div>;
}

export function Kpi({ label, value, hint, tone, icon, href, className = "span-3" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "up" | "down"; icon?: ReactNode; href?: string; className?: string }) {
  const body = <><span className="kpi-label">{icon}{label}</span><span className="kpi-value">{value}</span>{hint ? <span className={`kpi-hint ${tone ?? ""}`}>{hint}</span> : null}</>;
  return href ? <Link className={`kpi attention ${className}`} href={href}>{body}</Link> : <article className={`kpi ${className}`}>{body}</article>;
}

export function Tabs({ items }: { items: Array<{ href: string; label: string; count?: number; active: boolean }> }) {
  return <nav className="tabs">{items.map((item) => <Link className={item.active ? "tab active" : "tab"} href={item.href} key={item.href} scroll={false}>{item.label}{item.count ? <span className="tab-count">{item.count}</span> : null}</Link>)}</nav>;
}

export function Segmented({ items }: { items: Array<{ href: string; label: string; active: boolean }> }) {
  return <nav className="segmented">{items.map((item) => <Link className={item.active ? "active" : ""} href={item.href} key={item.href} scroll={false}>{item.label}</Link>)}</nav>;
}

type Tone = "success" | "warning" | "info" | "danger" | "neutral";

// Status labels in plain cashier English, with the same colour on every page.
const statusMap: Record<string, [string, Tone]> = {
  pending_payment: ["Awaiting payment", "warning"],
  new: ["New", "warning"],
  accepted: ["Accepted", "info"],
  preparing: ["Preparing", "info"],
  ready: ["Ready", "success"],
  completed: ["Completed", "neutral"],
  cancelled: ["Cancelled", "danger"],
  pending: ["Unpaid", "warning"],
  paid: ["Paid", "success"],
  failed: ["Failed", "danger"],
  expired: ["Expired", "danger"],
  refunded: ["Refunded", "neutral"],
  available: ["Available", "success"],
  unavailable: ["Sold out", "danger"],
  hidden: ["Hidden", "neutral"],
  open: ["Open", "success"],
  closed: ["Closed", "neutral"],
  active: ["Active", "success"],
  inactive: ["Inactive", "neutral"],
  owner: ["Owner", "warning"],
  manager: ["Manager", "info"],
  staff: ["Cashier", "neutral"],
  viewer: ["Viewer", "neutral"],
};

export function Badge({ value, kind }: { value: string | null; kind?: "payment" }) {
  const key = kind === "payment" && value === "completed" ? "paid" : value ?? "";
  const [label, tone] = statusMap[key] ?? [value ?? "—", "neutral"];
  return <span className={`badge tone-${tone}`}>{label}</span>;
}

export const paymentMethodLabel: Record<string, string> = {
  cash: "Cash", qris: "QRIS", midtrans: "Midtrans", cashier: "Pay at cashier", card: "Card", edc: "Card", transfer: "Transfer", other: "Other",
};


export const PAGE_SIZE = 25;

export function pageNumber(value: string): number {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

// Pagination di kaki tabel: rentang yang tampil, halaman sebelumnya/berikutnya,
// dan nomor halaman ringkas (1 … 4 5 6 … 20). Tautan biasa, jadi bisa dibagikan.
export function Pagination({ page, total, href, pageSize = PAGE_SIZE }: { page: number; total: number; href: (page: number) => string; pageSize?: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="pagination"><span>{total} {total === 1 ? "row" : "rows"}</span></div> : null;
  const current = Math.min(page, pages);
  const numbers = [...new Set([1, current - 1, current, current + 1, pages])].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  const from = (current - 1) * pageSize + 1;
  return (
    <nav aria-label="Pages" className="pagination">
      <span>{from}–{Math.min(total, current * pageSize)} of {total}</span>
      <div className="pagination-pages">
        {current > 1 ? <Link aria-label="Previous page" className="button small ghost" href={href(current - 1)} scroll={false}>Previous</Link> : <span className="button small ghost disabled">Previous</span>}
        {numbers.map((value, index) => (
          <span className="pagination-item" key={value}>
            {index > 0 && value - numbers[index - 1] > 1 ? <span className="pagination-gap">…</span> : null}
            <Link aria-current={value === current ? "page" : undefined} className={value === current ? "page-link on" : "page-link"} href={href(value)} scroll={false}>{value}</Link>
          </span>
        ))}
        {current < pages ? <Link aria-label="Next page" className="button small ghost" href={href(current + 1)} scroll={false}>Next</Link> : <span className="button small ghost disabled">Next</span>}
      </div>
    </nav>
  );
}
