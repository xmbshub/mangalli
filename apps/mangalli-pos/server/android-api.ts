import "server-only";

import { androidAppUpdate, recordAppVersion } from "./app-releases";
import { verifyPin } from "./pin";
import type { PoolClient } from "pg";
import { z } from "zod";

import { publicAssetUrl } from "./menu-orders";
import {
  authenticateDevice,
  authenticateStaffSession,
  authorizeSetupToken,
  devicePayload,
  issueDevice,
  issueStaffSession,
  optionalStaffSession,
  permissionsForRole,
  staffSessionPayload,
  verifyStaffCredentials,
} from "./auth";
import { config } from "./config";
import { pool, transaction } from "./db";
import { HttpError, jsonError } from "./http";
import { androidProblemReport } from "./support";
import { loadPromotions } from "./promotions";
import { androidMenuOrders, androidSyncV2 } from "./android-offline";
import { enforceRateLimit, rateLimitKey } from "./rate-limit";
import {
  activeShift,
  androidBillPayload,
  androidOrderPayload,
  canTransition,
  catalogRevision,
  insertItems,
  legacyStatus,
  loadCatalog,
  loadOrder,
  outletTaxRate,
  normalizeStatus,
  opaqueToken,
  restaurantStatuses,
  refreshShiftTotals,
  uniqueOrderCode,
  validateItems,
  validateTable,
  type Device,
  type StaffSession,
  type SyncItemInput,
} from "./pos";

const deviceInput = z.object({
  outletKey: z.string().trim().min(1).max(120),
  deviceKey: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).nullish(),
});
const credentialsInput = z.object({ email: z.email(), password: z.string().min(1) });
const itemInput = z.object({
  type: z.enum(["product", "custom_amount"]).optional(),
  productId: z.string().nullish(),
  name: z.string().trim().max(80).nullish(),
  unitPrice: z.number().min(1).max(config.customAmountMax).nullish(),
  quantity: z.number().int().min(1).max(99),
  modifierOptionIds: z.array(z.number().int().positive()).nullish(),
  notes: z.string().trim().max(255).nullish(),
});
const commonOrderInput = z.object({
  customerName: z.string().trim().max(255).nullish(),
  orderMode: z.enum(["dinein", "takeaway"]),
  tableNumber: z.number().int().positive().nullish(),
  pickupName: z.string().trim().max(255).nullish(),
  notes: z.string().trim().max(500).nullish(),
  items: z.array(itemInput).min(1).max(100),
}).superRefine((value, context) => {
  if (value.orderMode === "dinein" && !value.tableNumber) {
    context.addIssue({ code: "custom", path: ["tableNumber"], message: "Table number is required for dine-in orders." });
  }
});
const paidOrderInput = commonOrderInput.safeExtend({
  customerName: z.string().trim().min(1).max(255),
  customerPhone: z.string().trim().max(40).nullish(),
  customerEmail: z.email().nullish(),
  paymentMethod: z.enum(["cash", "digital"]),
  paymentNotes: z.string().trim().max(255).nullish(),
});
const billInput = commonOrderInput.safeExtend({
  billName: z.string().trim().max(255).nullish(),
  orderId: z.number().int().positive().nullish(),
});
const syncEvent = z.object({
  type: z.enum(["cashier_order_created", "cashier_bill_saved", "cashier_bill_updated"]),
  localUuid: z.string().min(1).max(80),
  idempotencyKey: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()),
});

async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

function isoNow() {
  return new Date().toISOString();
}

async function registerDevice(request: Request) {
  authorizeSetupToken(request);
  const input = deviceInput.parse(await body(request));
  const result = await transaction((client) => issueDevice(client, input));
  return Response.json({ device: devicePayload(result.device), deviceToken: result.token }, { status: 201 });
}

async function login(request: Request) {
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    const input = credentialsInput.parse(await body(request));
    let user;
    try {
      user = await verifyStaffCredentials(client, { ...input, outletKey: device.outlet_key });
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) {
        throw new HttpError(422, error.message, { email: ["Invalid email or password."] });
      }
      throw error;
    }
    const result = await issueStaffSession(client, device, user);
    return Response.json({ staffSession: staffSessionPayload(result.session), staffToken: result.token });
  });
}

