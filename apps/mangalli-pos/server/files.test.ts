import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

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

// Insiden 13 Okt 2026: kode pesanan, tanggal, dan nama kasir di PDF terpotong menjadi "DM0905-…".
test("pdf tables fit their content: wide tables turn landscape and long text wraps instead of being cut", () => {
  const file = buildPdf({ title: "Orders", sections: [{
    kind: "table", heading: "Orders",
    columns: [{ header: "Code" }, { header: "Date & time" }, { header: "Service" }, { header: "Customer" }, { header: "Cashier" }, { header: "Status" }, { header: "Payment" }, { header: "Total", align: "right" }],
    rows: [["DM0905-0620", "5 Sep 2026, 08:51", "Dine in · Table 12", "Ibu Sekar Ayu Paramitha Wulandari", "Rina Pratiwi", "Awaiting payment", "QRIS", "Rp 1.107.800"]],
    total: ["1 orders", "", "", "", "", "", "Paid", "Rp 1.107.800"],
  }] });
  const raw = file.toString("latin1");
  assert.match(raw, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((match) => inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")).join("\n");
  const shown = [...streams.matchAll(/<([0-9a-f]+)> Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join(" ");
  for (const value of ["DM0905-0620", "5 Sep 2026, 08:51", "Rina Pratiwi", "Awaiting payment", "Rp 1.107.800", "Wulandari"]) assert.ok(shown.includes(value), value);
  assert.ok(!shown.includes("\x85"), "no ellipsis");
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
