// Klien baru (tim 1garis Studio, di container produksi):
//
//   tsx scripts/create-outlet.ts --key kopi-senja --name "Kopi Senja" --owner-email owner@kopisenja.id --owner-name "Sari" [--timezone Asia/Makassar] [--tax 10]
//
// Membuat outlet + brand-nya sendiri dan akun owner native tanpa kata sandi
// yang diketahui siapa pun. Login dashboard tetap lewat identitas pusat: catat
// user ID yang dicetak, lalu petakan di Studio (identity_service_accounts,
// client "pos") sesuai docs/architecture/unified-identity.md. Kata sandi tablet
// owner disetel sendiri dari dashboard (Team) setelah login.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { hash } from "bcryptjs";
import { Pool } from "pg";

const { values } = parseArgs({
  options: { key: { type: "string" }, name: { type: "string" }, "owner-email": { type: "string" }, "owner-name": { type: "string" }, timezone: { type: "string" }, tax: { type: "string" } },
});
const key = values.key?.trim() ?? "";
const name = values.name?.trim() ?? "";
const email = values["owner-email"]?.trim().toLowerCase() ?? "";
const ownerName = values["owner-name"]?.trim() ?? "";
const timezone = values.timezone ?? "Asia/Makassar";
const tax = values.tax === undefined ? 10 : Number(values.tax);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 40) throw new Error("--key: lowercase letters, numbers and dashes, up to 40 characters.");
if (!name || !ownerName) throw new Error("--name and --owner-name are required.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--owner-email is not a valid email.");
if (!["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"].includes(timezone)) throw new Error("--timezone: Asia/Jakarta, Asia/Makassar or Asia/Jayapura.");
if (!Number.isFinite(tax) || tax < 0 || tax > 30) throw new Error("--tax: percent between 0 and 30.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  if ((await client.query("SELECT 1 FROM outlets WHERE outlet_key = $1", [key])).rowCount) throw new Error(`Outlet ${key} already exists.`);
  if ((await client.query("SELECT 1 FROM users WHERE lower(email) = $1", [email])).rowCount) throw new Error(`${email} already has a Mangalli account; use Branch access instead.`);
  await client.query("INSERT INTO brands(brand_key, name) VALUES ($1, $2)", [key, name]);
  await client.query(
    `INSERT INTO outlets(outlet_key, name, public_name, timezone, tax_rate, brand_key, menu_payment_methods)
     VALUES ($1, $2, $2, $3, $4, $1, ARRAY['cashier']::text[])`, [key, name, timezone, tax / 100]);
  await client.query("UPDATE brands SET main_outlet_key = $1 WHERE brand_key = $1", [key]);
  const user = await client.query<{ id: string }>(
    `INSERT INTO users(outlet_key, name, email, password_hash, pos_role, is_active, email_verified_at)
     VALUES ($1, $2, $3, $4, 'owner', true, now()) RETURNING id::text`, [key, ownerName, email, await hash(randomBytes(32).toString("base64url"), 12)]);
  await client.query(
    `INSERT INTO pos_audit_logs(outlet_key, action, metadata) VALUES ($1, 'outlet.created', $2::jsonb)`,
    [key, JSON.stringify({ summary: `Outlet ${name} created by 1garis Studio with owner ${email}.` })]);
  await client.query("COMMIT");
  console.log(`Created outlet ${key} (${name}). Owner ${email} has Mangalli user ID ${user.rows[0].id}; map it in Studio for dashboard login.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
