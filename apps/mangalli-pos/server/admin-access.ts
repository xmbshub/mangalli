import type { Operator } from "./auth";

const ownerOnly = new Set(["users", "audit-logs"]);
const managerOrOwner = new Set([
  "products", "products/import", "promotions", "categories", "shifts", "reports", "expenses", "branches", "outlet", "outlet/settings", "outlet/tables", "outlet/qr",
]);

export function rolesForAdminSection(section: string): Operator["role"][] {
  if (ownerOnly.has(section)) return ["owner"];
  if (managerOrOwner.has(section)) return ["owner", "manager"];
  if (section === "orders" || section === "kitchen") return ["owner", "manager", "staff"];
  // Semua peran bisa melaporkan masalah; daftar lengkap hanya untuk owner/manager.
  if (section === "support") return ["owner", "manager", "staff", "viewer"];
  return ["owner", "manager", "staff", "viewer"];
}
