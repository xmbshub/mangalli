// Kontrak sinkron Android offline-first (versi 2): bentuk snapshot shift,
// pesanan, dan pembaruan pesanan menu digital yang dikirim tablet. Dipisah dari
// android-offline.ts (yang butuh database) supaya bisa diuji langsung.
import { z } from "zod";

import { restaurantStatuses } from "./workflow";

export const MAX_EVENTS = 50;
export const isoTime = z.iso.datetime({ offset: true });
export const money = z.number().min(0).max(1_000_000_000);

export const shiftSnapshot = z.object({
  localUuid: z.string().trim().min(8).max(80),
  businessDate: z.iso.date(),
  status: z.enum(["open", "closed"]),
  openedAt: isoTime,
  closedAt: isoTime.nullish(),
  openingCash: money,
  actualCash: money.nullish(),
  openedByUserId: z.number().int().positive().nullish(),
  closedByUserId: z.number().int().positive().nullish(),
  // Manager/owner yang menyetujui kas kurang atau bill yang dibawa (PIN di tablet).
  approvedByUserId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(500).nullish(),
  cashMovements: z.array(z.object({
    localUuid: z.string().trim().min(8).max(80),
    kind: z.enum(["in", "out"]),
    amount: money.refine((value) => value > 0, "Amount must be above zero."),
    reason: z.string().trim().min(1).max(200),
    byUserId: z.number().int().positive().nullish(),
    approvedByUserId: z.number().int().positive().nullish(),
    at: isoTime,
  })).max(200).default([]),
});

export const orderItem = z.object({
  productId: z.string().trim().max(120).nullish(),
  type: z.enum(["product", "custom_amount"]),
  name: z.string().trim().min(1).max(255),
  quantity: z.number().int().min(1).max(999),
  unitPrice: money,
  modifierTotal: money.default(0),
  modifierOptionIds: z.array(z.number().int().positive()).max(50).default([]),
  modifierSummary: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(255).nullish(),
  sendToKitchen: z.boolean().default(true),
  kitchenPrintedQuantity: z.number().int().min(0).max(999).default(0),
});

// Kejadian sensitif di tablet (void item pada bill, pembatalan/refund) dengan
// kasir dan penyetujunya. Dicatat sekali ke audit log berdasarkan id-nya.
export const orderEvent = z.object({
  id: z.string().trim().min(8).max(80),
  type: z.enum(["void", "cancel", "discount"]),
  summary: z.string().trim().min(1).max(300),
  reason: z.string().trim().max(500).nullish(),
  amount: money.default(0),
  byUserId: z.number().int().positive().nullish(),
  approvedByUserId: z.number().int().positive().nullish(),
  at: isoTime,
});

export const orderSnapshot = z.object({
  localUuid: z.string().trim().min(8).max(80),
  shiftLocalUuid: z.string().trim().max(80).nullish(),
  businessDate: z.iso.date(),
  createdAt: isoTime,
  orderMode: z.enum(["dinein", "takeaway"]),
  tableNumber: z.number().int().min(1).max(9999).nullish(),
  customerName: z.string().trim().max(255).nullish(),
  notes: z.string().trim().max(500).nullish(),
  status: z.enum(restaurantStatuses),
  cancelReason: z.string().trim().max(500).nullish(),
  staffUserId: z.number().int().positive().nullish(),
  subtotal: money,
  total: money,
  // Diskon yang dipakai di tablet (promo dari dashboard atau diskon manual yang disetujui).
  discount: z.object({ amount: money, label: z.string().trim().min(1).max(80), promotionId: z.number().int().positive().nullish() }).nullish(),
  payment: z.object({
    // Status pembayaran tablet: bill belum dibayar yang dibatalkan menjadi
    // "cancelled" (MainActivity.updateOrderStatus). Harus sama dengan tablet.
    status: z.enum(["pending", "completed", "cancelled"]),
    method: z.enum(["cash", "qris", "edc", "transfer", "other", "digital"]).nullish(),
    notes: z.string().trim().max(255).nullish(),
    paidAt: isoTime.nullish(),
  }),
  items: z.array(orderItem).min(1).max(200),
  events: z.array(orderEvent).max(100).default([]),
});

export const menuOrderUpdate = z.object({
  localUuid: z.string().trim().min(8).max(80),
  serverOrderId: z.number().int().positive(),
  shiftLocalUuid: z.string().trim().max(80).nullish(),
  status: z.enum(restaurantStatuses).nullish(),
  payment: z.object({ method: z.enum(["cash", "qris"]), paidAt: isoTime }).nullish(),
  events: z.array(orderEvent).max(100).default([]),
});

export const syncEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shift"), data: shiftSnapshot }),
  z.object({ type: z.literal("order"), data: orderSnapshot }),
  z.object({ type: z.literal("menu_order"), data: menuOrderUpdate }),
]);
