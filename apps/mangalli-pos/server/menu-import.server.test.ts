import assert from "node:assert/strict";
import test from "node:test";

import { readMenu } from "./menu-import";

// Insiden 4 Okt 2026: tanpa `stream` gateway menjawab text/event-stream, impor
// menu gagal dengan "Eline is busy" untuk outlet baru.
test("menu import asks the gateway for one JSON answer and reads it", async () => {
  process.env.MANGALLI_ROUTER_URL = "http://router.test/v1";
  process.env.MANGALLI_ROUTER_KEY = "test-key";
  const sent: Array<Record<string, unknown>> = [];
  const draft = { outletName: "Seblak", categories: [{ name: "Seblak", products: [{ name: "Seblak Original", description: null, price: 15000, confidence: "high", note: null,
    optionGroups: [{ name: "Level Pedas", required: true, maxSelect: 1, options: [{ name: "Level 0", priceDelta: 0 }, { name: "Level 5", priceDelta: 0 }] }] }] }], warnings: [] };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: JSON.stringify(draft) } }] }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const result = await readMenu({ images: [], text: "Seblak Original 15k, level 0-5" });
    assert.equal(sent[0].stream, false);
    assert.equal(result.draft.categories[0].products[0].optionGroups[0].options.length, 2);

    globalThis.fetch = (async () => new Response("data: {\"object\":\"chat.completion.chunk\"}\n\n", { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const errors: unknown[][] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      await assert.rejects(readMenu({ images: [], text: "x" }), /couldn't be read/);
    } finally {
      console.error = log;
    }
    assert.ok(errors.some((args) => args.includes("text/event-stream")));
  } finally {
    globalThis.fetch = original;
  }
});
