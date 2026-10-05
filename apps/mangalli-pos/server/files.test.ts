import assert from "node:assert/strict";
import test from "node:test";

import { buildPdf } from "./pdf";
import { buildXlsx } from "./xlsx";
import { unzip, zip } from "./zip";

test("xlsx is a zip with one worksheet per sheet and safe sheet names", () => {
  const file = buildXlsx([
    { name: "Summary", columns: [{ header: "Item" }, { header: "Amount", kind: "money" }], rows: [["Sales & tax <test>", 1000]] },
    { name: "By day/[x]", columns: [{ header: "Date" }], rows: [["2026-10-01"]] },
  ]);
  const text = file.toString("latin1");
  assert.equal(file.subarray(0, 2).toString(), "PK");
  assert.match(text, /xl\/worksheets\/sheet2\.xml/);
  assert.match(text, /name="By day  x"/);
  assert.match(text, /Sales &amp; tax &lt;test&gt;/);
  assert.match(text, /&quot;Rp&quot;/);
});

test("pdf has every page, page numbers and WinAnsi text", () => {
  const file = buildPdf({ title: "Report", sections: [
    { kind: "table", heading: "Rows", columns: [{ header: "Name" }, { header: "Total", align: "right" }], rows: Array.from({ length: 90 }, (_, i) => [`Row ${i}`, `Rp ${i}`]) },
  ] });
  const text = file.toString("latin1");
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 3 >>/);
  assert.match(text, /startxref\n\d+\n%%EOF\n$/);
});

test("zip round-trips compressed and stored files and rejects damage", () => {
  const files = [{ name: "manifest.json", data: Buffer.from('{"format":"x"}') }, { name: "data/orders.json", data: Buffer.from("[" + "{\"a\":1},".repeat(500) + "{}]") }];
  for (const compress of [true, false]) {
    const read = unzip(zip(files, compress));
    assert.deepEqual([...read.keys()], files.map((file) => file.name));
    files.forEach((file) => assert.ok(read.get(file.name)?.equals(file.data)));
  }
  assert.throws(() => unzip(Buffer.from("not a zip at all, definitely not")), /Not a zip/);
  const damaged = zip(files, false);
  damaged[45] ^= 0xff; // isi manifest.json (header 30 + nama 13 byte)
  assert.throws(() => unzip(damaged), /Damaged/);
  assert.throws(() => unzip(zip(files, true), 100), /too large/);
});
