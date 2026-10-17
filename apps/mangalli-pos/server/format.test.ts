import assert from "node:assert/strict";
import test from "node:test";

import { elapsedLabel } from "./format";

// Sama dengan elapsedLabel di APK (ui/Models.kt): kartu Kitchen tidak lagi menulis "4496 min".
test("elapsedLabel matches the tablet wording", () => {
  assert.equal(elapsedLabel(0), "Just now");
  assert.equal(elapsedLabel(12), "12 min");
  assert.equal(elapsedLabel(125), "2 h 5 min");
  assert.equal(elapsedLabel(4496), "3 d 2 h");
});
