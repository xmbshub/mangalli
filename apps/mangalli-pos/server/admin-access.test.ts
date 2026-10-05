import assert from "node:assert/strict";
import test from "node:test";

import { rolesForAdminSection } from "./admin-access";

test("keeps team and audit access owner-only", () => {
  assert.deepEqual(rolesForAdminSection("users"), ["owner"]);
  assert.deepEqual(rolesForAdminSection("audit-logs"), ["owner"]);
});

test("gives staff operational pages without management settings", () => {
  assert.ok(rolesForAdminSection("orders").includes("staff"));
  assert.ok(rolesForAdminSection("kitchen").includes("staff"));
  assert.ok(!rolesForAdminSection("products").includes("staff"));
  assert.ok(!rolesForAdminSection("outlet/settings").includes("staff"));
});

test("lets every role report a problem but keeps reports and reports pages scoped", () => {
  assert.deepEqual(rolesForAdminSection("support"), ["owner", "manager", "staff", "viewer"]);
  assert.ok(!rolesForAdminSection("reports").includes("staff"));
  assert.ok(!rolesForAdminSection("shifts").includes("viewer"));
});

test("keeps menu import to owners and managers", () => {
  assert.deepEqual(rolesForAdminSection("products/import"), ["owner", "manager"]);
});
