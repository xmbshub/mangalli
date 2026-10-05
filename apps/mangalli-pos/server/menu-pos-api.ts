import "server-only";

import { timingSafeEqual } from "node:crypto";
import {
  canTransitionRestaurantOrderStatus,
  isRestaurantOrderStatus,
  type RestaurantOrderStatus,
} from "@1garis/menu-pos-core";
import type { PoolClient } from "pg";
import { z } from "zod";

import { bearerToken } from "./auth";
import { pool, transaction } from "./db";
import { HttpError, jsonError } from "./http";
import { checkCoupon, couponCheckInput, createMenuOrder, menuOrderDetail, menuOrderInput, storefront } from "./menu-orders";
import { enforceRateLimit, rateLimitKey } from "./rate-limit";
import {
  activeShift,
  formatIdr,
  insertItems,
  legacyStatus,
  loadOrder,
  outletTaxRate,
  loadOrderItems,
  opaqueToken,
  uniqueOrderCode,
  validateItems,
} from "./pos";

function authorize(request: Request) {
  const expected = Buffer.from(process.env.MENU_POS_ADAPTER_TOKEN?.trim() ?? "");
  if (!expected.length) throw new HttpError(503, "Menu POS adapter token is not configured.");
  const actual = Buffer.from(bearerToken(request) ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new HttpError(401, "Unauthorized.");
}

async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

async function knownOutlet(client: PoolClient, outletKey: string) {
  const result = await client.query("SELECT 1 FROM outlets WHERE outlet_key = $1", [outletKey]);
  if (!result.rowCount) throw new HttpError(404, "Outlet not found.");
}

async function menu(request: Request, outletKey: string) {
  authorize(request);
  return transaction(async (client) => {
    await knownOutlet(client, outletKey);
    const products = await client.query<{
      id: string; category: string; description: string | null; name: string; price: string;
      availability: string; sort_order: number; image_url: string | null;
    }>(
      `SELECT p.id, c.name AS category, p.description, p.name, p.price::text, p.availability, p.sort_order,
        (SELECT ph.url FROM product_photos ph WHERE ph.product_id=p.id ORDER BY ph.is_primary DESC, ph.id LIMIT 1) AS image_url
       FROM products p JOIN categories c ON c.id=p.category_id
       WHERE p.outlet_key=$1 AND p.availability <> 'hidden' ORDER BY p.sort_order,p.name`,
      [outletKey],
    );
    const items = [];
    for (const product of products.rows) {
      const groups = await client.query<{ id: string; name: string; is_required: boolean; min_select: number; max_select: number; sort_order: number }>(
        "SELECT id::text,name,is_required,min_select,max_select,sort_order FROM product_modifier_groups WHERE product_id=$1 ORDER BY sort_order,id",
        [product.id],
      );
      const modifierGroups = [];
      for (const group of groups.rows) {
        const options = await client.query<{ id: string; name: string; price_delta: string; sort_order: number }>(
          "SELECT id::text,name,price_delta::text,sort_order FROM product_modifier_options WHERE group_id=$1 AND is_available=true ORDER BY sort_order,id",
          [group.id],
        );
        modifierGroups.push({
          id: Number(group.id), isRequired: group.is_required, maxSelect: group.max_select, minSelect: group.min_select,
          name: group.name, sortOrder: group.sort_order,
          options: options.rows.map((option) => ({ id: Number(option.id), name: option.name, priceDelta: Number(option.price_delta), priceDeltaLabel: formatIdr(Number(option.price_delta)), sortOrder: option.sort_order })),
        });
      }
      items.push({
        category: product.category, description: product.description, id: product.id, imageUrl: product.image_url,
        isAvailable: product.availability === "available", modifierGroups, name: product.name,
        priceLabel: formatIdr(Number(product.price)), sortOrder: product.sort_order,
      });
    }
    return Response.json({ items });
  });
}

async function qrTable(request: Request, qrToken: string) {
  authorize(request);
  return transaction(async (client) => {
    const result = await client.query<{ outlet_key: string; qr_token: string; table_code: string; table_label: string; pax_capacity: number | null }>(
      "SELECT outlet_key,qr_token,table_code,table_label,pax_capacity FROM qr_tables WHERE qr_token=$1 AND is_active=true",
      [qrToken],
    );
    const table = result.rows[0];
    if (!table) throw new HttpError(404, "QR table not found.");
    return Response.json({ outletKey: table.outlet_key, qrToken: table.qr_token, tableCode: table.table_code, tableLabel: table.table_label, paxCapacity: table.pax_capacity });
  });
}

function orderStatus(value: string | null): RestaurantOrderStatus {
  return isRestaurantOrderStatus(value) ? value : "new";
}

async function orderSummary(client: PoolClient, orderId: string) {
  const result = await client.query<{
    id: string; order_code: string | null; created_at: Date; order_mode: "dinein" | "takeaway";
    public_token: string; restaurant_status: string; table_label: string | null;
  }>("SELECT id::text,order_code,created_at,order_mode,public_token,restaurant_status,table_label FROM orders WHERE id=$1", [orderId]);
  const order = result.rows[0];
  if (!order) throw new HttpError(404, "Order not found.");
  return {
    code: order.order_code || `1GK-${String(Number(order.id) % 10_000).padStart(4, "0")}`,
    createdAt: order.created_at.toISOString(), id: order.id, mode: order.order_mode,
    publicToken: order.public_token, status: orderStatus(order.restaurant_status), tableLabel: order.table_label,
  };
}

async function listOrders(request: Request, outletKey: string) {
  authorize(request);
  return transaction(async (client) => {
    await knownOutlet(client, outletKey);
    const result = await client.query<{
      id: string; customer_name: string | null; pickup_name: string | null; payment_status: string | null; amount: string | null;
    }>(`SELECT o.id::text,o.customer_name,o.pickup_name,p.status AS payment_status,p.amount::text
          FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.outlet_key=$1 ORDER BY o.created_at DESC LIMIT 100`, [outletKey]);
    const orders = [];
    for (const row of result.rows) {
      const items = await loadOrderItems(client, row.id);
      orders.push({
        ...(await orderSummary(client, row.id)), customerName: row.customer_name, pickupName: row.pickup_name,
        paymentStatus: row.payment_status, totalPriceLabel: formatIdr(Number(row.amount ?? 0)),
        lines: items.map((item) => ({
          name: item.item_name || item.product_name || "Menu item", quantity: item.quantity,
          note: [item.modifier_summary, item.notes].filter(Boolean).join("\n") || null,
          priceLabel: formatIdr(Number(item.unit_price)),
        })),
      });
    }
    return Response.json({ orders });
  });
}

const hourInput = z.object({
  key: z.string().trim().min(1).max(40), day: z.string().trim().max(40).nullish(), isOpen: z.boolean(),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(), closeTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
});
const profileInput = z.object({
  address: z.string().max(1000).nullish(), bannerImageUrl: z.string().max(2048).nullish(), isActive: z.boolean().optional(),
  logoImageUrl: z.string().max(2048).nullish(), name: z.string().trim().min(1).max(255).optional(),
  openingHours: z.array(hourInput).nullish(), phone: z.string().max(60).nullish(), publicName: z.string().max(255).nullish(),
  tagline: z.string().max(160).nullish(),
}).partial();

function profilePayload(row: {
  outlet_key: string; name: string; public_name: string | null; tagline: string | null; address: string | null;
  phone: string | null; logo_image_url: string | null; banner_image_url: string | null; is_active: boolean; opening_hours: unknown;
}) {
  const source = Array.isArray(row.opening_hours) ? row.opening_hours : [];
  return {
    outletKey: row.outlet_key, name: row.name, publicName: row.public_name, tagline: row.tagline, address: row.address,
    phone: row.phone, logoImageUrl: row.logo_image_url, bannerImageUrl: row.banner_image_url, isActive: row.is_active,
    openingHours: source.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const hour = value as Record<string, unknown>;
      const key = typeof hour.key === "string" ? hour.key : null;
      return key ? [{ key, day: hour.day ?? null, isOpen: hour.is_open ?? hour.isOpen ?? false, openTime: hour.open_time ?? hour.openTime ?? null, closeTime: hour.close_time ?? hour.closeTime ?? null }] : [];
    }),
  };
}