async function deviceLogin(request: Request) {
  const input = deviceInput.extend(credentialsInput.shape).parse(await body(request));
  return transaction(async (client) => {
    const user = await verifyStaffCredentials(client, { ...input, outletKey: input.outletKey });
    const issuedDevice = await issueDevice(client, input);
    const issuedStaff = await issueStaffSession(client, issuedDevice.device, user);
    return Response.json({
      device: devicePayload(issuedDevice.device), deviceToken: issuedDevice.token,
      staffSession: staffSessionPayload(issuedStaff.session), staffToken: issuedStaff.token,
    });
  });
}

async function bootstrap(request: Request) {
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    const staff = await optionalStaffSession(request, device, client);
    await recordAppVersion(device.id, request.headers.get("x-mangalli-app-version"), client);
    const outletResult = await client.query<{
      outlet_key: string; name: string; public_name: string | null; tagline: string | null;
      address: string | null; phone: string | null; logo_image_url: string | null;
      banner_image_url: string | null; opening_hours: unknown; android_sync_times: string[]; menu_url: string | null; tax_rate: string; timezone: string; qris_payload: string | null;
    }>(`SELECT outlet_key, name, public_name, tagline, address, phone, logo_image_url, banner_image_url, opening_hours,
          android_sync_times, menu_url, tax_rate::text, timezone, qris_payload FROM outlets WHERE outlet_key = $1 AND is_active = true`, [device.outlet_key]);
    const outlet = outletResult.rows[0];
    if (!outlet) throw new HttpError(404, "Outlet not found.");
    const shift = await activeShift(client, device.outlet_key);
    const catalog = await loadCatalog(client, device.outlet_key);
    await client.query("UPDATE android_pos_devices SET last_seen_at = now(), updated_at = now() WHERE id = $1", [device.id]);
    return Response.json({
      device: devicePayload({ ...device, last_seen_at: new Date() }),
      outlet: {
        outletKey: outlet.outlet_key, name: outlet.name, publicName: outlet.public_name, tagline: outlet.tagline,
        address: outlet.address, phone: outlet.phone, // Tanpa logo outlet, struk memakai nama outlet (bukan logo brand lain).
        logoImageUrl: publicAssetUrl(outlet.logo_image_url),
        bannerImageUrl: outlet.banner_image_url, openingHours: outlet.opening_hours,
        menuUrl: outlet.menu_url,
        // QRIS statis toko (yang juga tercetak di meja kasir); tablet mencetak
        // versi dinamis berisi total di bill dan slip QRIS.
        qrisPayload: outlet.qris_payload,
      },
      // Jam sinkron otomatis tablet (HH:MM waktu outlet), diatur owner di dashboard.
      syncTimes: outlet.android_sync_times,
      // Tarif pajak outlet; tablet memakainya untuk total dan struk.
      taxRate: Number(outlet.tax_rate),
      activeShift: shift ? {
        id: Number(shift.id), businessDate: shift.business_date, openedAt: shift.opened_at.toISOString(),
        openingCash: Number(shift.opening_cash), status: shift.status,
      } : null,
      staffSession: staff ? staffSessionPayload(staff) : null,
      permissions: staff ? permissionsForRole(staff.pos_role) : [],
      // Foto disimpan sebagai path relatif; tablet butuh URL penuh seperti menu digital.
      ...catalog,
      products: catalog.products.map((product) => ({ ...product, photoUrl: publicAssetUrl(product.photoUrl) })),
      limits: { customAmountMax: config.customAmountMax },
      // Promo untuk tablet: jadwal dicek di tablet dengan jam outlet, jadi tetap jalan offline.
      timezone: outlet.timezone,
      // Tablet mengenal kategori lewat nama, jadi cakupan kategori dikirim sebagai nama.
      promotions: (await loadPromotions(client, device.outlet_key, { activeOnly: true }))
        .filter((promotion) => promotion.channels.includes("tablet"))
        .map((promotion) => ({ ...promotion, categoryNames: promotion.categoryIds.flatMap((id) => catalog.categories.filter((category) => String(category.id) === id).map((category) => category.name)) })),
      // PIN persetujuan manager/owner (hash, bukan PIN) untuk void/refund/diskon offline.
      approvers: (await client.query<{ id: string; name: string; pos_role: string; approval_pin_hash: string }>(
        `SELECT u.id::text, u.name, m.pos_role, u.approval_pin_hash FROM users u JOIN outlet_members m ON m.user_id = u.id AND m.outlet_key = $1
          WHERE u.is_active = true AND m.pos_role = ANY($2::text[]) AND u.approval_pin_hash LIKE 'pbkdf2-sha256$%'`, [device.outlet_key, ["owner", "manager"]],
      )).rows.map((row) => ({ userId: Number(row.id), name: row.name, role: row.pos_role, pinHash: row.approval_pin_hash })),
      catalogRevision: await catalogRevision(client, device.outlet_key), serverTime: isoNow(),
    });
  });
}

