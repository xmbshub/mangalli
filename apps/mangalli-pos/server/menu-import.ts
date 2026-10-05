import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import { HttpError } from "./http";
import { audit } from "./pos";

// Impor menu dengan Eline: foto atau teks menu UMKM dibaca model lewat
// gateway Eline (9Router, combo eline-ruderalis (keputusan owner 26 Sep 2026), kunci khusus mangalli-app) dan
// menjadi draf katalog. Draf tidak pernah langsung tersimpan: owner memeriksa
// dan mengubahnya dulu, lalu server memvalidasi ulang sebelum menulis.

// Server self-host memakai gateway OpenAI-compatible sendiri (OpenAI, OpenRouter,
// Ollama…) lewat MANGALLI_ROUTER_URL/KEY/MODEL; produksi 1garis memakai default.
export const ELINE_MODEL = process.env.MANGALLI_ROUTER_MODEL?.trim() || "eline-ruderalis";
export const MAX_MENU_IMAGES = 6;
export const MAX_MENU_TEXT = 8000;

const PROMPT = `You turn photos or text of a restaurant or cafe menu into a structured catalogue for a point-of-sale system used by small Indonesian businesses.

Reply with ONE JSON object only, no prose, no markdown fences:
{"outletName": string|null, "categories": [{"name": string, "products": [{"name": string, "description": string|null, "price": integer|null, "optionGroups": [{"name": string, "required": boolean, "maxSelect": integer, "options": [{"name": string, "priceDelta": integer}]}], "confidence": "high"|"low", "note": string|null}]}], "warnings": [string]}

Rules:
1. Prices are whole rupiah integers. "Rp 15.000" = 15000. "15k", "15rb", "15K" = 15000. If the menu says prices are in thousands ("dalam ribuan", "x1000", "(000)") or all prices are small numbers like 5, 18, 25 on a food menu, multiply by 1000.
2. Never invent products, prices, or options that are not on the menu. If a price cannot be read, set price to null, confidence "low", and explain in note.
3. Several prices for one item mean a choice. "5 / 7" with "Reg / Jumbo" becomes price 5000 plus a required group "Size" (maxSelect 1) with options Reg +0 and Jumbo +2000. Hot/Ice with different prices works the same way (group "Temperature"). If the choices cost the same, still make the required group with +0.
4. Add-ons written next to an item ("saus keju +3") become an optional group "Add-ons" with maxSelect equal to the number of options.
5. Add-ons or levels that apply to several items ("Tambahan untuk semua makanan", "Level pedas 0-5") must be copied into EVERY product they apply to, and only those. Levels become a required single choice group with one option per level ("Level 0" ... "Level 5"), priceDelta 0 unless a price is shown.
6. Keep product and category names as written on the menu (fix obvious photo/OCR errors only), in Title Case. Use the menu's own section headings as categories; if there are none, create clear categories in the menu's language.
7. description: a short phrase only from what the menu says (e.g. "Telur ceplok dan kerupuk"). null if the menu says nothing.
8. confidence "low" whenever a name, price, or option is uncertain; add a note saying what to check.
9. warnings: anything the owner should double check (blurry area, cut-off page, unclear price unit). Write notes and warnings in the menu's language.`;

const text = (max: number) => z.string().trim().min(1).max(max);
const rupiah = z.number().int().min(0).max(100_000_000);

const optionSchema = z.object({ name: text(80), priceDelta: rupiah });
const groupSchema = z.object({
  name: text(60),
  required: z.boolean(),
  maxSelect: z.number().int().min(1).max(20),
  options: z.array(optionSchema).min(1).max(30),
});
const productSchema = z.object({
  name: text(120),
  description: z.string().trim().max(300).nullable(),
  price: rupiah.nullable(),
  optionGroups: z.array(groupSchema).max(10),
  confidence: z.enum(["high", "low"]),
  note: z.string().trim().max(300).nullable(),
});
export const menuDraftSchema = z.object({
  outletName: z.string().trim().max(120).nullable(),
  categories: z.array(z.object({ name: text(60), products: z.array(productSchema).max(150) })).max(40),
  warnings: z.array(z.string().trim().max(300)).max(20),
});
export type MenuDraft = z.infer<typeof menuDraftSchema>;

