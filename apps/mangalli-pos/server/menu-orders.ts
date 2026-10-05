import "server-only";

import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import { HttpError } from "./http";
import {
  activeShift,
  insertItems,
  loadCatalog,
  loadOrderItems,
  opaqueToken,
  outletTaxRate,
  refreshShiftTotals,
  uniqueOrderCode,
  validateItems,
  validateTable,
} from "./pos";
import { bestPromotion, couponBlocked, couponProblem, isPromotionLive, normalizeCoupon, orderTotals, type PromoLine } from "./promotion-rules";
import { openingStatus, type OpeningHour } from "./opening-hours";
import { assertStock } from "./stock";
import { loadPromotions } from "./promotions";
import { dynamicQris } from "./qris";

// Pesanan dari menu digital (situs di layanan website). Aturannya satu:
// pesanan menunggu pembayaran dan baru masuk dapur setelah lunas. Pesanan yang
// tidak dibayar dalam PAYMENT_WINDOW_MINUTES dibatalkan otomatis.

export const PAYMENT_WINDOW_MINUTES = 30;
export const menuPaymentMethods = ["cashier", "qris", "midtrans"] as const;
export type MenuPaymentMethod = (typeof menuPaymentMethods)[number];

type OutletRow = {
  outlet_key: string; name: string; public_name: string | null; tagline: string | null; address: string | null;
  phone: string | null; logo_image_url: string | null; banner_image_url: string | null; opening_hours: unknown;
  is_active: boolean; menu_payment_methods: string[] | null; qris_payload: string | null;
  tax_rate: string; order_modes: Array<"dinein" | "takeaway">; timezone: string;
};