async function syncProfile(request: Request, outletKey: string) {
  authorize(request);
  const input = profileInput.parse(await body(request));
  return transaction(async (client) => {
    await knownOutlet(client, outletKey);
    const before = await client.query("SELECT * FROM outlets WHERE outlet_key=$1", [outletKey]);
    const columns: string[] = [];
    const values: unknown[] = [];
    const mapping: Record<string, string> = {
      address: "address", bannerImageUrl: "banner_image_url", isActive: "is_active", logoImageUrl: "logo_image_url",
      name: "name", openingHours: "opening_hours", phone: "phone", publicName: "public_name", tagline: "tagline",
    };
    for (const [key, value] of Object.entries(input)) {
      values.push(key === "openingHours" ? JSON.stringify((value as z.infer<typeof hourInput>[] | null)?.map((hour) => ({
        key: hour.key, day: hour.day, is_open: hour.isOpen, open_time: hour.openTime, close_time: hour.closeTime,
      })) ?? null) : value);
      columns.push(`${mapping[key]}=$${values.length + 1}${key === "openingHours" ? "::jsonb" : ""}`);
    }
    if (columns.length) {
      await client.query(`UPDATE outlets SET ${columns.join(",")},updated_at=now() WHERE outlet_key=$1`, [outletKey, ...values]);
      await client.query(
        `INSERT INTO pos_audit_logs(outlet_key,action,auditable_type,auditable_id,metadata)
         VALUES ($1,'adapter.outlet_profile_sync','outlet',$2,$3::jsonb)`,
        [outletKey, before.rows[0].id, JSON.stringify({ before: before.rows[0], fields: Object.keys(input), source: "payload" })],
      );
    }
    const result = await client.query("SELECT * FROM outlets WHERE outlet_key=$1", [outletKey]);
    return Response.json(profilePayload(result.rows[0]));
  });
}

