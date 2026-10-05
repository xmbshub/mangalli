import assert from "node:assert/strict";
import test from "node:test";

import { bestPromotion, couponProblem, isPromotionLive, normalizeCoupon, orderTotals, promotionDiscount, type Promotion } from "./promotion-rules";

const base: Promotion = {
  id: 1, name: "Test", kind: "percent", value: 20, maxDiscount: null, minSubtotal: 0, scope: "order",
  categoryIds: [], productIds: [], channels: ["tablet", "menu"], days: [1, 2, 3, 4, 5, 6, 7], startTime: null, endTime: null, isActive: true,
  code: null, startsOn: null, endsOn: null, maxUses: null, used: 0,
};
const lines = [
  { productId: "latte", categoryId: "1", lineTotal: 50_000 },
  { productId: "cake", categoryId: "2", lineTotal: 30_000 },
];

test("percent off the whole order, capped", () => {
  assert.equal(promotionDiscount(base, lines), 16_000);
  assert.equal(promotionDiscount({ ...base, maxDiscount: 10_000 }, lines), 10_000);
});

test("category and product scopes only discount matching lines", () => {
  assert.equal(promotionDiscount({ ...base, scope: "category", categoryIds: ["1"] }, lines), 10_000);
  assert.equal(promotionDiscount({ ...base, kind: "amount", value: 40_000, scope: "product", productIds: ["cake"] }, lines), 30_000);
});

test("minimum spend and inactive promos give nothing", () => {
  assert.equal(promotionDiscount({ ...base, minSubtotal: 100_000 }, lines), 0);
  assert.equal(isPromotionLive({ ...base, isActive: false }, new Date(), "Asia/Makassar"), false);
});

test("happy hour follows outlet time, including overnight windows", () => {
  // 2026-09-26T07:30Z = Saturday 15:30 WITA
  const saturdayAfternoon = new Date("2026-09-26T07:30:00Z");
  assert.equal(isPromotionLive({ ...base, startTime: "14:00", endTime: "17:00" }, saturdayAfternoon, "Asia/Makassar"), true);
  assert.equal(isPromotionLive({ ...base, days: [1, 2, 3, 4, 5], startTime: "14:00", endTime: "17:00" }, saturdayAfternoon, "Asia/Makassar"), false);
  // Sunday 01:00 WITA falls in Saturday's 22:00–02:00 window.
  assert.equal(isPromotionLive({ ...base, days: [6], startTime: "22:00", endTime: "02:00" }, new Date("2026-09-26T17:00:00Z"), "Asia/Makassar"), true);
});

test("best promo wins, per channel, and tax applies after discount", () => {
  const promos = [{ ...base, id: 1, value: 10 }, { ...base, id: 2, value: 25, channels: ["menu" as const] }];
  assert.equal(bestPromotion(promos, lines, "tablet", new Date(), "Asia/Jakarta")?.promotion.id, 1);
  assert.equal(bestPromotion(promos, lines, "menu", new Date(), "Asia/Jakarta")?.discount, 20_000);
  assert.deepEqual(orderTotals(80_000, 20_000, 0.1), { taxable: 60_000, tax: 6_000, total: 66_000 });
});

test("coupons only apply with their code, within dates and uses", () => {
  const coupon = { ...base, id: 9, value: 30, code: "HEMAT30", startsOn: "2026-09-20", endsOn: "2026-09-30", maxUses: 100, used: 10 };
  const now = new Date("2026-09-26T07:30:00Z");
  assert.equal(bestPromotion([coupon], lines, "menu", now, "Asia/Makassar"), null);
  assert.equal(bestPromotion([coupon], lines, "menu", now, "Asia/Makassar", " hemat30 ")?.discount, 24_000);
  assert.equal(normalizeCoupon("hemat 30"), "HEMAT30");
  assert.equal(couponProblem(coupon, lines, "menu", new Date("2026-10-01T07:30:00Z"), "Asia/Makassar"), "This coupon has expired.");
  assert.equal(couponProblem({ ...coupon, used: 100 }, lines, "menu", now, "Asia/Makassar"), "This coupon has been fully used.");
  assert.match(couponProblem({ ...coupon, minSubtotal: 200_000 }, lines, "menu", now, "Asia/Makassar") ?? "", /Spend at least/);
  assert.equal(couponProblem(coupon, lines, "menu", now, "Asia/Makassar"), null);
});
