"use client";

import {
  BadgePercent, BarChart3, Boxes, Building2, Check, ChevronsUpDown, ChevronUp, Coins, CookingPot, ExternalLink, Grid2X2, History, LayoutDashboard, LifeBuoy,
  LogOut, QrCode, ReceiptText, Settings2, Store, UsersRound, WalletCards,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { logoutAction, switchOutletAction } from "@/app/actions";
import { AskEline } from "@/components/ask-eline";
import { Toaster } from "@/components/interactive";
import { OrderAlerts, OrderSoundToggle } from "@/components/order-alerts";
import { WhatsNew, type DashboardRelease } from "@/components/whats-new";
import type { Operator } from "@/server/auth";

type Role = Operator["role"];
const all: Role[] = ["owner", "manager", "staff", "viewer"];
const operations: Role[] = ["owner", "manager", "staff"];
const management: Role[] = ["owner", "manager"];

const groups = [
  { title: "Operations", items: [
    { href: "/admin/dashboard", label: "Overview", icon: LayoutDashboard, roles: all },
    { href: "/admin/orders", label: "Orders", icon: ReceiptText, roles: operations, count: "orders" as const },
    { href: "/admin/kitchen", label: "Kitchen", icon: CookingPot, roles: operations, count: "kitchen" as const },
    { href: "/admin/shifts", label: "Shifts", icon: WalletCards, roles: management },
    { href: "/admin/reports", label: "Reports", icon: BarChart3, roles: management },
    { href: "/admin/expenses", label: "Expenses", icon: Coins, roles: management },
    { href: "/admin/branches", label: "Branches", icon: Building2, roles: management, branches: true },
  ] },
  { title: "Menu", items: [
    { href: "/admin/products", label: "Products", icon: Boxes, roles: management },
    { href: "/admin/categories", label: "Categories", icon: Grid2X2, roles: management },
    { href: "/admin/promotions", label: "Promotions", icon: BadgePercent, roles: management },
    { href: "/admin/outlet/tables", label: "Tables & QR", icon: QrCode, roles: management },
  ] },
  { title: "Settings", items: [
    { href: "/admin/outlet/settings", label: "Outlet", icon: Store, roles: management },
    { href: "/admin/users", label: "Team", icon: UsersRound, roles: ["owner"] as Role[] },
    { href: "/admin/audit-logs", label: "Audit log", icon: History, roles: ["owner"] as Role[] },
    { href: "/admin/support", label: "Support", icon: LifeBuoy, roles: all, count: "problems" as const },
  ] },
];

export type ShellOutlet = { key: string; name: string; isMain: boolean };

// Pemilih cabang: hanya tampil bila operator anggota lebih dari satu cabang.
// Pilihan dikirim ke server, yang memeriksa ulang keanggotaannya.
function OutletSwitcher({ outlets, current, compact = false }: { outlets: ShellOutlet[]; current: string; compact?: boolean }) {
  const active = outlets.find((outlet) => outlet.key === current);
  return (
    <details className={compact ? "outlet-switcher compact" : "outlet-switcher"} data-menu>
      <summary><Building2 size={15} /><span>{active?.name ?? "Branch"}</span><ChevronsUpDown size={14} /></summary>
      <div className="shell-menu" role="menu">{outlets.map((outlet) => (
        <form action={switchOutletAction} key={outlet.key}>
          <input name="outlet" type="hidden" value={outlet.key} />
          <button aria-current={outlet.key === current ? "true" : undefined} role="menuitem" type="submit">
            <span><strong>{outlet.name}</strong>{outlet.isMain ? <small>Main branch</small> : null}</span>{outlet.key === current ? <Check size={15} /> : null}
          </button>
        </form>
      ))}</div>
    </details>
  );
}

// Menu akun: tautan menu digital, suara pesanan, dan keluar. Dipakai di sidebar
// dan di header ponsel (di ponsel sidebar bawah disembunyikan).
function AccountMenu({ operator, menuUrl, sound, compact = false }: { operator: Operator; menuUrl: string | null; sound: boolean; compact?: boolean }) {
  const avatar = <span className="avatar">{operator.name.slice(0, 1).toUpperCase()}</span>;
  return (
    <details className={compact ? "account-menu compact" : "account-menu"} data-menu>
      <summary aria-label="Account" className={compact ? "icon-button" : "operator-card"}>
        {compact ? avatar : <>{avatar}<span><strong>{operator.name}</strong><small>{operator.role}</small></span><ChevronUp size={15} /></>}
      </summary>
      <div className="shell-menu" role="menu">
        {compact ? <p className="shell-menu-head"><strong>{operator.name}</strong><small>{operator.role}</small></p> : null}
        {menuUrl ? <a href={menuUrl} rel="noreferrer" role="menuitem" target="_blank"><span>Open digital menu</span><ExternalLink size={15} /></a> : null}
        {sound ? <OrderSoundToggle /> : null}
        <form action={logoutAction}><button role="menuitem" type="submit"><span>Sign out</span><LogOut size={15} /></button></form>
      </div>
    </details>
  );
}

export function DashboardShell({ children, counts, menuUrl, operator, outlets, release }: { children: ReactNode; counts: { unpaid: number; fresh: number; problems: number }; menuUrl: string | null; operator: Operator; outlets: ShellOutlet[]; release: DashboardRelease | null }) {
  const activePath = usePathname();
  // Menu <details> tertutup saat klik di luar atau Esc, seperti dropdown lain.
  useEffect(() => {
    const close = (event: Event) => {
      document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]").forEach((menu) => {
        if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target as Node)) menu.open = false;
      });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  // Tandai menu sidebar yang masih bisa digulir ke bawah (layar pendek).
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".sidebar-nav");
    if (!nav) return;
    const mark = () => nav.toggleAttribute("data-more", nav.scrollHeight - nav.scrollTop - nav.clientHeight > 4);
    mark();
    nav.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => { nav.removeEventListener("scroll", mark); window.removeEventListener("resize", mark); };
  }, []);
  const sound = Boolean(menuUrl) && operations.includes(operator.role);
  const badge = { orders: counts.unpaid, kitchen: counts.fresh, problems: operator.role === "owner" || operator.role === "manager" ? counts.problems : 0 };
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link className="brand" href="/admin/dashboard">
          <span className="brand-mark"><Image loading="eager" src="/images/brands/mangalli-fnb-logo.png" alt="" width={28} height={28} /></span>
          <span><strong>Mangalli POS</strong><small>Mulai jualan, tanpa ribet.</small></span>
        </Link>
        {outlets.length > 1 ? <OutletSwitcher current={operator.outletKey} outlets={outlets} /> : null}
        <nav className="sidebar-nav" aria-label="Dashboard">
          {groups.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(operator.role) && (!("branches" in item) || outlets.length > 1 || operator.role === "owner"));
            if (!items.length) return null;
            return [
              <span className="nav-group" key={group.title}>{group.title}</span>,
              ...items.map((item) => {
                const Icon = item.icon;
                const count = "count" in item && item.count ? badge[item.count] : 0;
                const active = activePath === item.href || activePath.startsWith(`${item.href}/`);
                return <Link aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"} href={item.href} key={item.href}><Icon size={17} /><span>{item.label}</span>{count ? <span className="nav-count">{count}</span> : null}</Link>;
              }),
            ];
          })}
        </nav>
        <div className="sidebar-bottom"><AccountMenu menuUrl={menuUrl} operator={operator} sound={sound} /></div>
      </aside>
      <main className="admin-main">
        <header className="mobile-header"><Link className="brand compact" href="/admin/dashboard"><span className="brand-mark"><Image loading="eager" src="/images/brands/mangalli-fnb-logo.png" alt="" width={26} height={26} /></span><strong>Mangalli POS</strong></Link>{outlets.length > 1 ? <OutletSwitcher compact current={operator.outletKey} outlets={outlets} /> : null}{operator.role === "owner" || operator.role === "manager" ? <Link className="icon-button" href="/admin/outlet/settings" aria-label="Settings"><Settings2 size={18} /></Link> : null}<AccountMenu compact menuUrl={menuUrl} operator={operator} sound={sound} /></header>
        {children}
        <footer className="app-credit">Mangalli POS · <a href="https://1garis.id" rel="noreferrer" target="_blank">Developed by 1garis Studio</a></footer>
      </main>
      {sound ? <OrderAlerts /> : null}
      <Toaster />
      <WhatsNew release={release} />
      <AskEline role={operator.role} />
    </div>
  );
}
