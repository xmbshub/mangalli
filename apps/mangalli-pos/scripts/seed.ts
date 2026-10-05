import { hash } from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const outletKey = process.env.MENU_POS_DEFAULT_OUTLET_KEY ?? "demo";
const ownerEmail = process.env.POS_OWNER_EMAIL ?? "owner@mangalli.local";
const ownerPassword = process.env.POS_OWNER_PASSWORD;

if (!ownerPassword || ownerPassword.length < 6) {
  throw new Error("POS_OWNER_PASSWORD must contain at least 6 characters.");
}

try {
  await pool.query(
    `INSERT INTO outlets(outlet_key, name, public_name, tagline, logo_image_url)
     VALUES ($1, 'Mangalli POS', 'Mangalli POS', 'Mulai jualan, tanpa ribet.', '/images/brands/mangalli-fnb-logo.png')
     ON CONFLICT (outlet_key) DO UPDATE SET updated_at = now()`,
    [outletKey],
  );
  await pool.query(
    `INSERT INTO users(outlet_key, name, email, password_hash, pos_role, is_active, email_verified_at)
     VALUES ($1, 'Owner', $2, $3, 'owner', true, now())
     ON CONFLICT (email) DO UPDATE SET outlet_key = EXCLUDED.outlet_key, password_hash = EXCLUDED.password_hash,
       pos_role = 'owner', is_active = true, updated_at = now()`,
    [outletKey, ownerEmail.toLowerCase(), await hash(ownerPassword, 12)],
  );
  console.log(`Seeded ${outletKey} and ${ownerEmail}`);
} finally {
  await pool.end();
}
