import "server-only";

import type { Pool, PoolClient } from "pg";

import type { Promotion } from "./promotion-rules";

type Row = {
  id: string; name: string; kind: "percent" | "amount"; value: string; max_discount: string | null; min_subtotal: string;
  scope: Promotion["scope"]; category_ids: string[]; product_ids: string[]; channels: Promotion["channels"]; days: number[];
  start_time: string | null; end_time: string | null; is_active: boolean;
  code: string | null; starts_on: string | null; ends_on: string | null; max_uses: number | null; used: number;
};

export async function loadPromotions(client: Pick<Pool | PoolClient, "query">, outletKey: string, options: { activeOnly?: boolean } = {}): Promise<Promotion[]> {
  const result = await client.query<Row>(
    `SELECT id::text, name, kind, value::text, max_discount::text, min_subtotal::text, scope, category_ids::text[] AS category_ids,
       product_ids, channels, days::int[] AS days, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, is_active,
       code, starts_on::text, ends_on::text, max_uses,
       (SELECT count(*)::int FROM orders o WHERE o.promotion_id=promotions.id AND o.restaurant_status <> 'cancelled') AS used
     FROM promotions WHERE outlet_key=$1 ${options.activeOnly ? "AND is_active" : ""} ORDER BY is_active DESC, created_at DESC`,
    [outletKey]);
  return result.rows.map((row) => ({
    id: Number(row.id), name: row.name, kind: row.kind, value: Number(row.value), maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
    minSubtotal: Number(row.min_subtotal), scope: row.scope, categoryIds: row.category_ids, productIds: row.product_ids, channels: row.channels,
    days: row.days, startTime: row.start_time, endTime: row.end_time, isActive: row.is_active,
    code: row.code, startsOn: row.starts_on, endsOn: row.ends_on, maxUses: row.max_uses, used: row.used,
  }));
}