// Jawaban model dirapikan sebelum divalidasi: angka dibulatkan, nama opsi
// ganda dibuang, maxSelect disesuaikan jumlah opsi, kategori kosong dilewati.
function normalize(raw: unknown): MenuDraft {
  const source = (raw ?? {}) as Record<string, unknown>;
  const int = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null);
  const str = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const categories = (Array.isArray(source.categories) ? source.categories : []).map((category: Record<string, unknown>) => ({
    name: str(category?.name, 60) ?? "Menu",
    products: (Array.isArray(category?.products) ? category.products : []).flatMap((product: Record<string, unknown>) => {
      const name = str(product?.name, 120);
      if (!name) return [];
      const groups = (Array.isArray(product.optionGroups) ? product.optionGroups : []).flatMap((group: Record<string, unknown>) => {
        const seen = new Set<string>();
        const options = (Array.isArray(group?.options) ? group.options : []).flatMap((option: Record<string, unknown>) => {
          const optionName = str(option?.name, 80);
          if (!optionName || seen.has(optionName.toLowerCase())) return [];
          seen.add(optionName.toLowerCase());
          return [{ name: optionName, priceDelta: int(option.priceDelta) ?? 0 }];
        }).slice(0, 30);
        const groupName = str(group?.name, 60);
        if (!groupName || !options.length) return [];
        const required = group.required === true;
        const maxSelect = Math.min(options.length, Math.max(1, int(group.maxSelect) ?? (required ? 1 : options.length)));
        return [{ name: groupName, required, maxSelect, options }];
      }).slice(0, 10);
      const price = int(product.price);
      return [{
        name,
        description: str(product.description, 300),
        price,
        optionGroups: groups,
        confidence: price === null || product.confidence === "low" ? "low" as const : "high" as const,
        note: str(product.note, 300) ?? (price === null ? "Price not found on the menu." : null),
      }];
    }).slice(0, 150),
  })).filter((category) => category.products.length).slice(0, 40);
  return menuDraftSchema.parse({
    outletName: str(source.outletName, 120),
    categories,
    warnings: (Array.isArray(source.warnings) ? source.warnings : []).flatMap((warning) => (typeof warning === "string" && warning.trim() ? [warning.trim().slice(0, 300)] : [])).slice(0, 20),
  });
}

function firstJsonObject(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "Eline couldn't read a menu from these files. Try clearer photos.");
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "Eline's answer was incomplete. Try again, or split the menu into fewer photos.");
  }
}

