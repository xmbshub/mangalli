import assert from "node:assert/strict";
import test from "node:test";

import { hash } from "bcryptjs";

import { hashPin, pinPattern, verifyPin } from "./pin";

test("approval PIN hashes verify only the same PIN, in the format the tablet reads", async () => {
  const stored = hashPin("482913");
  assert.match(stored, /^pbkdf2-sha256\$120000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(stored, hashPin("482913"));
  assert.equal(await verifyPin("482913", stored), true);
  assert.equal(await verifyPin("482914", stored), false);
  assert.equal(await verifyPin("482913", "garbage"), false);
});

test("legacy bcrypt PINs still verify, and PINs are exactly 6 digits", async () => {
  assert.equal(await verifyPin("1234", await hash("1234", 4)), true);
  assert.ok(pinPattern.test("012345"));
  assert.ok(!pinPattern.test("12345") && !pinPattern.test("1234567") && !pinPattern.test("12a456"));
});