async function orders(request: Request) {
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    await authenticateStaffSession(request, device, client);
    const result = await client.query<{ id: string }>(
      `SELECT o.id::text FROM orders o LEFT JOIN payments p ON p.order_id = o.id
        WHERE o.outlet_key = $1
          AND o.restaurant_status = ANY($2::text[])
          AND (p.id IS NULL OR p.transaction_id NOT LIKE '1GARISPOS-%' OR p.status = 'completed')
        ORDER BY o.created_at DESC LIMIT 80`,
      [device.outlet_key, restaurantStatuses],
    );
    const payload = [];
    for (const row of result.rows) payload.push(await androidOrderPayload(client, await loadOrder(client, device.outlet_key, row.id)));
    return Response.json({ orders: payload, serverTime: isoNow() });
  });
}

async function requireCancellationApproval(client: PoolClient, outletKey: string, input: { approval_pin?: string; approval_reason?: string }) {
  if (!input.approval_pin || !input.approval_reason?.trim()) {
    throw new HttpError(422, "The given data was invalid.", { approval_pin: ["Manager approval PIN and reason are required."] });
  }
  const managers = await client.query<{ approval_pin_hash: string }>(
    `SELECT u.approval_pin_hash FROM users u JOIN outlet_members m ON m.user_id = u.id AND m.outlet_key = $1
      WHERE u.is_active = true AND m.pos_role = ANY($2::text[]) AND u.approval_pin_hash IS NOT NULL`,
    [outletKey, ["owner", "manager"]],
  );
  const approved = (await Promise.all(managers.rows.map((row) => verifyPin(input.approval_pin!, row.approval_pin_hash)))).some(Boolean);
  if (!approved) throw new HttpError(422, "The given data was invalid.", { approval_pin: ["The approval PIN is invalid."] });
}

async function updateStatus(request: Request, orderId: string) {
  const input = z.object({
    status: z.enum(restaurantStatuses), approval_pin: z.string().max(32).optional(), approval_reason: z.string().max(500).optional(),
  }).parse(await body(request));
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    const staff = await authenticateStaffSession(request, device, client);
    const order = await loadOrder(client, device.outlet_key, orderId);
    if (!canTransition(order.restaurant_status, input.status)) {
      throw new HttpError(422, "The given data was invalid.", { status: ["Invalid order status transition."] });
    }
    const current = normalizeStatus(order.restaurant_status);
    if (input.status === "cancelled" && current !== "new") await requireCancellationApproval(client, device.outlet_key, input);
    if (input.status === "completed" && (order.payment_status !== "completed" || order.refunded_at)) {
      throw new HttpError(422, "The given data was invalid.", { status: ["An order can only be completed after payment is settled."] });
    }
    await client.query("UPDATE orders SET restaurant_status = $1, status = $2, updated_at = now() WHERE id = $3", [input.status, legacyStatus(input.status), order.id]);
    await client.query(
      `INSERT INTO pos_audit_logs(outlet_key, actor_id, action, auditable_type, auditable_id, reason, metadata)
       VALUES ($1,$2,'order.status_changed','order',$3,$4,$5::jsonb)`,
      [device.outlet_key, staff.user_id, order.id, input.approval_reason ?? null, JSON.stringify({ from: current, to: input.status })],
    );
    return Response.json({ message: "Order status updated.", order: await androidOrderPayload(client, await loadOrder(client, device.outlet_key, order.id)) });
  });
}

