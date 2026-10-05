import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import { navCounts } from "@/server/admin";
import { latestRelease } from "@/server/app-releases";
import { brandOutlets } from "@/server/branches";
import { requireWebOperator } from "@/server/auth";
import { query } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let operator;
  try {
    operator = await requireWebOperator(await headers());
  } catch {
    redirect("/login");
  }
  const [outlet, counts, branches, release] = await Promise.all([
    query<{ menu_url: string | null }>("SELECT menu_url FROM outlets WHERE outlet_key=$1", [operator.outletKey]),
    navCounts(operator),
    brandOutlets(operator),
    latestRelease("dashboard"),
  ]);
  const outlets = branches.filter((branch) => branch.role).map((branch) => ({ key: branch.outlet_key, name: branch.name, isMain: branch.is_main }));
  return <DashboardShell counts={counts} menuUrl={outlet.rows[0]?.menu_url ?? null} operator={operator} outlets={outlets} release={release ? { code: release.version_code, name: release.version_name, notes: release.notes } : null}>{children}</DashboardShell>;
}
