// Aturan promo murni (tanpa database) dipakai server menu digital, sinkron
// tablet, dan dashboard. Salinannya ada di situs menu
// (apps/sites/designs/digital-menu-mobile/promotions.ts) dan tablet
// (PromoRules.kt) hanya untuk tampilan; total resmi selalu dihitung server
// atau tablet kasir dengan aturan yang sama. Ubah ketiganya bersama.

export type Promotion = {
  id: number;
  name: string;
  kind: "percent" | "amount";
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  scope: "order" | "category" | "product";
  categoryIds: string[];
  productIds: string[];
  channels: Array<"tablet" | "menu">;
  days: number[];
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  // Kupon: berlaku hanya bila kode dimasukkan. Tanggal berlaku opsional (YYYY-MM-DD, waktu outlet).
  code: string | null;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  used: number;
};

export type PromoLine = { productId: string | null; categoryId: string | null; lineTotal: number };

// Jam lokal outlet: hari ISO (Senin=1) dan menit sejak tengah malam.
export function localClock(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

// Jendela jam boleh melewati tengah malam (mis. 22:00–02:00); hari mengikuti jam mulai.
export function isPromotionLive(promotion: Promotion, now: Date, timezone: string): boolean {
  if (!promotion.isActive) return false;
  const { weekday, minutes, date } = localClock(now, timezone);
  if ((promotion.startsOn && date < promotion.startsOn) || (promotion.endsOn && date > promotion.endsOn)) return false;
  if (promotion.maxUses !== null && promotion.used >= promotion.maxUses) return false;
  if (!promotion.startTime || !promotion.endTime) return promotion.days.includes(weekday);
  const start = toMinutes(promotion.startTime);
  const end = toMinutes(promotion.endTime);
  if (start <= end) return promotion.days.includes(weekday) && minutes >= start && minutes < end;
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  return (promotion.days.includes(weekday) && minutes >= start) || (promotion.days.includes(yesterday) && minutes < end);
}

export function promotionDiscount(promotion: Promotion, lines: PromoLine[]): number {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (subtotal <= 0 || subtotal < promotion.minSubtotal) return 0;
  const base = promotion.scope === "order" ? subtotal : lines
    .filter((line) => (promotion.scope === "category" ? line.categoryId !== null && promotion.categoryIds.includes(line.categoryId) : line.productId !== null && promotion.productIds.includes(line.productId)))
    .reduce((sum, line) => sum + line.lineTotal, 0);
  if (base <= 0) return 0;
  const raw = promotion.kind === "percent" ? (base * promotion.value) / 100 : promotion.value;
  const capped = promotion.kind === "percent" && promotion.maxDiscount ? Math.min(raw, promotion.maxDiscount) : raw;
  return Math.round(Math.min(capped, base));
}

// Satu promo per pesanan: yang memberi potongan terbesar menang. Kupon hanya
// ikut bila kodenya dimasukkan (couponCode), tidak pernah otomatis.
export function bestPromotion(promotions: Promotion[], lines: PromoLine[], channel: "tablet" | "menu", now: Date, timezone: string, couponCode?: string | null) {
  let best: { promotion: Promotion; discount: number } | null = null;
  const code = normalizeCoupon(couponCode);
  for (const promotion of promotions) {
    if (promotion.code && promotion.code !== code) continue;
    if (!promotion.channels.includes(channel) || !isPromotionLive(promotion, now, timezone)) continue;
    const discount = promotionDiscount(promotion, lines);
    if (discount > 0 && (!best || discount > best.discount)) best = { promotion, discount };
  }
  return best;
}

export function normalizeCoupon(code: string | null | undefined): string | null {
  const clean = (code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9_-]{3,24}$/.test(clean) ? clean : null;
}

// Kupon masih berlaku (tanpa melihat isi keranjang): kode, status, tanggal, sisa pemakaian, jam.
export function couponBlocked(promotion: Promotion | undefined, channel: "tablet" | "menu", now: Date, timezone: string): string | null {
  if (!promotion || !promotion.code || !promotion.channels.includes(channel)) return "This coupon code isn't valid.";
  if (!promotion.isActive) return "This coupon isn't active.";
  const { date } = localClock(now, timezone);
  if (promotion.startsOn && date < promotion.startsOn) return `This coupon starts on ${promotion.startsOn}.`;
  if (promotion.endsOn && date > promotion.endsOn) return "This coupon has expired.";
  if (promotion.maxUses !== null && promotion.used >= promotion.maxUses) return "This coupon has been fully used.";
  if (!isPromotionLive(promotion, now, timezone)) return "This coupon can't be used at this time.";
  return null;
}

// Alasan kupon tidak bisa dipakai untuk pesanan ini, untuk pesan yang jelas ke pelanggan/kasir.
export function couponProblem(promotion: Promotion | undefined, lines: PromoLine[], channel: "tablet" | "menu", now: Date, timezone: string): string | null {
  const blocked = couponBlocked(promotion, channel, now, timezone);
  if (blocked || !promotion) return blocked ?? "This coupon code isn't valid.";
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (subtotal < promotion.minSubtotal) return `Spend at least Rp ${Math.round(promotion.minSubtotal).toLocaleString("id-ID")} to use this coupon.`;
  if (promotionDiscount(promotion, lines) <= 0) return "This coupon doesn't apply to the items in your order.";
  return null;
}

// Total resmi: pajak dari subtotal setelah diskon.
export function orderTotals(subtotal: number, discount: number, taxRate: number) {
  const taxable = Math.max(0, subtotal - discount);
  const tax = Math.round(taxable * taxRate);
  return { taxable, tax, total: taxable + tax };
}

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function promotionSummary(promotion: Pick<Promotion, "kind" | "value" | "maxDiscount" | "minSubtotal">): string {
  const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
  const amount = promotion.kind === "percent" ? `${promotion.value}% off` : `${rupiah(promotion.value)} off`;
  return [amount, promotion.kind === "percent" && promotion.maxDiscount ? `up to ${rupiah(promotion.maxDiscount)}` : "", promotion.minSubtotal ? `min. ${rupiah(promotion.minSubtotal)}` : ""].filter(Boolean).join(" · ");
}

export function scheduleSummary(promotion: Pick<Promotion, "days" | "startTime" | "endTime">): string {
  const days = promotion.days.length === 7 ? "Every day"
    : promotion.days.join() === "1,2,3,4,5" ? "Mon–Fri"
      : promotion.days.join() === "6,7" ? "Weekends"
        : promotion.days.map((day) => dayNames[day - 1]).join(", ");
  return promotion.startTime && promotion.endTime ? `${days}, ${promotion.startTime.slice(0, 5)}–${promotion.endTime.slice(0, 5)}` : days;
}