async function settle(request: Request, orderId: string) {
  const input = z.object({
    paymentMethod: z.enum(["cash", "digital"]), paymentNotes: z.string().trim().max(255).nullish(), tenderedAmount: z.number().min(0).nullish(),
  }).parse(await body(request));
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    await authenticateStaffSession(request, device, client);
    await client.query("SELECT id FROM orders WHERE id = $1 AND outlet_key = $2 FOR UPDATE", [orderId, device.outlet_key]);
    const order = await loadOrder(client, device.outlet_key, orderId);
    if (normalizeStatus(order.restaurant_status) !== "ready") {
      throw new HttpError(422, "The given data was invalid.", { paymentMethod: ["Tracking payment is only available for delivered orders."] });
    }
    if (order.payment_status !== "pending" || order.refunded_at) {
      throw new HttpError(422, "The given data was invalid.", { paymentMethod: ["The order is already paid or has no pending payment."] });
    }
    const amount = Number(order.payment_amount ?? 0);
    if (input.paymentMethod === "cash" && Number(input.tenderedAmount ?? 0) < amount) {
      throw new HttpError(422, "The given data was invalid.", { tenderedAmount: ["Cash received is less than the order total."] });
    }
    if (input.paymentMethod === "digital" && !input.paymentNotes) {
      throw new HttpError(422, "The given data was invalid.", { paymentNotes: ["A non-cash payment reference is required."] });
    }
    await client.query(
      `UPDATE payments SET payment_method = $1, notes = $2, paid_at = now(), status = 'completed',
        transaction_id = $3, updated_at = now() WHERE order_id = $4`,
      [input.paymentMethod, input.paymentNotes ?? null, `ANDROID-SETTLE-${input.paymentMethod.toUpperCase()}-${order.id}-${Date.now()}`, order.id],
    );
    await client.query("UPDATE orders SET restaurant_status = 'completed', status = 'completed', updated_at = now() WHERE id = $1", [order.id]);
    const shift = await client.query<{ shift_id: string | null }>("SELECT shift_id::text FROM orders WHERE id=$1", [order.id]);
    await refreshShiftTotals(client, shift.rows[0]?.shift_id ?? null);
    return Response.json({
      message: "Payment received and order closed.",
      order: await androidOrderPayload(client, await loadOrder(client, device.outlet_key, order.id)),
    });
  });
}

async function bills(request: Request) {
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    await authenticateStaffSession(request, device, client);
    const result = await client.query<{ id: string }>(
      `SELECT o.id::text FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.outlet_key = $1 AND o.restaurant_status <> 'cancelled'
          AND p.status = 'pending' AND p.transaction_id LIKE 'BILL-%'
        ORDER BY o.updated_at DESC LIMIT 80`,
      [device.outlet_key],
    );
    const payload = [];
    for (const row of result.rows) payload.push(await androidBillPayload(client, await loadOrder(client, device.outlet_key, row.id)));
    return Response.json({ bills: payload, serverTime: isoNow() });
  });
}