const createOrderInput = z.object({
  customerName: z.string().trim().min(1).max(255),
  items: z.array(z.object({
    menuItemId: z.string().trim().min(1), quantity: z.number().int().min(1).max(99), note: z.string().max(255).nullish(),
    modifierOptionIds: z.array(z.number().int().positive()).nullish(),
  })).min(1),
  mode: z.enum(["dinein", "takeaway"]), outletKey: z.string().trim().min(1).max(120),
  pickupName: z.string().trim().max(255).nullish(),
  table: z.object({ outletKey: z.string(), qrToken: z.string(), tableCode: z.string(), tableLabel: z.string() }).nullish(),
});

async function createOrder(request: Request) {
  authorize(request);
  const input = createOrderInput.parse(await body(request));
  return transaction(async (client) => {
    await knownOutlet(client, input.outletKey);
    let table: { table_code: string; table_label: string } | null = null;
    if (input.mode === "dinein") {
      if (!input.table?.qrToken) throw new HttpError(422, "Dine-in orders require an active QR table.");
      const result = await client.query<{ table_code: string; table_label: string }>(
        "SELECT table_code,table_label FROM qr_tables WHERE outlet_key=$1 AND qr_token=$2 AND is_active=true",
        [input.outletKey, input.table.qrToken],
      );
      table = result.rows[0] ?? null;
      if (!table) throw new HttpError(422, "Dine-in orders require an active QR table.");
    } else if (!(input.pickupName || input.customerName).trim()) {
      throw new HttpError(422, "Takeaway orders require pickupName or customerName.");
    }
    const validated = await validateItems(client, input.outletKey, input.items.map((item) => ({
      type: "product" as const, productId: item.menuItemId, quantity: item.quantity,
      modifierOptionIds: item.modifierOptionIds, notes: item.note,
    })));
    const shift = await activeShift(client, input.outletKey);
    const tableNumber = Number(table?.table_code.match(/\d+/)?.[0] ?? table?.table_label.match(/\d+/)?.[0] ?? 0);
    const order = await client.query<{ id: string }>(
      `INSERT INTO orders(outlet_key,shift_id,order_code,public_token,business_date,customer_name,order_mode,pickup_name,
        restaurant_status,status,table_code,table_label,table_number,channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new','pending',$9,$10,$11,'menu') RETURNING id::text`,
      [input.outletKey, shift?.id ?? null, await uniqueOrderCode(client), opaqueToken("order_"), shift?.business_date ?? null,
        input.customerName, input.mode, input.pickupName ?? null, table?.table_code ?? null, table?.table_label ?? null, tableNumber],
    );
    await insertItems(client, order.rows[0].id, validated.items);
    await client.query(
      `INSERT INTO payments(order_id,amount,status,payment_method,transaction_id,notes)
       VALUES ($1,$2,'pending','adapter',$3,'Created through 1garis menu POS adapter.')`,
      [order.rows[0].id, validated.subtotal * (1 + await outletTaxRate(client, input.outletKey)), `ADAPTER-${order.rows[0].id}-${Date.now().toString(36)}`],
    );
    return Response.json(await orderSummary(client, order.rows[0].id), { status: 201 });
  });
}

async function publicOrder(request: Request, publicToken: string) {
  authorize(request);
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>("SELECT id::text FROM orders WHERE public_token=$1", [publicToken]);
    if (!result.rows[0]) throw new HttpError(404, "Order not found.");
    return Response.json(await orderSummary(client, result.rows[0].id));
  });
}

// Menu digital: situs di layanan website membaca katalog dan mengirim pesanan
// untuk satu outlet. Situs meneruskan IP pelanggan di X-Forwarded-For, jadi
// batas kiriman berlaku per pelanggan, bukan per server situs.
async function outletStorefront(request: Request, outletKey: string) {
  authorize(request);
  return transaction(async (client) => Response.json(await storefront(client, outletKey)));
}