// Kunci server Midtrans per outlet, karena uang setiap brand masuk ke merchant
// brand itu sendiri. Disimpan di env server (MIDTRANS_SERVER_KEYS_JSON), bukan
// di database, dan tidak pernah dikirim ke browser.
export function midtransServerKey(outletKey: string): string | null {
  try {
    const keys = JSON.parse(process.env.MIDTRANS_SERVER_KEYS_JSON || "{}") as Record<string, unknown>;
    const key = keys[outletKey];
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export function enabledPaymentMethods(outlet: Pick<OutletRow, "outlet_key" | "menu_payment_methods" | "qris_payload">): MenuPaymentMethod[] {
  const chosen = new Set(outlet.menu_payment_methods ?? ["cashier"]);
  return menuPaymentMethods.filter((method) => {
    if (!chosen.has(method)) return false;
    if (method === "qris") return Boolean(outlet.qris_payload);
    if (method === "midtrans") return Boolean(midtransServerKey(outlet.outlet_key));
    return true;
  });
}

async function activeOutlet(client: PoolClient, outletKey: string): Promise<OutletRow> {
  const result = await client.query<OutletRow>(
    `SELECT outlet_key,name,public_name,tagline,address,phone,logo_image_url,banner_image_url,opening_hours,is_active,
      menu_payment_methods,qris_payload,tax_rate::text,order_modes,timezone FROM outlets WHERE outlet_key=$1`,
    [outletKey],
  );
  const outlet = result.rows[0];
  if (!outlet) throw new HttpError(404, "Outlet not found.");
  return outlet;
}

export async function expireUnpaidOrders(client: PoolClient, outletKey: string) {
  const expired = await client.query<{ id: string; shift_id: string | null }>(
    `UPDATE orders SET restaurant_status='cancelled',status='cancelled',
       void_reason='Pembayaran tidak diterima sebelum batas waktu.',voided_at=now(),updated_at=now()
     WHERE outlet_key=$1 AND restaurant_status='pending_payment' AND payment_due_at < now()
     RETURNING id::text,shift_id::text`,
    [outletKey],
  );
  if (!expired.rowCount) return;
  await client.query("UPDATE payments SET status='expired',updated_at=now() WHERE status='pending' AND order_id = ANY($1::bigint[])", [expired.rows.map((row) => row.id)]);
  for (const shiftId of new Set(expired.rows.map((row) => row.shift_id))) await refreshShiftTotals(client, shiftId);
}

// Situs menu berjalan di domain brand, jadi gambar yang disimpan sebagai path
// aplikasi Mangalli (misalnya /images/brands/...) dikirim sebagai URL penuh.
export function publicAssetUrl(value: string | null) {
  if (!value || !value.startsWith("/")) return value;
  return new URL(value, process.env.MENU_POS_PUBLIC_ORIGIN || "https://app.mangalli.web.id").toString();
}

export async function storefront(client: PoolClient, outletKey: string) {
  const outlet = await activeOutlet(client, outletKey);
  const catalog = await loadCatalog(client, outletKey);
  // Promo menu digital yang aktif; situs menghitung pratinjau dengan aturan
  // yang sama, server menghitung total resmi saat pesanan dibuat.
  // Kupon tidak pernah dikirim ke situs: kodenya hanya diketahui dari konten promosi.
  const promotions = (await loadPromotions(client, outletKey, { activeOnly: true })).filter((promotion) => promotion.channels.includes("menu") && !promotion.code);
  return {
    outlet: {
      outletKey: outlet.outlet_key, name: outlet.public_name || outlet.name, tagline: outlet.tagline, address: outlet.address,
      phone: outlet.phone, logoImageUrl: publicAssetUrl(outlet.logo_image_url), bannerImageUrl: publicAssetUrl(outlet.banner_image_url),
      openingHours: Array.isArray(outlet.opening_hours) ? outlet.opening_hours : [], isActive: outlet.is_active,
    },
    paymentMethods: enabledPaymentMethods(outlet),
    paymentWindowMinutes: PAYMENT_WINDOW_MINUTES,
    taxRate: Number(outlet.tax_rate),
    timezone: outlet.timezone,
    promotions: promotions.map((promotion) => ({ ...promotion, liveNow: isPromotionLive(promotion, new Date(), outlet.timezone) })),
    orderModes: outlet.order_modes,
    // Meja aktif (nomor + nama, tanpa token QR) supaya situs menolak nomor yang
    // tidak ada sebelum checkout; server tetap memeriksa lagi saat pesanan dibuat.
    tables: (await client.query<{ table_code: string; table_label: string }>(
      "SELECT table_code, table_label FROM qr_tables WHERE outlet_key=$1 AND is_active=true ORDER BY sort_order, table_code", [outletKey],
    )).rows.flatMap((table) => {
      const number = Number(table.table_code.match(/\d+/)?.[0] ?? table.table_label.match(/\d+/)?.[0]);
      return Number.isInteger(number) && number > 0 ? [{ number, label: table.table_label }] : [];
    }),
    categories: catalog.categories,
    // id opsi modifier dari Postgres (bigint) datang sebagai teks; situs menu
    // mengirimnya kembali sebagai angka.
    products: catalog.products.map((product) => ({
      ...product,
      // Stok habis tampil sebagai "habis" di menu digital.
      availability: product.stock !== null && product.stock <= 0 ? "unavailable" : product.availability,
      photoUrl: publicAssetUrl(product.photoUrl),
      modifierGroups: product.modifierGroups.map((group) => ({
        ...group,
        options: group.options.map((option: { id: string | number; name: string; priceDelta: number; sortOrder: number }) => ({ ...option, id: Number(option.id) })),
      })),
    })),
  };
}

export const menuOrderInput = z.object({
  mode: z.enum(["dinein", "takeaway"]),
  tableNumber: z.number().int().min(1).max(9999).nullish(),
  qrToken: z.string().trim().max(255).nullish(),
  customerName: z.string().trim().min(1).max(255),
  customerPhone: z.string().trim().max(40).nullish(),
  pickupName: z.string().trim().max(255).nullish(),
  notes: z.string().trim().max(500).nullish(),
  couponCode: z.string().trim().max(40).nullish(),
  paymentMethod: z.enum(menuPaymentMethods),
  returnUrl: z.url().max(2048).nullish(),
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(1).max(99),
    modifierOptionIds: z.array(z.number().int().positive()).max(50).nullish(),
    notes: z.string().trim().max(255).nullish(),
  })).min(1).max(100),
});

