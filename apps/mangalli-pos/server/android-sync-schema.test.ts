import assert from "node:assert/strict";
import test from "node:test";

import { syncEvent } from "./android-sync-schema";

// Snapshot seperti yang dikirim tablet untuk bill belum dibayar yang dibatalkan
// (kejadian 26 Sep: #007 dan #008 ditolak terus dengan "Invalid option").
const cancelledBill = (paymentStatus: string) => ({
  type: "order",
  data: {
    localUuid: "8d0f5d8e-3c55-4bd2-9a3e-cancelled-bill",
    shiftLocalUuid: "shift-local-uuid-1",
    businessDate: "2026-09-26",
    createdAt: "2026-09-26T18:20:00+08:00",
    orderMode: "dinein",
    tableNumber: 6,
    customerName: null,
    notes: null,
    status: "cancelled",
    cancelReason: "Customer left",
    staffUserId: 4,
    subtotal: 22000,
    total: 24200,
    discount: null,
    payment: { status: paymentStatus, method: null, notes: null, paidAt: null },
    items: [{ productId: "americano", type: "product", name: "Americano", quantity: 1, unitPrice: 22000 }],
    events: [{ id: "cancel-event-0001", type: "cancel", summary: "Cancelled #007", reason: "Customer left", amount: 24200, byUserId: 4, at: "2026-09-26T18:25:00+08:00" }],
  },
});

test("a cancelled unpaid bill from the tablet syncs", () => {
  assert.equal(syncEvent.safeParse(cancelledBill("cancelled")).success, true);
});

test("every payment status the tablet writes is accepted, unknown ones are not", () => {
  // MainActivity.kt: "pending" (bill/menu), "completed" (charge, settle), "cancelled" (unpaid bill cancelled).
  for (const status of ["pending", "completed", "cancelled"]) assert.equal(syncEvent.safeParse(cancelledBill(status)).success, true, status);
  assert.equal(syncEvent.safeParse(cancelledBill("refunded-by-hand")).success, false);
});
