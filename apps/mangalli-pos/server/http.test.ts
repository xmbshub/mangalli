import assert from "node:assert/strict";
import test from "node:test";

import { attachment } from "./http";

// Insiden 5 Okt 2026: nama file Ask Eline berisi "–" membuat header unduhan
// tidak sah (bukan ByteString) dan rute menjawab JSON galat.
test("download headers stay valid for names with dashes and accents", () => {
  for (const name of ["Sales report 1 Oct 2026 – 4 Oct 2026.pdf", 'Laporan Kopi Senja — Café "Rina".xlsx']) {
    const header = attachment(name);
    assert.doesNotThrow(() => new Response("x", { headers: { "content-disposition": header } }));
    assert.match(header, /filename="[\x20-\x7e]+"/);
    assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent(name)}`));
  }
  assert.equal(attachment("Sales report 1 Oct 2026 – 4 Oct 2026.pdf").split(";")[1].trim(), 'filename="Sales report 1 Oct 2026 - 4 Oct 2026.pdf"');
});