async function ticketPrinted(request: Request, orderId: string) {
  const input = z.object({ items: z.array(z.object({ id: z.number().int().positive(), printedQuantity: z.number().int().positive() })).min(1).max(100) }).parse(await body(request));
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    await authenticateStaffSession(request, device, client);
    const order = await loadOrder(client, device.outlet_key, orderId);
    const ids = input.items.map((item) => item.id);
    const items = await client.query<{ id: string; quantity: number; send_to_kitchen: boolean; kitchen_printed_quantity: number }>(
      "SELECT id::text, quantity, send_to_kitchen, kitchen_printed_quantity FROM order_items WHERE order_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE",
      [order.id, ids],
    );
    if (items.rows.length !== ids.length) throw new HttpError(422, "The given data was invalid.", { items: ["One or more kitchen ticket items do not belong to this bill."] });
    for (const target of input.items) {
      const item = items.rows.find((candidate) => Number(candidate.id) === target.id)!;
      if (!item.send_to_kitchen) throw new HttpError(422, "The given data was invalid.", { items: ["Custom amount items cannot be sent to the kitchen."] });
      const printed = Math.min(item.quantity, target.printedQuantity);
      if (printed > item.kitchen_printed_quantity) await client.query("UPDATE order_items SET kitchen_printed_quantity = $1, updated_at = now() WHERE id = $2", [printed, item.id]);
    }
    return Response.json({ message: "Kitchen ticket print recorded.", bill: await androidBillPayload(client, await loadOrder(client, device.outlet_key, order.id)) });
  });
}

async function acceptedEvent(client: PoolClient, deviceId: string, key: string) {
  const result = await client.query<{
    idempotency_key: string; local_uuid: string; order_id: string | null; payment_id: string | null; status: string; order_code: string | null;
  }>(`SELECT e.idempotency_key, e.local_uuid, e.order_id::text, e.payment_id::text, e.status, o.order_code
        FROM android_pos_sync_events e LEFT JOIN orders o ON o.id = e.order_id
       WHERE e.device_id = $1 AND e.idempotency_key = $2`, [deviceId, key]);
  const row = result.rows[0];
  return row ? {
    idempotencyKey: row.idempotency_key, localUuid: row.local_uuid, orderCode: row.order_code,
    orderId: row.order_id ? Number(row.order_id) : null, paymentId: row.payment_id ? Number(row.payment_id) : null, status: row.status,
  } : null;
}

async function recordCustomAmounts(client: PoolClient, device: Device, staff: StaffSession, orderId: string, items: Awaited<ReturnType<typeof validateItems>>["items"], action: string) {
  const custom = items.filter((item) => item.itemType === "custom_amount");
  if (!custom.length) return;
  await client.query(
    `INSERT INTO pos_audit_logs(outlet_key, actor_id, action, auditable_type, auditable_id, reason, metadata)
     VALUES ($1,$2,$3,'order',$4,$5,$6::jsonb)`,
    [device.outlet_key, staff.user_id, action, orderId, custom.map((item) => item.notes).filter(Boolean).join("; ") || "Custom amount entered from Android POS.", JSON.stringify({ device_id: device.id, items: custom })],
  );
}

async function createOrder(
  client: PoolClient, device: Device, staff: StaffSession,
  event: z.infer<typeof syncEvent>, input: z.infer<typeof paidOrderInput>,
) {
  const shift = await activeShift(client, device.outlet_key);
  if (!shift) throw new HttpError(422, "The given data was invalid.", { shift: ["Start operations before syncing cashier orders."] });
  const table = input.orderMode === "dinein" ? await validateTable(client, device.outlet_key, input.tableNumber!) : null;
  const validated = await validateItems(client, device.outlet_key, input.items as SyncItemInput[]);
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders(outlet_key, shift_id, order_code, public_token, business_date, customer_name, customer_phone,
      customer_email, order_mode, table_number, table_code, table_label, pickup_name, notes, status, restaurant_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending','accepted') RETURNING id::text`,
    [device.outlet_key, shift.id, await uniqueOrderCode(client), opaqueToken("order_"), shift.business_date,
      input.customerName, input.customerPhone ?? null, input.customerEmail ?? null, input.orderMode,
      input.orderMode === "dinein" ? input.tableNumber : 0, table?.table_code ?? null,
      input.orderMode === "dinein" ? table?.table_label : "Take Away",
      input.orderMode === "takeaway" ? input.pickupName || input.customerName : null, input.notes ?? null],
  );
  await insertItems(client, order.rows[0].id, validated.items);
  await recordCustomAmounts(client, device, staff, order.rows[0].id, validated.items, "custom_amount.paid");
  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments(order_id, amount, status, payment_method, transaction_id, paid_at, notes)
     VALUES ($1,$2,'completed',$3,$4,now(),$5) RETURNING id::text`,
    [order.rows[0].id, validated.subtotal * (1 + await outletTaxRate(client, device.outlet_key)), input.paymentMethod,
      `ANDROID-${input.paymentMethod.toUpperCase()}-${order.rows[0].id}`, input.paymentNotes ?? null],
  );
  await client.query(
    `INSERT INTO android_pos_sync_events(device_id, staff_session_id, user_id, outlet_key, local_uuid,
      idempotency_key, event_type, payload, order_id, payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [device.id, staff.id, staff.user_id, device.outlet_key, event.localUuid, event.idempotencyKey,
      event.type, JSON.stringify(input), order.rows[0].id, payment.rows[0].id],
  );
  await refreshShiftTotals(client, shift.id);
}

