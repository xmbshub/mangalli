import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CategoriesSection, MenuImportSection, ProductsSection } from "@/components/admin/catalog";
import { StepUpGate } from "@/components/step-up-gate";
import { DashboardSection } from "@/components/admin/dashboard";
import { KitchenSection, OrdersSection } from "@/components/admin/orders";
import { OutletSection, TablesSection } from "@/components/admin/outlet";
import { BranchesSection } from "@/components/admin/branches";
import { ExpensesSection } from "@/components/admin/expenses";
import { ReportsSection, reportTabs, type ReportTab } from "@/components/admin/reports";
import { PromotionsSection } from "@/components/admin/promotions";
import { SupportSection } from "@/components/admin/support";
import { AuditSection, ShiftsSection, UsersSection } from "@/components/admin/team";
import { EmptyState, PageHeader, pageNumber, Panel } from "@/components/ui";
import { auditKinds, orderSorts, orderTabs, productSorts, reportPeriod, type AuditKind, type OrderSort, type OrderTab } from "@/server/admin";
import { rolesForAdminSection } from "@/server/admin-access";
import { requireWebOperator } from "@/server/auth";

type PageProps = { params: Promise<{ section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const titles: Record<string, string> = {
  dashboard: "Overview", orders: "Orders", "products/import": "Import menu", promotions: "Promotions", kitchen: "Kitchen", products: "Products", categories: "Categories",
  outlet: "Outlet settings", "outlet/settings": "Outlet settings", "outlet/tables": "Tables & QR", "outlet/qr": "Tables & QR",
  users: "Team", shifts: "Shifts", reports: "Reports", expenses: "Expenses", branches: "Branches", "audit-logs": "Audit log", support: "Support",
};

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  return { title: titles[((await params).section ?? ["dashboard"]).join("/")] ?? "Not found" };
}

// One route for every dashboard page. Lists, filters, and the open drawer
// live in the URL, so every view can be refreshed, shared, and navigated back.
export default async function AdminPage({ params, searchParams }: PageProps) {
  const parts = (await params).section ?? ["dashboard"];
  if (!parts.length) redirect("/admin/dashboard");
  const section = parts.join("/");
  const operator = await requireWebOperator(await headers());
  if (!rolesForAdminSection(section).includes(operator.role)) redirect("/admin/dashboard");
  const raw = await searchParams;
  const param = (key: string) => {
    const value = raw[key];
    return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 120) ?? "";
  };
  const creating = param("new") === "1";

  switch (section) {
    case "dashboard":
      return <DashboardSection operator={operator} />;
    case "orders":
      return <OrdersSection from={param("from")} openId={param("order")} operator={operator} page={pageNumber(param("page"))} search={param("q")}
        sort={Object.hasOwn(orderSorts, param("sort")) ? (param("sort") as OrderSort) : "newest"} tab={Object.hasOwn(orderTabs, param("tab")) ? (param("tab") as OrderTab) : "all"} to={param("to")} />;
    case "kitchen":
      return <KitchenSection operator={operator} />;
    case "products":
      return <ProductsSection creating={creating} edit={param("edit")} filters={{ q: param("q"), category: param("category"), status: param("status"), sort: Object.hasOwn(productSorts, param("sort")) ? param("sort") : "" }} group={param("group")} operator={operator} page={pageNumber(param("page"))} />;
    case "products/import":
      return <MenuImportSection draftId={param("draft")} operator={operator} />;
    case "promotions":
      return <PromotionsSection creating={creating} edit={param("edit")} operator={operator} />;
    case "categories":
      return <CategoriesSection creating={creating} edit={param("edit")} operator={operator} />;
    case "outlet":
    case "outlet/settings":
      return <StepUpGate next="/admin/outlet/settings" operator={operator} title="Outlet settings"><OutletSection operator={operator} /></StepUpGate>;
    case "outlet/tables":
    case "outlet/qr":
      return <TablesSection area={param("area")} creating={param("new") === "1" ? "one" : param("new")} edit={param("edit")} managingArea={param("manage") === "area"} operator={operator} />;
    case "users":
      return <StepUpGate next="/admin/users" operator={operator} title="Team"><UsersSection creating={param("new") === "1"} edit={param("edit")} operator={operator} /></StepUpGate>;
    case "shifts":
      return <ShiftsSection opening={param("open") === "1"} operator={operator} page={pageNumber(param("page"))} />;
    case "reports":
      return <ReportsSection operator={operator} period={reportPeriod(operator.timezone, param("range") || "30", param("from"), param("to"))} tab={Object.hasOwn(reportTabs, param("tab")) ? (param("tab") as ReportTab) : "summary"} />;
    case "branches":
      return <BranchesSection created={param("created")} creating={creating} operator={operator} range={param("range")} />;
    case "expenses":
      return <ExpensesSection category={param("category")} creating={creating} edit={param("edit")} operator={operator} page={pageNumber(param("page"))} period={reportPeriod(operator.timezone, param("range") || "month", param("from"), param("to"))} />;
    case "audit-logs":
      return <AuditSection kind={Object.hasOwn(auditKinds, param("kind")) ? (param("kind") as AuditKind) : "all"} operator={operator} page={pageNumber(param("page"))} search={param("q")} />;
    case "support":
      return <SupportSection creating={creating} open={param("report")} operator={operator} page={pageNumber(param("page"))} status={param("tab") === "resolved" ? "resolved" : "open"} />;
    default:
      return <div className="page"><PageHeader title="Page not found" /><Panel><EmptyState title="Page not found" action={<Link className="button primary" href="/admin/dashboard">Back to overview</Link>} /></Panel></div>;
  }
}