async function createOutletMenuOrder(request: Request, outletKey: string) {
  authorize(request);
  const input = menuOrderInput.parse(await body(request));
  await enforceRateLimit(pool, rateLimitKey("menu-order", request.headers, outletKey), 20, 600);
  return transaction(async (client) => Response.json(await createMenuOrder(client, outletKey, input), { status: 201 }));
}

async function outletCouponCheck(request: Request, outletKey: string) {
  authorize(request);
  const input = couponCheckInput.parse(await body(request));
  // Batas percobaan per pelanggan+outlet supaya kode tidak bisa ditebak beruntun.
  await enforceRateLimit(pool, rateLimitKey("coupon-check", request.headers, outletKey), 20, 600);
  return transaction(async (client) => Response.json(await checkCoupon(client, outletKey, input)));
}

async function outletMenuOrder(request: Request, outletKey: string, publicToken: string) {
  authorize(request);
  return transaction(async (client) => Response.json(await menuOrderDetail(client, outletKey, publicToken)));
}

async function transitionOrder(request: Request, orderId: string) {
  authorize(request);
  const input = z.object({ status: z.enum(["new", "accepted", "preparing", "ready", "completed", "cancelled"]) }).parse(await body(request));
  return transaction(async (client) => {
    await client.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
    const outlet = await client.query<{ outlet_key: string }>("SELECT outlet_key FROM orders WHERE id=$1", [orderId]);
    if (!outlet.rows[0]) throw new HttpError(404, "Order not found.");
    const order = await loadOrder(client, outlet.rows[0].outlet_key, orderId);
    const current = orderStatus(order.restaurant_status);
    if (!canTransitionRestaurantOrderStatus(current, input.status)) throw new HttpError(422, "Invalid restaurant order transition.");
    if (input.status === "completed" && (order.payment_status !== "completed" || order.refunded_at)) {
      throw new HttpError(422, "Order can only be completed after payment is settled.");
    }
    await client.query("UPDATE orders SET restaurant_status=$1,status=$2,updated_at=now() WHERE id=$3", [input.status, legacyStatus(input.status), order.id]);
    return Response.json(await orderSummary(client, order.id));
  });
}

export async function handleMenuPosRequest(request: Request, path: string[]) {
  try {
    const key = path.join("/");
    await enforceRateLimit(pool, rateLimitKey("menu-pos-api", request.headers), 120, 60);
    const outletMenu = key.match(/^outlets\/([^/]+)\/menu$/);
    const outletOrders = key.match(/^outlets\/([^/]+)\/orders$/);
    const outletProfile = key.match(/^outlets\/([^/]+)\/profile$/);
    const qr = key.match(/^qr-tables\/([^/]+)$/);
    const publicMatch = key.match(/^orders\/public\/([^/]+)$/);
    const transition = key.match(/^orders\/(\d+)\/status$/);
    const outletStore = key.match(/^outlets\/([^/]+)\/storefront$/);
    const outletMenuOrders = key.match(/^outlets\/([^/]+)\/menu-orders$/);
    const outletMenuOrderMatch = key.match(/^outlets\/([^/]+)\/menu-orders\/([^/]+)$/);
    const outletCoupon = key.match(/^outlets\/([^/]+)\/coupons\/check$/);
    if (request.method === "POST" && outletCoupon) return await outletCouponCheck(request, decodeURIComponent(outletCoupon[1]));
    if (request.method === "GET" && outletStore) return await outletStorefront(request, decodeURIComponent(outletStore[1]));
    if (request.method === "POST" && outletMenuOrders) return await createOutletMenuOrder(request, decodeURIComponent(outletMenuOrders[1]));
    if (request.method === "GET" && outletMenuOrderMatch) {
      return await outletMenuOrder(request, decodeURIComponent(outletMenuOrderMatch[1]), decodeURIComponent(outletMenuOrderMatch[2]));
    }
    if (request.method === "GET" && outletMenu) return await menu(request, decodeURIComponent(outletMenu[1]));
    if (request.method === "GET" && outletOrders) return await listOrders(request, decodeURIComponent(outletOrders[1]));
    if (request.method === "PATCH" && outletProfile) return await syncProfile(request, decodeURIComponent(outletProfile[1]));
    if (request.method === "GET" && qr) return await qrTable(request, decodeURIComponent(qr[1]));
    if (request.method === "POST" && key === "orders") return await createOrder(request);
    if (request.method === "GET" && publicMatch) return await publicOrder(request, decodeURIComponent(publicMatch[1]));
    if (request.method === "POST" && transition) return await transitionOrder(request, transition[1]);
    return Response.json({ message: "Not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}
