import assert from "node:assert/strict";
import test from "node:test";

import { canTransition, legacyStatus, normalizeStatus, statusLabel } from "./workflow";

test("restaurant workflow accepts only forward operational transitions", () => {
  assert.equal(canTransition("new", "accepted"), true);
  assert.equal(canTransition("accepted", "preparing"), true);
  assert.equal(canTransition("preparing", "ready"), true);
  assert.equal(canTransition("ready", "completed"), true);
  assert.equal(canTransition("completed", "new"), false);
  assert.equal(canTransition("cancelled", "accepted"), false);
});

test("legacy state and labels remain Android compatible", () => {
  assert.equal(normalizeStatus("unexpected"), "new");
  assert.equal(legacyStatus("ready"), "pending");
  assert.equal(legacyStatus("completed"), "completed");
  assert.equal(statusLabel("preparing"), "Orders In Progress");
});

test("unpaid digital menu orders cannot be moved into the kitchen by a status button", () => {
  assert.equal(normalizeStatus("pending_payment"), "pending_payment");
  for (const next of ["new", "accepted", "preparing", "ready", "completed"] as const) {
    assert.equal(canTransition("pending_payment", next), false);
  }
  assert.equal(legacyStatus("pending_payment"), "pending");
});