async function resolveTable(client: PoolClient, outletKey: string, input: z.infer<typeof menuOrderInput>) {
  if (input.mode === "takeaway") return null;
  if (input.qrToken) {
    const result = await client.query<{ table_code: string; table_label: string }>(
      "SELECT table_code,table_label FROM qr_tables WHERE outlet_key=$1 AND qr_token=$2 AND is_active=true",
      [outletKey, input.qrToken],
    );
    const table = result.rows[0];
    if (!table) throw new HttpError(422, "This table QR code is inactive or not found.");
    return table;
  }
  if (!input.tableNumber) throw new HttpError(422, "Table number is required for dine in.");
  return validateTable(client, outletKey, input.tableNumber);
}

// Kode unik kecil membuat nominal QRIS setiap pesanan berbeda, supaya kasir
// mudah mencocokkan dana masuk dengan pesanan.
async function uniqueQrisAmount(client: PoolClient, outletKey: string, baseAmount: number) {
  const pending = await client.query<{ amount: string }>(
    `SELECT p.amount::text FROM payments p JOIN orders o ON o.id=p.order_id
      WHERE o.outlet_key=$1 AND o.restaurant_status='pending_payment' AND p.payment_method='qris'`,
    [outletKey],
  );
  const taken = new Set(pending.rows.map((row) => Number(row.amount)));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = randomInt(1, 300);
    if (!taken.has(baseAmount + code)) return { amount: baseAmount + code, uniqueCode: code };
  }
  throw new HttpError(503, "Too many QRIS orders are awaiting payment. Please try again shortly.");
}

async function midtransCheckout(input: {
  outletKey: string; orderId: string; amount: number; taxRate: number; customerName: string; customerPhone?: string | null;
  items: Awaited<ReturnType<typeof validateItems>>["items"]; returnUrl?: string | null; discount: number; discountLabel: string | null;
}) {
  const serverKey = midtransServerKey(input.outletKey);
  if (!serverKey) throw new HttpError(422, "Online payment is not active for this outlet yet.");
  const transactionId = `1GARISPOS-${input.orderId}-${Date.now()}`;
  const endpoint = process.env.MIDTRANS_IS_PRODUCTION === "true"
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";
  const itemDetails = input.items.map((item, index) => ({
    id: (item.productId || `item-${index}`).slice(0, 50), price: Math.round(item.unitPrice), quantity: item.quantity,
    name: [item.itemName, item.modifierSummary].filter(Boolean).join(" - ").slice(0, 50),
  }));
  // Midtrans mewajibkan jumlah rincian sama dengan total: diskon jadi baris negatif.
  if (input.discount > 0) itemDetails.push({ id: "discount", price: -Math.round(input.discount), quantity: 1, name: (input.discountLabel ?? "Discount").slice(0, 50) });
  const itemTotal = itemDetails.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      transaction_details: { order_id: transactionId, gross_amount: input.amount },
      customer_details: { first_name: input.customerName, phone: input.customerPhone || undefined },
      item_details: [...itemDetails, ...(input.amount > itemTotal ? [{ id: "tax", price: input.amount - itemTotal, quantity: 1, name: `Tax ${Math.round(input.taxRate * 100)}%` }] : [])],
      expiry: { unit: "minutes", duration: PAYMENT_WINDOW_MINUTES },
      ...(input.returnUrl ? { callbacks: { finish: input.returnUrl } } : {}),
    }),
  });
  if (!response.ok) throw new HttpError(502, "Payment gateway is unavailable.");
  const payment = z.object({ redirect_url: z.url() }).parse(await response.json());
  return { transactionId, checkoutUrl: payment.redirect_url };
}

async function promoLines(client: PoolClient, outletKey: string, items: Array<{ productId: string | null; unitPrice: number; quantity: number }>): Promise<PromoLine[]> {
  const categories = await client.query<{ id: string; category_id: string }>(
    "SELECT id, category_id::text FROM products WHERE outlet_key=$1 AND id = ANY($2::text[])",
    [outletKey, items.flatMap((item) => (item.productId ? [item.productId] : []))]);
  const categoryOf = new Map(categories.rows.map((row) => [row.id, row.category_id]));
  return items.map((item) => ({ productId: item.productId, categoryId: item.productId ? categoryOf.get(item.productId) ?? null : null, lineTotal: item.unitPrice * item.quantity }));
}

