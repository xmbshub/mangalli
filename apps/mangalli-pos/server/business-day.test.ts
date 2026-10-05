import assert from "node:assert/strict";
import test from "node:test";

import { businessWindow, dueDates, localNow } from "./business-day";

const week = (open: string, close: string, closedOn = "") =>
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((key) => ({ key, is_open: key !== closedOn, open_time: open, close_time: close }));

test("overnight hours like a café's 07:00-05:00 run to the next morning and send at 05:30", () => {
  // 3 Oct 2026 is a Saturday.
  assert.deepEqual(businessWindow(week("07:00", "05:00"), "2026-10-03"), { start: "2026-10-03 07:00", end: "2026-10-04 05:00", sendAt: "2026-10-04 05:30", open: true });
});

test("same-day hours cover the calendar day and send 30 minutes after closing", () => {
  assert.deepEqual(businessWindow(week("09:00", "22:00"), "2026-10-03"), { start: "2026-10-03 00:00", end: "2026-10-04 00:00", sendAt: "2026-10-03 22:30", open: true });
});

test("a closed day or no schedule sends at 23:30; 24-hour days send after midnight", () => {
  assert.equal(businessWindow(week("09:00", "22:00", "saturday"), "2026-10-03").sendAt, "2026-10-03 23:30");
  assert.equal(businessWindow([], "2026-10-03").open, false);
  assert.equal(businessWindow(week("00:00", "00:00"), "2026-10-03").sendAt, "2026-10-04 00:30");
});

test("local time is written in the outlet timezone", () => {
  assert.equal(localNow(new Date("2026-10-03T21:45:00Z"), "Asia/Makassar"), "2026-10-04 05:45");
});

test("a report is due once its send time has passed, but never for days older than 18 hours", () => {
  const cafe = week("07:00", "05:00");
  // 4 Oct 05:45: Saturday 3 Oct (sent at 05:30) is due; Sunday isn't yet.
  assert.deepEqual(dueDates(cafe, "2026-10-04 05:45"), ["2026-10-03"]);
  assert.deepEqual(dueDates(cafe, "2026-10-04 05:10"), []);
  // A shop closing at 22:00: today's report is due at 22:30.
  assert.deepEqual(dueDates(week("09:00", "22:00"), "2026-10-03 22:40"), ["2026-10-03"]);
  // Deployed the next afternoon: yesterday 22:30 is more than 18 hours ago.
  assert.deepEqual(dueDates(week("09:00", "22:00"), "2026-10-04 17:00"), []);
});
