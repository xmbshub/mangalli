import "server-only";

import type { PoolClient } from "pg";
import { z } from "zod";

import { recordAppVersion } from "./app-releases";
import { authenticateDevice, authenticateStaffSession } from "./auth";
import { pool, transaction } from "./db";
import { HttpError } from "./http";
import { expireUnpaidOrders } from "./menu-orders";
import { enforceRateLimit, rateLimitKey } from "./rate-limit";
import { activeShift, audit, auditLogged, formatIdr, opaqueToken, refundIfPaid, refreshShiftTotals, uniqueOrderCode, type Device } from "./pos";
import { recordOversold } from "./stock";
import { menuOrderUpdate, MAX_EVENTS, orderEvent, orderSnapshot, shiftSnapshot, syncEvent } from "./android-sync-schema";
import { canTransition, legacyStatus, normalizeStatus } from "./workflow";

// Sinkron Android offline-first (versi 2).
//
// Tablet kasir menjalankan operasional tanpa internet: shift, transaksi, open
// bill, antrean dapur, dan pembayaran tersimpan di tablet. Saat sinkron
// (jam terjadwal, manual, atau tutup shift) tablet mengirim snapshot terbaru
// setiap shift dan pesanan. Server menerima snapshot apa adanya: waktu dan
// harga dari tablet, tanpa menolak karena shift server tertutup atau menu
// sudah berubah, supaya penjualan offline tidak pernah hilang dari laporan.
// Selisih harga dengan katalog dicatat di audit log.

type EventResult = { type: string; localUuid: string; ok: boolean; serverId?: number; orderCode?: string | null; message?: string };

async function outletUser(client: PoolClient, outletKey: string, userId: number | null | undefined) {
  if (!userId) return null;
  const result = await client.query("SELECT 1 FROM outlet_members WHERE user_id=$1 AND outlet_key=$2", [userId, outletKey]);
  return result.rowCount ? userId : null;
}

async function shiftId(client: PoolClient, device: Device, localUuid: string | null | undefined) {
  if (!localUuid) return null;
  const result = await client.query<{ id: string }>("SELECT id::text FROM pos_shifts WHERE device_id=$1 AND local_uuid=$2", [device.id, localUuid]);
  return result.rows[0]?.id ?? null;
}

