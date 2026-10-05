import "server-only";

import type { PoolClient } from "pg";

import { HttpError } from "./http";

// Sisa stok dihitung, tidak disimpan: jumlah yang dihitung owner dikurangi item
// di pesanan tidak batal sejak saat itu. NULL = stok tidak dilacak.
export function availableStockSql(alias = "p") {
  return `CASE WHEN ${alias}.stock_quantity IS NULL THEN NULL ELSE ${alias}.stock_quantity - coalesce((
    SELECT sum(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = ${alias}.id AND o.restaurant_status <> 'cancelled' AND o.created_at >= ${alias}.stock_counted_at), 0)::int END`;
}

export async function availableStock(client: Pick<PoolClient, "query">, outletKey: string, productIds?: string[]) {
  const result = await client.query<{ id: string; name: string; available: number | null }>(
    `SELECT p.id, p.name, ${availableStockSql("p")} AS available FROM products p
      WHERE p.outlet_key = $1 AND p.stock_quantity IS NOT NULL AND ($2::text[] IS NULL OR p.id = ANY($2::text[]))`,
    [outletKey, productIds ?? null],
  );
  return new Map(result.rows.map((row) => [row.id, { name: row.name, available: Number(row.available) }]));
}

// Pesanan menu digital: kunci baris produk yang stoknya dilacak (FOR UPDATE)
// supaya dua pelanggan tidak mengambil unit terakhir yang sama, lalu tolak
// bila jumlah yang diminta melebihi sisa.
export async function assertStock(client: PoolClient, outletKey: string, lines: Array<{ productId: string | null; quantity: number }>) {
  const wanted = new Map<string, number>();
  for (const line of lines) if (line.productId) wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  if (!wanted.size) return;
  await client.query("SELECT id FROM products WHERE outlet_key = $1 AND id = ANY($2::text[]) AND stock_quantity IS NOT NULL ORDER BY id FOR UPDATE", [outletKey, [...wanted.keys()]]);
  const stock = await availableStock(client, outletKey, [...wanted.keys()]);
  for (const [productId, quantity] of wanted) {
    const left = stock.get(productId);
    if (left && quantity > left.available) {
      throw new HttpError(422, left.available > 0 ? `Only ${left.available} ${left.name} left.` : `${left.name} is sold out.`);
    }
  }
}

// Penjualan tablet offline tidak pernah ditolak; bila ternyata melebihi stok,
// owner melihatnya di audit log (sekali per produk per pesanan).
export async function recordOversold(client: PoolClient, outletKey: string, orderId: string, orderCode: string | null, productIds: string[]) {
  if (!productIds.length) return;
  const stock = await availableStock(client, outletKey, productIds);
  for (const [productId, left] of stock) {
    if (left.available >= 0) continue;
    const eventId = `oversold:${orderId}:${productId}`;
    const logged = await client.query("SELECT 1 FROM pos_audit_logs WHERE outlet_key=$1 AND metadata->>'event_id'=$2 LIMIT 1", [outletKey, eventId]);
    if (logged.rowCount) continue;
    await client.query(
      `INSERT INTO pos_audit_logs(outlet_key, action, auditable_type, reason, metadata) VALUES ($1,'product.oversold','product',NULL,$2::jsonb)`,
      [outletKey, JSON.stringify({ event_id: eventId, ref: productId, summary: `${left.name} sold ${-left.available} more than in stock (${orderCode ?? "tablet order"}). Recount the stock.` })],
    );
  }
}
