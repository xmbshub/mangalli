// Status yang dipakai antrean kasir dan dapur. Android hanya menerima status
// di daftar ini.
export const restaurantStatuses = ["new", "accepted", "preparing", "ready", "completed", "cancelled"] as const;
// Pesanan menu digital menunggu pembayaran di luar antrean dapur. Status ini
// hanya bisa ditinggalkan lewat pembayaran (kasir atau Midtrans) atau
// pembatalan, tidak pernah lewat tombol status biasa.
export type RestaurantStatus = (typeof restaurantStatuses)[number] | "pending_payment";

const transitions: Record<RestaurantStatus, RestaurantStatus[]> = {
  pending_payment: [],
  new: ["accepted", "cancelled"],
  accepted: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function normalizeStatus(value: unknown): RestaurantStatus {
  if (value === "pending_payment") return "pending_payment";
  return restaurantStatuses.includes(value as (typeof restaurantStatuses)[number]) ? (value as RestaurantStatus) : "new";
}

export function canTransition(current: unknown, next: RestaurantStatus): boolean {
  const normalized = normalizeStatus(current);
  return normalized === next || transitions[normalized].includes(next);
}

export function legacyStatus(status: RestaurantStatus): "pending" | "completed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

export function statusLabel(status: RestaurantStatus): string {
  if (status === "pending_payment") return "Awaiting Payment";
  if (status === "new") return "New Orders";
  if (status === "accepted" || status === "preparing") return "Orders In Progress";
  if (status === "ready") return "Delivered Orders";
  if (status === "completed") return "Completed Orders";
  return "Cancelled Orders";
}
