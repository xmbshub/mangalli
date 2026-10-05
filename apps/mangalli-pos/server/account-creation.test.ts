import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

test("the native team action denies account creation before validation, password hashing or DB writes", async () => {
  const source = fs.readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function saveUserAction");
  const end = source.indexOf("\nexport async function", start + 1);
  const action = source.slice(start, end).replace("export async", "async");
  const compiled = ts.transpile(action, { target: ts.ScriptTarget.ES2022 });
  let databaseCalls = 0;
  const context = vm.createContext({
    operator: async () => ({ id: "owner", outletKey: "tenant" }),
    requireStepUp: async () => {},
    text: (data: FormData, key: string) => String(data.get(key) || ""),
    fail: (message: string) => { throw new Error(message); },
    run: async (_paths: string[], operation: () => Promise<unknown>) => operation(),
    pool: { query: () => { databaseCalls++; throw new Error("native_db_reached"); } },
  });
  vm.runInContext(`${compiled};globalThis.action=saveUserAction`, context);
  await assert.rejects(context.action(null, new FormData()), /Use Add cashier to add someone new/);
  assert.equal(databaseCalls, 0);
});

test("owners add cashiers only: the native account is always Staff, whatever the form says", async () => {
  const { z } = await import("zod");
  const source = fs.readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function addCashierAction");
  const end = source.indexOf("export async function setUserActiveAction", start);
  const compiled = ts.transpile(source.slice(start, end).replace("export async", "async"), { target: ts.ScriptTarget.ES2022 });
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  let roles: string[] = [];
  let stepUpChecked = false;
  const context = vm.createContext({
    z,
    operator: async (allowed: string[]) => { roles = allowed; return { id: "1", outletKey: "tenant" }; },
    text: (data: FormData, key: string) => String(data.get(key) || ""),
    fail: (message: string) => { throw new Error(message); },
    run: async (_paths: string[], operation: () => Promise<unknown>) => operation(),
    hash: async () => "hashed",
    requireStepUp: async () => { stepUpChecked = true; },
    audit: async () => {},
    pool: { query: async (sql: string, values: unknown[]) => { writes.push({ sql, values }); return sql.startsWith("SELECT") ? { rows: [] } : { rows: [{ id: "9" }] }; } },
  });
  vm.runInContext(`${compiled};globalThis.action=addCashierAction`, context);
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Rina", email: "Rina@Example.com", password: "secret1", role: "owner", pos_role: "owner" })) form.set(key, value);
  await context.action(null, form);
  assert.equal(JSON.stringify(roles), '["owner"]');
  assert.ok(stepUpChecked, "adding a cashier must ask for the PIN or password unlock");
  const insert = writes.find((write) => write.sql.startsWith("INSERT INTO users"));
  assert.ok(insert?.sql.includes("'staff'"));
  assert.equal(JSON.stringify(insert?.values), JSON.stringify(["tenant", "Rina", "rina@example.com", "hashed"]));
});