export const couponCheckInput = z.object({
  code: z.string().trim().min(1).max(40),
});

// Kupon yang dimasukkan pelanggan (atau dari tautan ?coupon=) diperiksa tanpa
// keranjang; situs menerima aturan kupon itu saja untuk menghitung potongan
// pada keranjang yang berubah. Server menghitung ulang saat pesanan dibuat.
export async function checkCoupon(client: PoolClient, outletKey: string, input: z.infer<typeof couponCheckInput>) {
  const outlet = await activeOutlet(client, outletKey);
  const code = normalizeCoupon(input.code);
  const coupon = (await loadPromotions(client, outletKey, { activeOnly: true })).find((promotion) => promotion.code === code);
  const problem = couponBlocked(coupon, "menu", new Date(), outlet.timezone);
  if (problem || !coupon) throw new HttpError(422, problem ?? "This coupon code isn't valid.");
  return { ...coupon, used: 0, maxUses: null };
}

export async function createMenuOrder(client: PoolClient, outletKey: string, input: z.infer<typeof menuOrderInput>) {
  const outlet = await activeOutlet(client, outletKey);
  if (!outlet.is_active) throw new HttpError(422, "This outlet is not taking orders right now.");
  if (!enabledPaymentMethods(outlet).includes(input.paymentMethod)) throw new HttpError(422, "This payment method is not available.");
  if (!outlet.order_modes.includes(input.mode)) throw new HttpError(422, input.mode === "dinein" ? "This outlet only takes takeaway orders." : "This outlet only takes dine-in orders.");
  // Jam buka dari dashboard ditegakkan di server, bukan hanya ditampilkan situs.
  const opening = openingStatus(Array.isArray(outlet.opening_hours) ? outlet.opening_hours as OpeningHour[] : [], new Date(), outlet.timezone);
  if (!opening.open) {
    const next = opening.label.replace(/^Closed now · o/, "O");
    throw new HttpError(422, `${outlet.public_name || outlet.name} is closed right now.${next.startsWith("Opens") ? ` ${next}.` : ""}`);
  }
  await expireUnpaidOrders(client, outletKey);

  const table = await resolveTable(client, outletKey, input);
  const validated = await validateItems(client, outletKey, input.items.map((item) => ({ type: "product" as const, ...item })));
  await assertStock(client, outletKey, validated.items);
  const shift = await activeShift(client, outletKey);
  const tableNumber = Number(table?.table_code.match(/\d+/)?.[0] ?? table?.table_label.match(/\d+/)?.[0] ?? input.tableNumber ?? 0);
  const publicToken = opaqueToken("order_");
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders(outlet_key,shift_id,order_code,public_token,business_date,customer_name,customer_phone,order_mode,
       table_number,table_code,table_label,pickup_name,notes,status,restaurant_status,payment_due_at,channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending','pending_payment',now()+make_interval(mins => $14::int),'menu')
     RETURNING id::text`,
    [outletKey, shift?.id ?? null, await uniqueOrderCode(client), publicToken, shift?.business_date ?? null,
      input.customerName, input.customerPhone || null, input.mode, tableNumber, table?.table_code ?? null, table?.table_label ?? null,
      input.mode === "takeaway" ? input.pickupName || input.customerName : null, input.notes || null, PAYMENT_WINDOW_MINUTES],
  );
  const orderId = order.rows[0].id;
  await insertItems(client, orderId, validated.items);

  const taxRate = Number(outlet.tax_rate);
  // Promo terbaik untuk menu digital dihitung server dari harga katalog; kupon
  // yang dimasukkan pelanggan diperiksa ulang di sini (tanggal, sisa pemakaian).
  const lines = await promoLines(client, outletKey, validated.items);
  const promotions = await loadPromotions(client, outletKey, { activeOnly: true });
  const coupon = input.couponCode ? normalizeCoupon(input.couponCode) : null;
  if (input.couponCode) {
    const problem = couponProblem(promotions.find((promotion) => promotion.code === coupon), lines, "menu", new Date(), outlet.timezone);
    if (problem) throw new HttpError(422, problem);
  }
  const promo = bestPromotion(promotions, lines, "menu", new Date(), outlet.timezone, coupon);
  const discount = promo?.discount ?? 0;
  if (promo) {
    const label = promo.promotion.code ? `${promo.promotion.name} (${promo.promotion.code})` : promo.promotion.name;
    await client.query("UPDATE orders SET discount_amount=$1, discount_label=$2, promotion_id=$3 WHERE id=$4", [discount, label, promo.promotion.id, orderId]);
  }
  const baseAmount = orderTotals(validated.subtotal, discount, taxRate).total;
  let amount = baseAmount;
  let transactionId = `MENU-${input.paymentMethod.toUpperCase()}-${orderId}-${Date.now().toString(36)}`;
  let checkoutUrl: string | null = null;
  if (input.paymentMethod === "qris") amount = (await uniqueQrisAmount(client, outletKey, baseAmount)).amount;
  if (input.paymentMethod === "midtrans") {
    ({ transactionId, checkoutUrl } = await midtransCheckout({
      outletKey, orderId, amount, taxRate, customerName: input.customerName, customerPhone: input.customerPhone,
      items: validated.items, returnUrl: input.returnUrl?.replace("{token}", encodeURIComponent(publicToken)),
      discount, discountLabel: promo ? (promo.promotion.code ? `${promo.promotion.name} (${promo.promotion.code})` : promo.promotion.name) : null,
    }));
  }
  await client.query(
    `INSERT INTO payments(order_id,amount,status,payment_method,transaction_id,checkout_url,notes)
     VALUES ($1,$2,'pending',$3,$4,$5,'Menu digital')`,
    [orderId, amount, input.paymentMethod, transactionId, checkoutUrl],
  );
  await refreshShiftTotals(client, shift?.id ?? null);
  return menuOrderDetail(client, outletKey, publicToken);
}

export async function menuOrderDetail(client: PoolClient, outletKey: string, publicToken: string) {
  await expireUnpaidOrders(client, outletKey);
  const result = await client.query<{
    id: string; order_code: string | null; public_token: string; restaurant_status: string; order_mode: "dinein" | "takeaway";
    table_label: string | null; table_number: number; pickup_name: string | null; customer_name: string | null; notes: string | null;
    created_at: Date; payment_due_at: Date | null; void_reason: string | null; discount_amount: string; discount_label: string | null;
    payment_status: string | null; payment_method: string | null; amount: string | null; checkout_url: string | null;
  }>(
    `SELECT o.id::text,o.order_code,o.public_token,o.restaurant_status,o.order_mode,o.table_label,o.table_number,o.pickup_name,
       o.customer_name,o.notes,o.created_at,o.payment_due_at,o.void_reason,o.discount_amount::text,o.discount_label,
       p.status AS payment_status,p.payment_method,p.amount::text,p.checkout_url
     FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.outlet_key=$1 AND o.public_token=$2`,
    [outletKey, publicToken],
  );
  const order = result.rows[0];
  if (!order) throw new HttpError(404, "Order not found.");
  const items = await loadOrderItems(client, order.id);
  const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  const discount = Number(order.discount_amount);
  const { tax, total: expected } = orderTotals(subtotal, discount, await outletTaxRate(client, outletKey));
  const amount = Number(order.amount ?? expected);
  const pending = order.restaurant_status === "pending_payment" && order.payment_status === "pending";
  let qrisPayload: string | null = null;
  if (pending && order.payment_method === "qris") {
    const outlet = await client.query<{ qris_payload: string | null }>("SELECT qris_payload FROM outlets WHERE outlet_key=$1", [outletKey]);
    qrisPayload = outlet.rows[0]?.qris_payload ? dynamicQris(outlet.rows[0].qris_payload, Math.round(amount)) : null;
  }
  return {
    code: order.order_code || `1GK-${String(Number(order.id) % 10_000).padStart(4, "0")}`,
    publicToken: order.public_token,
    status: order.restaurant_status,
    mode: order.order_mode,
    tableLabel: order.table_label,
    tableNumber: order.table_number || null,
    pickupName: order.pickup_name,
    customerName: order.customer_name,
    notes: order.notes,
    createdAt: order.created_at.toISOString(),
    cancelReason: order.restaurant_status === "cancelled" ? order.void_reason : null,
    items: items.map((item) => ({
      name: item.item_name || item.product_name || "Menu", quantity: item.quantity, unitPrice: Number(item.unit_price),
      modifierSummary: item.modifier_summary, notes: item.notes,
    })),
    subtotal,
    discount,
    discountLabel: order.discount_label,
    tax,
    total: amount,
    uniqueCode: order.payment_method === "qris" ? Math.max(0, Math.round(amount - expected)) : 0,
    payment: {
      method: order.payment_method,
      status: order.payment_status,
      dueAt: pending ? order.payment_due_at?.toISOString() ?? null : null,
      qrisPayload,
      checkoutUrl: pending && order.payment_method === "midtrans" ? order.checkout_url : null,
    },
  };
}

// Kasir menerima pembayaran pesanan menu digital: pesanan pindah ke dapur.
export async function markMenuOrderPaid(client: PoolClient, input: { outletKey: string; orderId: string; method: "cash" | "qris"; actorId: string }) {
  const result = await client.query<{ restaurant_status: string; shift_id: string | null }>(
    "SELECT restaurant_status,shift_id::text FROM orders WHERE id=$1 AND outlet_key=$2 FOR UPDATE",
    [input.orderId, input.outletKey],
  );
  const order = result.rows[0];
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.restaurant_status !== "pending_payment") throw new HttpError(422, "This order is no longer awaiting payment.");
  const shift = order.shift_id ? { id: order.shift_id } : await activeShift(client, input.outletKey);
  await client.query(
    `UPDATE payments SET status='completed',payment_method=$1,paid_at=now(),updated_at=now() WHERE order_id=$2 AND status='pending'`,
    [input.method, input.orderId],
  );
  await client.query(
    `UPDATE orders SET restaurant_status='new',status='pending',shift_id=coalesce(shift_id,$2),payment_due_at=NULL,updated_at=now() WHERE id=$1`,
    [input.orderId, shift?.id ?? null],
  );
  await client.query(
    `INSERT INTO pos_audit_logs(outlet_key,actor_id,action,auditable_type,auditable_id,metadata)
     VALUES ($1,$2,'order.menu_payment_received','order',$3,$4::jsonb)`,
    [input.outletKey, input.actorId, input.orderId, JSON.stringify({ method: input.method })],
  );
  await refreshShiftTotals(client, shift?.id ?? null);
}

export async function cancelUnpaidMenuOrder(client: PoolClient, input: { outletKey: string; orderId: string; actorId: string }) {
  const result = await client.query<{ shift_id: string | null }>(
    `UPDATE orders SET restaurant_status='cancelled',status='cancelled',void_reason='Dibatalkan kasir sebelum dibayar.',
       voided_at=now(),voided_by=$3,updated_at=now()
     WHERE id=$1 AND outlet_key=$2 AND restaurant_status='pending_payment' RETURNING shift_id::text`,
    [input.orderId, input.outletKey, input.actorId],
  );
  if (!result.rowCount) throw new HttpError(422, "This order is no longer awaiting payment.");
  await client.query("UPDATE payments SET status='cancelled',updated_at=now() WHERE order_id=$1 AND status='pending'", [input.orderId]);
  await client.query(
    `INSERT INTO pos_audit_logs(outlet_key,actor_id,action,auditable_type,auditable_id,metadata)
     VALUES ($1,$2,'order.menu_unpaid_cancelled','order',$3,'{}'::jsonb)`,
    [input.outletKey, input.actorId, input.orderId],
  );
  await refreshShiftTotals(client, result.rows[0].shift_id);
}