async function upsertShift(client: PoolClient, device: Device, input: z.infer<typeof shiftSnapshot>): Promise<EventResult> {
  const openedBy = await outletUser(client, device.outlet_key, input.openedByUserId);
  const closedBy = await outletUser(client, device.outlet_key, input.closedByUserId);
  const approvedBy = await outletUser(client, device.outlet_key, input.approvedByUserId);
  const existing = await shiftId(client, device, input.localUuid);
  const before = existing
    ? (await client.query<{ status: string }>("SELECT status FROM pos_shifts WHERE id=$1", [existing])).rows[0]?.status ?? null
    : null;
  let id: string;
  if (existing) {
    await client.query(
      `UPDATE pos_shifts SET status=$1, closed_at=$2, closed_by=coalesce($3, closed_by), actual_cash=$4, notes=coalesce($5, notes),
         updated_at=now() WHERE id=$6`,
      [input.status, input.closedAt ?? null, closedBy, input.actualCash ?? null, input.notes ?? null, existing],
    );
    id = existing;
  } else {
    // Tablet yang sama tidak boleh punya dua shift terbuka; shift lama yang
    // tertinggal terbuka (misalnya aplikasi dipasang ulang) ditutup dulu.
    if (input.status === "open") {
      await client.query(
        "UPDATE pos_shifts SET status='closed', closed_at=coalesce(closed_at, now()), updated_at=now() WHERE device_id=$1 AND status='open'",
        [device.id],
      );
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO pos_shifts(outlet_key, business_date, status, opened_by, closed_by, opened_at, closed_at, opening_cash,
         actual_cash, notes, device_id, local_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text`,
      [device.outlet_key, input.businessDate, input.status, openedBy, closedBy, input.openedAt, input.closedAt ?? null,
        input.openingCash, input.actualCash ?? null, input.notes ?? null, device.id, input.localUuid],
    );
    id = created.rows[0].id;
  }
  // Cash in/out dari tablet: disimpan sekali per localUuid, tiap yang baru
  // tercatat di audit log (tab Money) dengan penyetujunya.
  for (const movement of input.cashMovements) {
    const by = await outletUser(client, device.outlet_key, movement.byUserId);
    const approver = await outletUser(client, device.outlet_key, movement.approvedByUserId);
    const inserted = await client.query(
      `INSERT INTO shift_cash_movements(outlet_key, shift_id, local_uuid, kind, amount, reason, created_by, approved_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (shift_id, local_uuid) DO NOTHING RETURNING id`,
      [device.outlet_key, id, movement.localUuid, movement.kind, movement.amount, movement.reason, by, approver, movement.at]);
    if (inserted.rowCount) {
      await audit(client, {
        outletKey: device.outlet_key, action: movement.kind === "out" ? "shift.cash_out" : "shift.cash_in", type: "shift", id,
        actorId: by, approvedBy: approver, reason: movement.reason,
        summary: `${movement.kind === "out" ? "Cash out" : "Cash in"} ${formatIdr(movement.amount)}: ${movement.reason}.`,
        metadata: { at: movement.at, amount: movement.amount },
      });
    }
  }
  await refreshShiftTotals(client, id);
  await client.query(
    "UPDATE pos_shifts SET cash_difference = CASE WHEN actual_cash IS NULL THEN 0 ELSE actual_cash - expected_cash END WHERE id=$1",
    [id],
  );
  if (!existing) {
    await audit(client, {
      outletKey: device.outlet_key, action: "shift.opened", type: "shift", id, actorId: openedBy,
      summary: `Shift opened on the tablet with ${formatIdr(input.openingCash)} starting cash.`,
    });
  }
  if (input.status === "closed" && before !== "closed") {
    const totals = (await client.query<{ expected_cash: string; cash_difference: string }>(
      "SELECT expected_cash::text, cash_difference::text FROM pos_shifts WHERE id=$1", [id])).rows[0];
    const difference = Number(totals?.cash_difference ?? 0);
    await audit(client, {
      outletKey: device.outlet_key, action: "shift.closed", type: "shift", id, actorId: closedBy, approvedBy, reason: input.notes ?? null,
      summary: `Shift closed. Counted ${formatIdr(input.actualCash ?? 0)}, expected ${formatIdr(Number(totals?.expected_cash ?? 0))}`
        + (Math.abs(difference) >= 1 ? `, ${difference < 0 ? "short" : "over"} ${formatIdr(Math.abs(difference))}.` : ", balanced."),
      metadata: { difference },
    });
  }
  return { type: "shift", localUuid: input.localUuid, ok: true, serverId: Number(id) };
}

async function catalogPrices(client: PoolClient, outletKey: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const result = await client.query<{ id: string; price: string }>(
    "SELECT id, price::text FROM products WHERE outlet_key=$1 AND id = ANY($2::text[])",
    [outletKey, ids],
  );
  return new Map(result.rows.map((row) => [row.id, Number(row.price)]));
}

async function upsertOrder(client: PoolClient, device: Device, staffUserId: string, input: z.infer<typeof orderSnapshot>): Promise<EventResult> {
  const shift = await shiftId(client, device, input.shiftLocalUuid);
  const productIds = [...new Set(input.items.flatMap((item) => (item.type === "product" && item.productId ? [item.productId] : [])))];
  const prices = await catalogPrices(client, device.outlet_key, productIds);
  const table = input.orderMode === "dinein" ? input.tableNumber ?? null : null;
  const tableLabel = input.orderMode === "dinein" ? `Dine In - ${table ?? "-"}` : "Take Away";
  const customer = input.customerName || (input.orderMode === "dinein" ? `Table ${table ?? "-"}` : "Walk-in Customer");
  const status = input.status;
  const cancelled = status === "cancelled";

  const existing = await client.query<{ id: string; order_code: string; shift_id: string | null; restaurant_status: string; amount: string | null }>(
    `SELECT o.id::text, o.order_code, o.shift_id::text, o.restaurant_status, p.amount::text
       FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.device_id=$1 AND o.local_uuid=$2 FOR UPDATE OF o`,
    [device.id, input.localUuid],
  );
  let orderId: string;
  let orderCode: string;
  const previousShift = existing.rows[0]?.shift_id ?? null;
  const discountAmount = input.discount?.amount ?? 0;
  const discountLabel = input.discount?.label ?? null;
  // Promo/kupon yang dipakai dicatat supaya pemakaian kupon terhitung lintas kanal.
  const promotionId = input.discount?.promotionId
    ? (await client.query<{ id: string }>("SELECT id::text FROM promotions WHERE id=$1 AND outlet_key=$2", [input.discount.promotionId, device.outlet_key])).rows[0]?.id ?? null
    : null;
  if (existing.rows[0]) {
    orderId = existing.rows[0].id;
    orderCode = existing.rows[0].order_code;
    await client.query(
      `UPDATE orders SET shift_id=coalesce($1, shift_id), business_date=$2, customer_name=$3, order_mode=$4, table_number=$5,
         table_label=$6, pickup_name=$7, notes=$8, status=$9, restaurant_status=$10,
         void_reason=CASE WHEN $11::boolean THEN coalesce($12, void_reason) ELSE void_reason END,
         voided_at=CASE WHEN $11::boolean THEN coalesce(voided_at, now()) ELSE voided_at END,
         discount_amount=$14, discount_label=$15, promotion_id=$16, updated_at=now()
       WHERE id=$13`,
      [shift, input.businessDate, customer, input.orderMode, table ?? 0, tableLabel,
        input.orderMode === "takeaway" ? customer : null, input.notes ?? null, legacyStatus(status), status,
        cancelled, input.cancelReason ?? null, orderId, discountAmount, discountLabel, promotionId],
    );
    await client.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
  } else {
    orderCode = await uniqueOrderCode(client);
    const created = await client.query<{ id: string }>(
      `INSERT INTO orders(outlet_key, shift_id, order_code, public_token, business_date, customer_name, order_mode, table_number,
         table_label, pickup_name, notes, status, restaurant_status, void_reason, voided_at, device_id, local_uuid, created_at, updated_at,
         discount_amount, discount_label, promotion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),$19,$20,$21) RETURNING id::text`,
      [device.outlet_key, shift, orderCode, opaqueToken("order_"), input.businessDate, customer, input.orderMode, table ?? 0,
        tableLabel, input.orderMode === "takeaway" ? customer : null, input.notes ?? null, legacyStatus(status), status,
        cancelled ? input.cancelReason ?? "Cancelled on the cashier tablet." : null, cancelled ? new Date() : null,
        device.id, input.localUuid, input.createdAt, discountAmount, discountLabel, promotionId],
    );
    orderId = created.rows[0].id;
  }

  const priceNotes: Array<{ productId: string; tablet: number; catalog: number }> = [];
  for (const item of input.items) {
    const catalog = item.productId ? prices.get(item.productId) : undefined;
    const productId = item.type === "product" && catalog !== undefined ? item.productId : null;
    if (catalog !== undefined && Math.abs(catalog + item.modifierTotal - item.unitPrice) > 0.5) {
      priceNotes.push({ productId: item.productId!, tablet: item.unitPrice, catalog: catalog + item.modifierTotal });
    }
    await client.query(
      `INSERT INTO order_items(order_id, product_id, item_type, item_name, quantity, unit_price, modifier_total,
         selected_modifier_options, modifier_summary, notes, send_to_kitchen, kitchen_printed_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
      [orderId, productId, item.type, item.name, item.quantity, item.unitPrice, item.modifierTotal,
        JSON.stringify(item.modifierOptionIds.map((id) => ({ id }))), item.modifierSummary ?? null, item.notes ?? null,
        item.type === "product" && item.sendToKitchen, Math.min(item.quantity, item.kitchenPrintedQuantity)],
    );
  }

  const paid = input.payment.status === "completed";
  const method = input.payment.method === "digital" ? "qris" : input.payment.method ?? "cash";
  // Dibayar lalu dibatalkan = refund: tidak dihitung di laporan maupun kas shift.
  const refunded = paid && cancelled;
  const cancelEvent = input.events.find((event) => event.type === "cancel");
  await client.query(
    `INSERT INTO payments(order_id, amount, status, payment_method, transaction_id, paid_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) DO UPDATE SET amount=EXCLUDED.amount, status=EXCLUDED.status, payment_method=EXCLUDED.payment_method,
       paid_at=EXCLUDED.paid_at, notes=EXCLUDED.notes, updated_at=now()`,
    [orderId, input.total, refunded ? "refunded" : paid ? "completed" : cancelled ? "cancelled" : "pending", method,
      `ANDROID-${device.id}-${input.localUuid}`, paid ? input.payment.paidAt ?? input.createdAt : null, input.payment.notes ?? null],
  );
  if (refunded) {
    await client.query(
      `UPDATE payments SET refunded_at=coalesce(refunded_at, $2::timestamptz), refunded_by=coalesce(refunded_by, $3), refund_amount=amount,
         refund_reason=coalesce(refund_reason, $4) WHERE order_id=$1`,
      [orderId, cancelEvent?.at ?? new Date().toISOString(), await outletUser(client, device.outlet_key, cancelEvent?.approvedByUserId ?? cancelEvent?.byUserId),
        input.cancelReason ?? null],
    );
  }
  await logOrderEvents(client, device, staffUserId, orderId, orderCode, input.events, paid);
  if (!cancelled) await recordOversold(client, device.outlet_key, orderId, orderCode, productIds);

  // Penjaga server: pembatalan atau pengurangan total tanpa kejadian tercatat
  // (tablet lama, atau data diubah di luar alur) tetap muncul di audit log.
  const before = existing.rows[0];
  if (before) {
    const actor = (await outletUser(client, device.outlet_key, input.staffUserId)) ?? staffUserId;
    if (cancelled && before.restaurant_status !== "cancelled" && !cancelEvent) {
      await audit(client, {
        outletKey: device.outlet_key, action: refunded ? "order.refunded" : "order.cancelled", type: "order", id: orderId, actorId: actor,
        reason: input.cancelReason ?? null, summary: `${orderCode} cancelled on the tablet (${formatIdr(input.total)}) without a recorded approval.`,
      });
    }
    const previousTotal = Number(before.amount ?? 0);
    if (!cancelled && input.total < previousTotal - 0.5 && !input.events.some((event) => event.type === "void")) {
      await audit(client, {
        outletKey: device.outlet_key, action: "order.total_reduced", type: "order", id: orderId, actorId: actor,
        summary: `${orderCode} total dropped from ${formatIdr(previousTotal)} to ${formatIdr(input.total)} without a recorded void.`,
      });
    }
  }

  if (priceNotes.length && !existing.rows[0]) {
    await client.query(
      `INSERT INTO pos_audit_logs(outlet_key, actor_id, action, auditable_type, auditable_id, reason, metadata)
       VALUES ($1,$2,'android.offline_price_differs','order',$3,'Harga di tablet berbeda dengan katalog saat sinkron.',$4::jsonb)`,
      [device.outlet_key, (await outletUser(client, device.outlet_key, input.staffUserId)) ?? staffUserId, orderId,
        JSON.stringify({ device_id: device.id, items: priceNotes })],
    );
  }
  await refreshShiftTotals(client, shift);
  if (previousShift && previousShift !== shift) await refreshShiftTotals(client, previousShift);
  return { type: "order", localUuid: input.localUuid, ok: true, serverId: Number(orderId), orderCode };
}

async function logOrderEvents(
  client: PoolClient, device: Device, staffUserId: string, orderId: string | number, orderCode: string,
  events: Array<z.infer<typeof orderEvent>>, paid: boolean,
) {
  for (const event of events) {
    if (await auditLogged(client, device.outlet_key, event.id)) continue;
    await audit(client, {
      outletKey: device.outlet_key,
      action: event.type === "void" ? "order.item_voided" : event.type === "discount" ? "order.discount_manual" : paid ? "order.refunded" : "order.cancelled",
      type: "order", id: orderId, reason: event.reason ?? null,
      actorId: (await outletUser(client, device.outlet_key, event.byUserId)) ?? staffUserId,
      approvedBy: await outletUser(client, device.outlet_key, event.approvedByUserId),
      summary: `${orderCode}: ${event.summary}`,
      metadata: { event_id: event.id, amount: event.amount, at: event.at, device_id: device.id },
    });
  }
}

// Pesanan menu digital yang dibayar atau diproses di tablet.
async function applyMenuOrderUpdate(client: PoolClient, device: Device, staffUserId: string, input: z.infer<typeof menuOrderUpdate>): Promise<EventResult> {
  const result = await client.query<{ restaurant_status: string; shift_id: string | null; payment_status: string | null }>(
    `SELECT o.restaurant_status, o.shift_id::text, p.status AS payment_status FROM orders o LEFT JOIN payments p ON p.order_id=o.id
      WHERE o.id=$1 AND o.outlet_key=$2 FOR UPDATE OF o`,
    [input.serverOrderId, device.outlet_key],
  );
  const order = result.rows[0];
  if (!order) return { type: "menu_order", localUuid: input.localUuid, ok: false, message: "Order not found." };
  let current = normalizeStatus(order.restaurant_status);
  const shift = (await shiftId(client, device, input.shiftLocalUuid)) ?? order.shift_id ?? (await activeShift(client, device.outlet_key))?.id ?? null;

  if (input.payment && current === "pending_payment" && order.payment_status === "pending") {
    await client.query(
      "UPDATE payments SET status='completed', payment_method=$1, paid_at=$2, updated_at=now() WHERE order_id=$3",
      [input.payment.method, input.payment.paidAt, input.serverOrderId],
    );
    await client.query(
      "UPDATE orders SET restaurant_status='new', status='pending', shift_id=coalesce(shift_id,$2), payment_due_at=NULL, updated_at=now() WHERE id=$1",
      [input.serverOrderId, shift],
    );
    await client.query(
      `INSERT INTO pos_audit_logs(outlet_key, actor_id, action, auditable_type, auditable_id, metadata)
       VALUES ($1,$2,'order.menu_payment_received','order',$3,$4::jsonb)`,
      [device.outlet_key, staffUserId, input.serverOrderId, JSON.stringify({ method: input.payment.method, source: "android", device_id: device.id })],
    );
    current = "new";
  }

  let message: string | undefined;
  if (input.status && input.status !== current) {
    if (current !== "pending_payment" && canTransition(current, input.status)) {
      await client.query("UPDATE orders SET restaurant_status=$1, status=$2, updated_at=now() WHERE id=$3", [input.status, legacyStatus(input.status), input.serverOrderId]);
      if (input.status === "cancelled") {
        const cancelEvent = input.events.find((event) => event.type === "cancel");
        const approver = await outletUser(client, device.outlet_key, cancelEvent?.approvedByUserId ?? cancelEvent?.byUserId);
        const refunded = await refundIfPaid(client, String(input.serverOrderId), approver ?? staffUserId, cancelEvent?.reason ?? null);
        const code = (await client.query<{ order_code: string }>("SELECT order_code FROM orders WHERE id=$1", [input.serverOrderId])).rows[0]?.order_code ?? "Order";
        if (cancelEvent) await logOrderEvents(client, device, staffUserId, input.serverOrderId, code, [cancelEvent], refunded > 0);
        else await audit(client, {
          outletKey: device.outlet_key, action: refunded ? "order.refunded" : "order.cancelled", type: "order", id: input.serverOrderId,
          actorId: staffUserId, summary: `${code} cancelled on the tablet${refunded ? `, ${formatIdr(refunded)} refunded` : ""} without a recorded approval.`,
        });
      }
    } else {
      message = `Status ${current} tidak bisa diubah ke ${input.status}.`;
    }
  }
  await refreshShiftTotals(client, shift);
  return { type: "menu_order", localUuid: input.localUuid, ok: true, serverId: input.serverOrderId, message };
}

export async function androidSyncV2(request: Request) {
  const device = await authenticateDevice(request);
  const staff = await authenticateStaffSession(request, device);
  await enforceRateLimit(pool, rateLimitKey("android-sync-v2", request.headers, device.id), 30, 60);
  const raw = z.object({ events: z.array(z.unknown()).min(1).max(MAX_EVENTS) }).parse(await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body.");
  }));
  const order = { shift: 0, order: 1, menu_order: 2 } as const;
  const parsed = raw.events.map((event, index) => ({ index, result: syncEvent.safeParse(event) }));
  const results: EventResult[] = [];
  for (const entry of parsed.filter((item) => !item.result.success)) {
    const source = raw.events[entry.index] as { type?: string; data?: { localUuid?: string } } | null;
    results.push({ type: String(source?.type ?? "unknown"), localUuid: String(source?.data?.localUuid ?? ""), ok: false, message: entry.result.error?.issues[0]?.message ?? "Invalid event." });
  }
  const valid = parsed.flatMap((entry) => (entry.result.success ? [entry.result.data] : []))
    .sort((a, b) => order[a.type] - order[b.type]);
  for (const event of valid) {
    try {
      results.push(await transaction(async (client) => {
        if (event.type === "shift") return upsertShift(client, device, event.data);
        if (event.type === "order") return upsertOrder(client, device, staff.user_id, event.data);
        return applyMenuOrderUpdate(client, device, staff.user_id, event.data);
      }));
    } catch (error) {
      console.error("android sync v2 event failed", error);
      results.push({ type: event.type, localUuid: event.data.localUuid, ok: false, message: error instanceof HttpError ? error.message : "Server error." });
    }
  }
  await pool.query("UPDATE android_pos_devices SET last_seen_at=now(), updated_at=now() WHERE id=$1", [device.id]);
  await recordAppVersion(device.id, request.headers.get("x-mangalli-app-version"));
  return Response.json({ results, serverTime: new Date().toISOString() });
}

