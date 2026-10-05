import assert from "node:assert/strict";
import test from "node:test";

import { crc16, dynamicQris, normalizeStaticQris, qrisMerchantName } from "./qris";

function staticSample() {
  const body = "000201010211" + "26400014ID.CO.QRIS.WWW0118936009150000000001" + "5204581253033605802ID5906WARUNG6008MAKASSAR" + "6304";
  return `${body}${crc16(body)}`;
}

test("CRC16 follows the CCITT-FALSE variant used by QRIS", () => {
  assert.equal(crc16("123456789"), "29B1");
});

test("static QRIS is validated before it is stored", () => {
  assert.equal(normalizeStaticQris(` ${staticSample()} `), staticSample());
  assert.equal(qrisMerchantName(staticSample()), "WARUNG");
  assert.throws(() => normalizeStaticQris(`${staticSample().slice(0, -4)}0000`), /checksum/);
  assert.throws(() => normalizeStaticQris("hello"), /Invalid QRIS code/);
});

test("dynamic QRIS carries the exact amount and a fresh checksum", () => {
  const payload = dynamicQris(staticSample(), 38_527);
  assert.match(payload, /^000201010212/);
  assert.ok(payload.includes("540538527"));
  assert.ok(payload.indexOf("5303360") < payload.indexOf("540538527"));
  assert.ok(payload.indexOf("540538527") < payload.indexOf("5802ID"));
  assert.equal(normalizeStaticQris(payload), payload);
  assert.equal(dynamicQris(payload, 1_000).includes("54041000"), true);
  assert.throws(() => dynamicQris(staticSample(), 0), /Invalid QRIS amount/);
});