async function saveBill(
  client: PoolClient, device: Device, staff: StaffSession,
  event: z.infer<typeof syncEvent>, input: z.infer<typeof billInput>, update: boolean,
) {
  const shift = await activeShift(client, device.outlet_key);
  if (!shift) throw new HttpError(422, "The given data was invalid.", { shift: ["Start operations before saving a bill."] });
  if (update && !input.orderId) throw new HttpError(422, "The given data was invalid.", { orderId: ["Order ID is required."] });
  const table = input.orderMode === "dinein" ? await validateTable(client, device.outlet_key, input.tableNumber!) : null;
  const validated = await validateItems(client, device.outlet_key, input.items as SyncItemInput[]);
  const billName = input.billName?.trim() || "";
  const displayName = input.customerName?.trim() || billName || (input.orderMode === "dinein" ? table?.table_label || `Table ${input.tableNumber}` : "Walk-in Customer");
  const pickupName = input.pickupName?.trim() || displayName;
  let orderId: string;
  if (update) {
    await client.query("SELECT id FROM orders WHERE id = $1 AND outlet_key = $2 FOR UPDATE", [input.orderId, device.outlet_key]);
    const order = await loadOrder(client, device.outlet_key, String(input.orderId));
    if (order.payment_status !== "pending" || order.refunded_at || normalizeStatus(order.restaurant_status) === "cancelled") {
      throw new HttpError(422, "The given data was invalid.", { orderId: ["This bill is already paid or cannot be changed."] });
    }
    orderId = order.id;
    await client.query(
      `UPDATE orders SET customer_name=$1, notes=coalesce($2,notes), order_mode=$3, pickup_name=$4,
        table_number=$5, table_code=$6, table_label=$7, updated_at=now() WHERE id=$8`,
      [displayName, input.notes ?? null, input.orderMode, input.orderMode === "takeaway" ? pickupName : null,
        input.orderMode === "dinein" ? input.tableNumber : 0, table?.table_code ?? null,
        input.orderMode === "dinein" ? table?.table_label : "Take Away", orderId],
    );
    await client.query("DELETE FROM order_items WHERE order_id = $1", [orderId]);
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO orders(outlet_key, shift_id, order_code, public_token, business_date, customer_name, order_mode,
        table_number, table_code, table_label, pickup_name, notes, status, restaurant_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending','accepted') RETURNING id::text`,
      [device.outlet_key, shift.id, await uniqueOrderCode(client), opaqueToken("order_"), shift.business_date,
        displayName, input.orderMode, input.orderMode === "dinein" ? input.tableNumber : 0, table?.table_code ?? null,
        input.orderMode === "dinein" ? table?.table_label : "Take Away",
        input.orderMode === "takeaway" ? pickupName : null, input.notes ?? null],
    );
    orderId = created.rows[0].id;
  }
  await insertItems(client, orderId, validated.items);
  if (update) {
    const pendingKitchen = validated.items.some((item) => item.sendToKitchen);
    if (pendingKitchen) await client.query("UPDATE orders SET restaurant_status='accepted', status='pending' WHERE id=$1 AND restaurant_status='ready'", [orderId]);
  }
  await recordCustomAmounts(client, device, staff, orderId, validated.items, update ? "custom_amount.bill_updated" : "custom_amount.bill_saved");
  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments(order_id, amount, status, payment_method, transaction_id, notes)
     VALUES ($1,$2,'pending','cash',$3,$4)
     ON CONFLICT (order_id) DO UPDATE SET amount=EXCLUDED.amount, status='pending', payment_method='cash',
       paid_at=NULL, notes=EXCLUDED.notes, updated_at=now()
     RETURNING id::text`,
    [orderId, validated.subtotal * (1 + await outletTaxRate(client, device.outlet_key)), `BILL-${Date.now()}-${orderId}`, `Bill saved from Android POS: ${billName || displayName}`],
  );
  await client.query(
    `INSERT INTO android_pos_sync_events(device_id, staff_session_id, user_id, outlet_key, local_uuid,
      idempotency_key, event_type, payload, order_id, payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [device.id, staff.id, staff.user_id, device.outlet_key, event.localUuid, event.idempotencyKey,
      event.type, JSON.stringify(input), orderId, payment.rows[0].id],
  );
  await refreshShiftTotals(client, shift.id);
}