export async function readMenu(input: { images: Array<{ contentType: string; bytes: Uint8Array }>; text: string }): Promise<{ draft: MenuDraft; model: string | null; seconds: number }> {
  const baseUrl = process.env.MANGALLI_ROUTER_URL;
  const apiKey = process.env.MANGALLI_ROUTER_KEY;
  if (!baseUrl || !apiKey) throw new HttpError(503, "Menu import with Eline isn't set up on this server yet.");
  if (!input.images.length && !input.text.trim()) throw new HttpError(422, "Add a photo of the menu or paste the menu text.");

  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: input.images.length ? `Read this menu (${input.images.length} photo${input.images.length > 1 ? "s" : ""}, in page order).${input.text.trim() ? `\n\nExtra notes or text from the owner:\n${input.text.trim()}` : ""}` : `Read this menu text:\n${input.text.trim()}`,
  }];
  for (const image of input.images) {
    content.push({ type: "image_url", image_url: { url: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}` } });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 170_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      // stream wajib eksplisit: gateway menganggap permintaan tanpa `stream`
      // sebagai streaming dan menjawab text/event-stream (insiden 4 Okt 2026).
      body: JSON.stringify({ model: ELINE_MODEL, temperature: 0, stream: false, messages: [{ role: "system", content: PROMPT }, { role: "user", content }] }),
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(504, "Eline took too long to read the menu. Try again with fewer photos.");
  } finally {
    clearTimeout(timer);
  }
  const body = await response.text();
  const json = (() => { try { return JSON.parse(body) as { model?: string; choices?: Array<{ message?: { content?: string } }> }; } catch { return null; } })();
  const answer = json?.choices?.[0]?.message?.content;
  if (!response.ok || typeof answer !== "string") {
    // Status saja tidak cukup: 200 dengan isi yang salah bentuk (misal SSE)
    // dulu tercatat sebagai "error 200" tanpa petunjuk.
    console.error("menu import gateway error", response.status, response.headers.get("content-type"), JSON.stringify(body.slice(0, 200)));
    throw new HttpError(502, response.ok ? "Eline's answer couldn't be read. Try again in a minute." : "Eline is busy right now. Try again in a minute.");
  }
  const draft = normalize(firstJsonObject(answer));
  if (!draft.categories.length) throw new HttpError(422, "Eline didn't find any menu items. Use a sharper photo that shows names and prices.");
  return { draft, model: json?.model ?? null, seconds: Math.round((Date.now() - started) / 1000) };
}

// Menyimpan draf yang sudah diperiksa owner. Kategori dipakai ulang bila
// namanya sama; produk yang namanya sudah ada di outlet dilewati, bukan ditimpa.
export async function importMenu(client: PoolClient, input: { outletKey: string; actorId: string; draft: MenuDraft }) {
  const existingCategories = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM categories WHERE outlet_key=$1", [input.outletKey]);
  const categoryIds = new Map(existingCategories.rows.map((row) => [row.name.toLowerCase(), row.id]));
  const existingProducts = await client.query<{ name: string }>("SELECT name FROM products WHERE outlet_key=$1", [input.outletKey]);
  const productNames = new Set(existingProducts.rows.map((row) => row.name.toLowerCase()));
  const order = await client.query<{ categories: number; products: number }>(
    `SELECT (SELECT coalesce(max(sort_order),0) FROM categories WHERE outlet_key=$1)::int AS categories,
            (SELECT coalesce(max(sort_order),0) FROM products WHERE outlet_key=$1)::int AS products`, [input.outletKey]);
  let categorySort = order.rows[0].categories;
  let productSort = order.rows[0].products;
  const counts = { categories: 0, products: 0, groups: 0, options: 0, skipped: [] as string[] };

  for (const category of input.draft.categories) {
    let categoryId = categoryIds.get(category.name.toLowerCase());
    for (const product of category.products) {
      if (productNames.has(product.name.toLowerCase())) {
        counts.skipped.push(product.name);
        continue;
      }
      if (product.price === null) throw new HttpError(422, `Add a price for ${product.name} before importing.`);
      if (!categoryId) {
        categorySort += 1;
        const created = await client.query<{ id: string }>(
          "INSERT INTO categories(outlet_key,name,sort_order) VALUES ($1,$2,$3) RETURNING id::text", [input.outletKey, category.name, categorySort]);
        categoryId = created.rows[0].id;
        categoryIds.set(category.name.toLowerCase(), categoryId);
        counts.categories += 1;
      }
      productSort += 1;
      const id = randomUUID();
      await client.query(
        `INSERT INTO products(id,outlet_key,category_id,name,description,price,availability,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,'available',$7)`,
        [id, input.outletKey, categoryId, product.name, product.description, product.price, productSort]);
      productNames.add(product.name.toLowerCase());
      counts.products += 1;
      for (const [groupIndex, group] of product.optionGroups.entries()) {
        const minSelect = group.required ? 1 : 0;
        const created = await client.query<{ id: string }>(
          `INSERT INTO product_modifier_groups(product_id,name,is_required,min_select,max_select,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text`,
          [id, group.name, group.required, minSelect, Math.max(minSelect, Math.min(group.maxSelect, group.options.length)), groupIndex]);
        counts.groups += 1;
        for (const [optionIndex, option] of group.options.entries()) {
          await client.query(
            "INSERT INTO product_modifier_options(group_id,name,price_delta,is_available,sort_order) VALUES ($1,$2,$3,true,$4)",
            [created.rows[0].id, option.name, option.priceDelta, optionIndex]);
          counts.options += 1;
        }
      }
    }
  }
  if (!counts.products) throw new HttpError(422, counts.skipped.length ? "Every product is already on your menu." : "Choose at least one product to import.");
  await audit(client, {
    outletKey: input.outletKey, actorId: input.actorId, action: "menu.imported", type: "product",
    summary: `Imported ${counts.products} products in ${input.draft.categories.length} categories with Eline (${counts.groups} option groups).`,
    metadata: { ...counts, skipped: counts.skipped.slice(0, 50) },
  });
  return counts;
}
