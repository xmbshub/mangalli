import assert from "node:assert/strict";
import { test } from "node:test";

import { change, previousPeriod, sumMoney, type PaidOrder } from "./report-math";

const order = (amount: number, gross: number, discount = 0, cost: number | null = null, costed: number | null = null): PaidOrder => ({
  id: "1", channel: "tablet", order_mode: "dinein", payment_method: "cash", amount: String(amount), discount: String(discount),
  gross: String(gross), cost: cost === null ? null : String(cost), costed: costed === null ? null : String(costed), day: "2026-10-01", hour: 12, dow: 4,
});

test("net sales, tax and cost follow how Mangalli totals an order", () => {
  // A real order: items 69.000, discount 31.050, 10% tax -> paid 41.745.
  const money = sumMoney([order(41_745, 69_000, 31_050, 20_000, 69_000), order(30_800, 28_000)]);
  assert.equal(money.gross, 97_000);
  assert.equal(money.discounts, 31_050);
  assert.equal(money.net, 37_950 + 28_000);
  assert.equal(Math.round(money.tax), 3_795 + 2_800);
  assert.equal(money.collected, 72_545);
  assert.equal(money.cost, 20_000);
  // Only the first order has a cost: its share of net sales is covered.
  assert.equal(Math.round(money.costedNet), 37_950);
});

test("previous period has the same length and ends the day before", () => {
  assert.deepEqual(previousPeriod({ from: "2026-09-05", to: "2026-10-04" }), { from: "2026-08-06", to: "2026-09-04" });
  assert.deepEqual(previousPeriod({ from: "2026-10-04", to: "2026-10-04" }), { from: "2026-10-03", to: "2026-10-03" });
});

test("change is a rounded percent and unknown without a previous value", () => {
  assert.equal(change(112, 100), 12);
  assert.equal(change(80, 100), -20);
  assert.equal(change(50, 0), null);
});
