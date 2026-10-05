import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalPool = globalThis as typeof globalThis & { mangalliPool?: Pool };

export const pool =
  globalPool.mangalliPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalPool.mangalliPool = pool;

export function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