// Pesanan menu digital untuk tablet: menunggu bayar dan yang sedang berjalan,
// plus yang baru selesai atau batal supaya tablet bisa mencerminkan akhirnya.
export async function androidMenuOrders(request: Request) {
  const device = await authenticateDevice(request);
  await authenticateStaffSession(request, device);
  return transaction(async (client) => {
    await expireUnpaidOrders(client, device.outlet_key);
    const result = await client.query<{
      id: string; order_code: string; restaurant_status: string; order_mode: string; table_number: number; table_label: string | null;
      customer_name: string | null; pickup_name: string | null; notes: string | null; created_at: Date; updated_at: Date;
      payment_due_at: Date | null; payment_status: string | null; payment_method: string | null; amount: string | null;
    }>(
      `SELECT o.id::text, o.order_code, o.restaurant_status, o.order_mode, o.table_number, o.table_label, o.customer_name, o.pickup_name,
         o.notes, o.created_at, o.updated_at, o.payment_due_at, p.status AS payment_status, p.payment_method, p.amount::text
       FROM orders o JOIN payments p ON p.order_id=o.id
       WHERE o.outlet_key=$1 AND o.device_id IS NULL AND p.notes='Menu digital'
         AND o.created_at > now() - interval '24 hours'
         AND (o.restaurant_status IN ('pending_payment','new','accepted','preparing','ready') OR o.updated_at > now() - interval '3 hours')
       ORDER BY o.created_at`,
      [device.outlet_key],
    );
    const orders = [];
    for (const row of result.rows) {
      const items = await client.query<{ product_id: string | null; item_name: string | null; quantity: number; unit_price: string; modifier_total: string; modifier_summary: string | null; notes: string | null }>(
        "SELECT product_id, item_name, quantity, unit_price::text, modifier_total::text, modifier_summary, notes FROM order_items WHERE order_id=$1 ORDER BY id",
        [row.id],
      );
      orders.push({
        id: Number(row.id), orderCode: row.order_code, status: row.restaurant_status, orderMode: row.order_mode,
        tableNumber: row.table_number || null, tableLabel: row.table_label, customerName: row.customer_name, pickupName: row.pickup_name,
        notes: row.notes, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
        paymentDueAt: row.payment_due_at?.toISOString() ?? null, paymentStatus: row.payment_status, paymentMethod: row.payment_method,
        totalAmount: Number(row.amount ?? 0),
        items: items.rows.map((item) => ({
          productId: item.product_id, name: item.item_name || "Menu", quantity: item.quantity, unitPrice: Number(item.unit_price),
          modifierTotal: Number(item.modifier_total), modifierSummary: item.modifier_summary, notes: item.notes,
        })),
      });
    }
    return Response.json({ orders, serverTime: new Date().toISOString() });
  });
}
