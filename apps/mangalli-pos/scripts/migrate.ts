import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrationDir = path.join(process.cwd(), "migrations");

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationDir)).filter((file) => !file.startsWith(".") && file.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql = await readFile(path.join(migrationDir, file), "utf8");
      // Keep every statement individually observable and compatible with Pg's
      // extended protocol instead of sending one opaque multi-statement frame.
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((value) => value.trim()).filter(Boolean);
      for (const [index, statement] of statements.entries()) {
        try {
          await client.query(statement);
        } catch (error) {
          throw new Error(`${file} failed at statement ${index + 1}.`, { cause: error });
        }
      }
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
