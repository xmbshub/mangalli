import assert from "node:assert/strict";
import test from "node:test";

import { openingStatus, type OpeningHour } from "./opening-hours";

const every = (open: string, close: string): OpeningHour[] =>
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((key) => ({ key, is_open: true, open_time: open, close_time: close }));
// 26 Sep 2026 adalah Sabtu; Asia/Makassar = UTC+8.
const at = (local: string) => new Date(`${local}+08:00`);

test("overnight hours like a café's 07:00-05:00 stay open past midnight and close 05:00-07:00", () => {
  const cafe = every("07:00", "05:00");
  assert.equal(openingStatus(cafe, at("2026-09-26T23:30:00"), "Asia/Makassar").open, true);
  assert.equal(openingStatus(cafe, at("2026-09-27T02:00:00"), "Asia/Makassar").open, true);
  const early = openingStatus(cafe, at("2026-09-27T06:00:00"), "Asia/Makassar");
  assert.equal(early.open, false);
  assert.equal(early.label, "Closed now · opens at 07:00");
});

test("closed days, same-day windows, and no schedule", () => {
  const weekdaysOnly = every("08:00", "17:00").map((hour) => (hour.key === "saturday" || hour.key === "sunday" ? { ...hour, is_open: false } : hour));
  assert.equal(openingStatus(weekdaysOnly, at("2026-09-28T12:00:00"), "Asia/Makassar").open, true);
  assert.equal(openingStatus(weekdaysOnly, at("2026-09-28T17:00:00"), "Asia/Makassar").open, false);
  assert.equal(openingStatus(weekdaysOnly, at("2026-09-26T12:00:00"), "Asia/Makassar").label, "Closed now · opens Monday at 08:00");
  assert.equal(openingStatus([], at("2026-09-26T03:00:00"), "Asia/Makassar").open, true);
});
