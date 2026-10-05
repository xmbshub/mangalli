import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { transaction } from "@/server/db";
import { jsonError } from "@/server/http";
import { midtransServerKey } from "@/server/menu-orders";
import { refreshShiftTotals } from "@/server/pos";
import { recordReport } from "@/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notification = z.object({
  order_id: z.string().min(1), status_code: z.string().min(1), gross_amount: z.string().min(1),
  signature_key: z.string().min(1), transaction_status: z.string().min(1), fraud_status: z.string().optional(),
  payment_type: z.string().optional(), transaction_id: z.string().optional(),
});

// Setiap brand memakai merchant Midtrans sendiri, jadi tanda tangan
// diverifikasi dengan kunci outlet pemilik pembayaran. Pembayaran lunas
// melepas pesanan menu digital dari "menunggu bayar" ke antrean dapur.
export async function POST(request: Request) {
  try {
    const input = notification.parse(await request.json());
    const result = await transaction(async (client) => {
      const found = await client.query<{ id: string; order_id: string; status: string; shift_id: string | null; outlet_key: string }>(
        `SELECT p.id::text,p.order_id::text,p.status,o.shift_id::text,o.outlet_key FROM payments p
          JOIN orders o ON o.id=p.order_id WHERE p.transaction_id=$1 FOR UPDATE`, [input.order_id],
      );
      const payment = found.rows[0];
      if (!payment) return "unknown";
      const serverKey = midtransServerKey(payment.outlet_key);
      // Kegagalan di sini berarti pelanggan mungkin sudah bayar tapi pesanan
      // tidak bergerak: selalu muncul sebagai laporan masalah pembayaran.
      if (!serverKey) {
        await recordReport(client, { outletKey: payment.outlet_key, source: "system", category: "payment", fingerprint: "midtrans:unconfigured",
          title: "Midtrans sent a payment but the merchant key isn't set", context: { order: input.order_id, status: input.transaction_status } });
        return "unconfigured";
      }
      const expected = Buffer.from(createHash("sha512").update(`${input.order_id}${input.status_code}${input.gross_amount}${serverKey}`).digest("hex"));
      const actual = Buffer.from(input.signature_key.toLowerCase());
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await recordReport(client, { outletKey: payment.outlet_key, source: "system", category: "payment", fingerprint: "midtrans:signature",
          title: "A Midtrans payment notice failed the signature check", context: { order: input.order_id, status: input.transaction_status } });
        return "invalid";
      }
      const paid = input.transaction_status === "settlement" || (input.transaction_status === "capture" && input.fraud_status !== "challenge");
      const failed = ["deny", "cancel", "expire", "failure"].includes(input.transaction_status);
      if (paid) {
        await client.query(
          `UPDATE payments SET status='completed',payment_method=$1,paid_at=coalesce(paid_at,now()),updated_at=now() WHERE id=$2`,
          [input.payment_type || "midtrans", payment.id],
        );
        await client.query(
          `UPDATE orders SET restaurant_status='new',status='pending',payment_due_at=NULL,updated_at=now()
            WHERE id=$1 AND restaurant_status='pending_payment'`,
          [payment.order_id],
        );
      } else if (failed && payment.status !== "completed") {
        const status = input.transaction_status === "expire" ? "expired" : input.transaction_status === "cancel" ? "cancelled" : "failed";
        await client.query("UPDATE payments SET status=$1,updated_at=now() WHERE id=$2", [status, payment.id]);
        await client.query(
          `UPDATE orders SET restaurant_status='cancelled',status='cancelled',void_reason='Pembayaran online tidak selesai.',
             voided_at=now(),updated_at=now() WHERE id=$1 AND restaurant_status='pending_payment'`,
          [payment.order_id],
        );
      }
      await refreshShiftTotals(client, payment.shift_id);
      return "ok";
    });
    if (result === "unconfigured") return Response.json({ message: "Payment webhook is not configured." }, { status: 503 });
    if (result === "invalid") return Response.json({ message: "Invalid signature." }, { status: 401 });
    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
}