async function processSyncEvent(request: Request, event: z.infer<typeof syncEvent>) {
  return transaction(async (client) => {
    const device = await authenticateDevice(request, client);
    const staff = await authenticateStaffSession(request, device, client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${device.id}:${event.idempotencyKey}`]);
    const existing = await acceptedEvent(client, device.id, event.idempotencyKey);
    if (existing) return existing;
    if (event.type === "cashier_order_created") await createOrder(client, device, staff, event, paidOrderInput.parse(event.payload));
    else await saveBill(client, device, staff, event, billInput.parse(event.payload), event.type === "cashier_bill_updated");
    return (await acceptedEvent(client, device.id, event.idempotencyKey))!;
  });
}

async function sync(request: Request) {
  // Authenticate before validating individual events so invalid clients cannot probe validation behavior.
  const device = await authenticateDevice(request);
  await authenticateStaffSession(request, device);
  const input = z.object({ events: z.array(syncEvent).min(1).max(25) }).parse(await body(request));
  const accepted = [];
  const rejected = [];
  for (const event of input.events) {
    try {
      accepted.push(await processSyncEvent(request, event));
    } catch (error) {
      const message = error instanceof HttpError ? Object.values(error.errors ?? {}).flat()[0] || error.message
        : error instanceof z.ZodError ? error.issues[0]?.message || "Invalid event." : "Invalid event.";
      rejected.push({ idempotencyKey: event.idempotencyKey, localUuid: event.localUuid, message });
    }
  }
  return Response.json({ accepted, rejected, serverTime: isoNow() });
}

export async function handleAndroidRequest(request: Request, path: string[]): Promise<Response> {
  try {
    const key = path.join("/");
    await enforceRateLimit(pool, rateLimitKey("android-api", request.headers), 60, 60);
    if (request.method === "GET" && key === "app-update") return await androidAppUpdate();
    if (request.method === "POST" && key === "device/register") return await registerDevice(request);
    if (request.method === "POST" && key === "auth/login") return await login(request);
    if (request.method === "POST" && key === "auth/device-login") return await deviceLogin(request);
    if (request.method === "GET" && key === "bootstrap") return await bootstrap(request);
    if (request.method === "GET" && key === "orders") return await orders(request);
    if (request.method === "GET" && key === "bills") return await bills(request);
    if (request.method === "POST" && key === "sync") return await sync(request);
    if (request.method === "POST" && key === "sync/v2") return await androidSyncV2(request);
    if (request.method === "GET" && key === "menu-orders") return await androidMenuOrders(request);
    if (request.method === "POST" && key === "reports") return await androidProblemReport(request);
    const orderAction = key.match(/^orders\/(\d+)\/(status|settle|ticket-printed)$/);
    if (request.method === "POST" && orderAction?.[2] === "status") return await updateStatus(request, orderAction[1]);
    if (request.method === "POST" && orderAction?.[2] === "settle") return await settle(request, orderAction[1]);
    if (request.method === "POST" && orderAction?.[2] === "ticket-printed") return await ticketPrinted(request, orderAction[1]);
    return Response.json({ message: "Not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}
