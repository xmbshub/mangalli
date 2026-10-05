"use server";

import { hash } from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";

import { createOperatorSession, outletCookie, requireWebOperator, verifyStaffCredentials } from "@/server/auth";
import { pool, transaction } from "@/server/db";
import { HttpError, type FormState } from "@/server/http";
import { hashPin, pinPattern, verifyPin } from "@/server/pin";
import { normalizeCoupon } from "@/server/promotion-rules";
import { expenseCategories, type ExpenseCategory } from "@/server/reports";
import { sendDailyReport } from "@/server/daily-report";
import { assertMenuEditable, createBranch, menuChanged, menuMode } from "@/server/branches";
import { availableStockSql } from "@/server/stock";
import { audit, canTransition, formatIdr, legacyStatus, normalizeStatus, opaqueToken, refundIfPaid, restaurantStatuses } from "@/server/pos";
import { cancelUnpaidMenuOrder, markMenuOrderPaid, menuPaymentMethods } from "@/server/menu-orders";
import { normalizeStaticQris, qrisMerchantName } from "@/server/qris";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";
import { recordReport, reportCategories, type ReportCategory } from "@/server/support";
import { checkStepUpPin, endStepUp, grantStepUp, requireStepUp, STEP_UP_MINUTES } from "@/server/step-up";
import { importMenu, menuDraftSchema } from "@/server/menu-import";

// Semua aksi dashboard mengembalikan FormState supaya form menampilkan hasil
// atau kesalahan di tempat, bukan halaman error. Setiap perubahan tetap
// dibatasi outlet operator di klausa WHERE.

function text(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim();
}

function number(data: FormData, name: string) {
  return Number(data.get(name) ?? 0);
}

async function operator(roles?: Array<"owner" | "manager" | "staff" | "viewer">) {
  return requireWebOperator(await headers(), roles);
}

// Gambar: URL unggahan R2/https, atau path aplikasi lama (/images/...).
const imageLink = /^(https:\/\/|\/(?!\/))\S+$/;

function fail(message: string): never {
  throw new HttpError(422, message);
}

async function run(paths: string[], work: () => Promise<string | { message: string; href: string }>): Promise<FormState> {
  try {
    const result = await work();
    paths.forEach((path) => revalidatePath(path));
    return typeof result === "string" ? { ok: true, message: result } : { ok: true, ...result };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HttpError) {
      if (error.status === 401 || error.status === 403) return { ok: false, message: "Your session expired or you don't have access. Reload the page." };
      if (error.status === 429) return { ok: false, message: "Too many attempts. Wait a moment and try again." };
      return { ok: false, message: error.message };
    }
    if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Please complete the form." };
    if ((error as { code?: string }).code === "23505") return { ok: false, message: "Something with the same name or code already exists." };
    console.error(error);
    await reportUnexpected(error, paths[0] ?? "/admin");
    return { ok: false, message: "Couldn't save. Please try again. The problem was reported." };
  }
}

// Aksi menu: struktur (kategori, produk baru/hapus, opsi, impor) ditolak di
// cabang selain cabang utama; setelah berhasil di cabang utama, perubahan
// disalin ke semua cabang brand (server/branches.ts).
async function menuRun(paths: string[], work: () => Promise<string | { message: string; href: string }>, structural = true): Promise<FormState> {
  return run(paths, async () => {
    const user = await operator(["owner", "manager"]);
    if (structural) await assertMenuEditable(user.outletKey);
    const result = await work();
    const note = await menuChanged(user.outletKey);
    if (!note) return result;
    return typeof result === "string" ? `${result} ${note}` : { ...result, message: `${result.message} ${note}` };
  });
}

// Galat tak terduga di dashboard otomatis menjadi laporan masalah (digabung per
// halaman + pesan), supaya tidak hanya tersimpan di log container.
async function reportUnexpected(error: unknown, path: string) {
  try {
    const user = await operator();
    const message = error instanceof Error ? error.message : String(error);
    await recordReport(pool, {
      outletKey: user.outletKey, source: "dashboard", category: "error", title: `Couldn't save on ${path.replace("/admin/", "")}`,
      message: message.slice(0, 500), fingerprint: `dashboard:${path}:${message.slice(0, 80)}`, reportedBy: user.id,
    });
  } catch {
    // Pelaporan tidak boleh menggagalkan respons ke pengguna.
  }
}

export async function loginAction(_state: FormState, data: FormData): Promise<FormState> {
  const state = await run([], async () => {
    const input = z.object({ email: z.email("Enter a valid email."), password: z.string().min(1, "Password is required."), outletKey: z.string().min(1, "Outlet is required.") }).parse({
      email: text(data, "email"), password: text(data, "password"), outletKey: text(data, "outletKey"),
    });
    const requestHeaders = await headers();
    await enforceRateLimit(pool, rateLimitKey("web-login", requestHeaders, `${input.outletKey}:${input.email}`), 10, 60);
    const user = await verifyStaffCredentials(pool, input).catch((error) => {
      if (error instanceof HttpError && error.status === 422) fail("Outlet, email, or password is incorrect.");
      throw error;
    });
    const token = await createOperatorSession({ id: user.id, outletKey: input.outletKey, name: user.name, email: user.email, role: user.pos_role });
    (await cookies()).set("mangalli_pos_session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 43_200 });
    return "Signed in.";
  });
  if (state?.ok) redirect("/admin/dashboard");
  return state;
}

export async function logoutAction() {
  (await cookies()).set("mangalli_pos_session", "", { path: "/", maxAge: 0 });
  redirect("/login");
}

// ---------- Katalog ----------

export async function saveCategoryAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/categories", "/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const id = text(data, "id");
    const name = text(data, "name");
    if (!name) fail("Category name is required.");
    if (id) {
      const result = await pool.query("UPDATE categories SET name=$1,sort_order=$2,updated_at=now() WHERE id=$3 AND outlet_key=$4", [name, number(data, "sortOrder"), id, user.outletKey]);
      if (!result.rowCount) fail("Category not found.");
      return "Category updated.";
    }
    await pool.query("INSERT INTO categories(outlet_key,name,sort_order) VALUES ($1,$2,$3)", [user.outletKey, name, number(data, "sortOrder")]);
    return "Category added.";
  });
}

export async function deleteCategoryAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/categories"], async () => {
    const user = await operator(["owner", "manager"]);
    const result = await pool.query(
      "DELETE FROM categories c WHERE c.id=$1 AND c.outlet_key=$2 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id) RETURNING name",
      [text(data, "id"), user.outletKey],
    );
    if (!result.rowCount) fail("This category still has products. Move them to another category first.");
    await pool.query("UPDATE promotions SET category_ids=array_remove(category_ids,$1::bigint),updated_at=now() WHERE outlet_key=$2 AND $1::bigint=ANY(category_ids)", [text(data, "id"), user.outletKey]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "category.deleted", type: "category", id: text(data, "id"), summary: `Category ${result.rows[0].name} deleted.` });
    return "Category deleted.";
  });
}

export async function saveProductAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    if ((await menuMode(user.outletKey)).kind === "branch") return saveBranchProduct(user, data);
    const editing = text(data, "id");
    const id = editing || `menu_${Date.now().toString(36)}`;
    const name = text(data, "name");
    const categoryId = text(data, "categoryId");
    const price = number(data, "price");
    const imageUrl = text(data, "imageUrl");
    const availability = text(data, "availability") || "available";
    const costText = text(data, "costPrice");
    const costPrice = costText ? Number(costText) : null;
    if (!name) fail("Product name is required.");
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0 || costPrice > 100_000_000)) fail("Enter a valid cost, or leave it empty.");
    if (!categoryId) fail("Choose a category.");
    if (!Number.isFinite(price) || price < 0) fail("Enter a valid price.");
    if (!["available", "unavailable", "hidden"].includes(availability)) fail("Invalid product status.");
    if (imageUrl && (imageUrl.length > 2048 || !imageLink.test(imageUrl))) fail("Use an uploaded image or a link starting with https://");
    // Stok: angka yang diisi = jumlah di tangan sekarang (dihitung ulang dari saat ini).
    const trackStock = data.get("trackStock") === "on";
    const stockText = text(data, "stock");
    const stock = Number(stockText);
    if (trackStock && (!stockText || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000)) fail("Enter the units in stock now, for example 20.");
    await transaction(async (client) => {
      const before = editing
        ? (await client.query<{ name: string; price: string; cost_price: string | null }>("SELECT name, price::text, cost_price::text FROM products WHERE id=$1 AND outlet_key=$2", [id, user.outletKey])).rows[0]
        : undefined;
      const product = await client.query(
        `INSERT INTO products(id,outlet_key,category_id,name,description,price,availability,sort_order,is_best_seller,is_people_love_this,cost_price)
         SELECT $1,$2,c.id,$3,$4,$5,$6,$7,$8,$9,$11 FROM categories c WHERE c.id=$10 AND c.outlet_key=$2
         ON CONFLICT (id) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,description=EXCLUDED.description,
           price=EXCLUDED.price,availability=EXCLUDED.availability,sort_order=EXCLUDED.sort_order,cost_price=EXCLUDED.cost_price,
           is_best_seller=EXCLUDED.is_best_seller,is_people_love_this=EXCLUDED.is_people_love_this,updated_at=now()
         WHERE products.outlet_key=EXCLUDED.outlet_key RETURNING id`,
        [id, user.outletKey, name, text(data, "description") || null, price, availability,
          number(data, "sortOrder"), data.get("isBestSeller") === "on", data.get("isPeopleLoveThis") === "on", categoryId, costPrice],
      );
      if (!product.rowCount) fail("Product or category not found in this outlet.");
      // Harga adalah uang: setiap produk baru dan perubahan harga tercatat.
      if (!before) {
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.created", type: "product", id, summary: `${name} added at ${formatIdr(price)}.` });
      } else if (Number(before.price) !== price) {
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.price_changed", type: "product", id,
          summary: `${name} price ${formatIdr(Number(before.price))} → ${formatIdr(price)}.`, metadata: { from: Number(before.price), to: price } });
      }
      // Harga modal menentukan laba di laporan, jadi perubahannya juga tercatat.
      const costBefore = before?.cost_price === null || before?.cost_price === undefined ? null : Number(before.cost_price);
      if (before && costBefore !== costPrice) {
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.cost_changed", type: "product", id,
          summary: `${name} cost ${costBefore === null ? "not set" : formatIdr(costBefore)} → ${costPrice === null ? "not set" : formatIdr(costPrice)}.`, metadata: { from: costBefore, to: costPrice } });
      }
      if (data.has("stockField")) {
        const was = (await client.query<{ stock: number | null }>(`SELECT ${availableStockSql("p")} AS stock FROM products p WHERE p.id=$1`, [id])).rows[0]?.stock ?? null;
        const now = trackStock ? stock : null;
        if (was === null ? now !== null : now === null || Number(was) !== now) {
          await client.query("UPDATE products SET stock_quantity=$1, stock_counted_at=CASE WHEN $1::int IS NULL THEN NULL ELSE now() END, updated_at=now() WHERE id=$2 AND outlet_key=$3", [now, id, user.outletKey]);
          await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.stock_set", type: "product", id,
            summary: now === null ? `${name}: stock no longer tracked.` : `${name}: stock ${was === null ? "set" : `${Math.max(0, Number(was))} →`} ${now}${was === null ? " (now tracked)" : ""}.` });
        }
      }
      const current = await client.query<{ url: string }>("SELECT url FROM product_photos WHERE product_id=$1 AND is_primary=true", [id]);
      if ((current.rows[0]?.url ?? "") !== imageUrl) {
        await client.query("DELETE FROM product_photos WHERE product_id=$1 AND is_primary=true", [id]);
        if (imageUrl) await client.query("INSERT INTO product_photos(product_id,url,is_primary) VALUES ($1,$2,true)", [id, imageUrl]);
      }
    });
    // Produk baru langsung dibuka dalam mode edit supaya modifier bisa ditambahkan.
    return editing ? `${name} saved.` : `${name} added. Open it to add options like size or toppings.`;
  }, false);
}

// Produk di cabang selain cabang utama: hanya harga khusus (atau harga cabang
// utama), status, dan stok cabang ini. Bagian lain ikut cabang utama.
async function saveBranchProduct(user: Awaited<ReturnType<typeof operator>>, data: FormData) {
  const id = text(data, "id");
  const price = number(data, "price");
  const availability = text(data, "availability") || "available";
  if (!["available", "unavailable", "hidden"].includes(availability)) fail("Invalid product status.");
  if (!Number.isFinite(price) || price < 0) fail("Enter a valid price.");
  const trackStock = data.get("trackStock") === "on";
  const stockText = text(data, "stock");
  const stock = Number(stockText);
  if (trackStock && (!stockText || !Number.isInteger(stock) || stock < 0 || stock > 1_000_000)) fail("Enter the units in stock now, for example 20.");
  await transaction(async (client) => {
    const product = (await client.query<{ name: string; price: string; source_product_id: string | null }>(
      "SELECT name, price::text, source_product_id FROM products WHERE id=$1 AND outlet_key=$2", [id, user.outletKey])).rows[0];
    if (!product) fail("Add new products at the main branch; they appear here automatically.");
    const mainPrice = product.source_product_id
      ? Number((await client.query<{ price: string }>("SELECT price::text FROM products WHERE id=$1", [product.source_product_id])).rows[0]?.price ?? product.price)
      : Number(product.price);
    const newPrice = price;
    await client.query("UPDATE products SET price=$1, price_override=$2, availability=$3, updated_at=now() WHERE id=$4 AND outlet_key=$5",
      [newPrice, newPrice !== mainPrice, availability, id, user.outletKey]);
    if (Number(product.price) !== newPrice) {
      await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.price_changed", type: "product", id,
        summary: `${product.name} price ${formatIdr(Number(product.price))} → ${formatIdr(newPrice)}${newPrice === mainPrice ? " (main branch price)" : " (this branch)"}.`, metadata: { from: Number(product.price), to: newPrice } });
    }
    if (data.has("stockField")) {
      const was = (await client.query<{ stock: number | null }>(`SELECT ${availableStockSql("p")} AS stock FROM products p WHERE p.id=$1`, [id])).rows[0]?.stock ?? null;
      const now = trackStock ? stock : null;
      if (was === null ? now !== null : now === null || Number(was) !== now) {
        await client.query("UPDATE products SET stock_quantity=$1, stock_counted_at=CASE WHEN $1::int IS NULL THEN NULL ELSE now() END, updated_at=now() WHERE id=$2 AND outlet_key=$3", [now, id, user.outletKey]);
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.stock_set", type: "product", id,
          summary: now === null ? `${product.name}: stock no longer tracked.` : `${product.name}: stock set to ${now}.` });
      }
    }
  });
  return "Saved for this branch.";
}

export async function setProductAvailabilityAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const availability = text(data, "availability");
    if (!["available", "unavailable", "hidden"].includes(availability)) fail("Invalid product status.");
    const result = await pool.query("UPDATE products SET availability=$1,updated_at=now() WHERE id=$2 AND outlet_key=$3", [availability, text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Product not found.");
    return availability === "available" ? "Product is available." : "Product marked as sold out.";
  }, false);
}

// Riwayat pesanan menyimpan nama dan harga item, jadi produk boleh dihapus;
// order_items.product_id menjadi NULL dan promo produk ini dibersihkan.
export async function deleteProductAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products", "/admin/promotions"], async () => {
    const user = await operator(["owner", "manager"]);
    const id = text(data, "id");
    const name = await transaction(async (client) => {
      const result = await client.query<{ name: string; price: string }>("DELETE FROM products WHERE id=$1 AND outlet_key=$2 RETURNING name, price::text", [id, user.outletKey]);
      if (!result.rowCount) fail("Product not found.");
      await client.query("UPDATE promotions SET product_ids=array_remove(product_ids,$1),updated_at=now() WHERE outlet_key=$2 AND $1=ANY(product_ids)", [id, user.outletKey]);
      await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "product.deleted", type: "product", id,
        summary: `${result.rows[0].name} (${formatIdr(Number(result.rows[0].price))}) deleted.` });
      return result.rows[0].name;
    });
    return `${name} deleted. Past orders keep it.`;
  });
}

export async function saveModifierGroupAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const groupId = text(data, "groupId");
    const name = text(data, "name");
    const isRequired = data.get("isRequired") === "on";
    const maxSelect = Math.max(1, number(data, "maxSelect") || 1);
    const minSelect = isRequired ? 1 : 0;
    if (!name) fail("Group name is required, for example Size or Sugar level.");
    if (groupId) {
      const result = await pool.query(
        `UPDATE product_modifier_groups g SET name=$1,is_required=$2,min_select=$3,max_select=$4,updated_at=now()
         FROM products p WHERE g.id=$5 AND p.id=g.product_id AND p.outlet_key=$6`,
        [name, isRequired, minSelect, Math.max(maxSelect, minSelect), groupId, user.outletKey]);
      if (!result.rowCount) fail("Option group not found.");
      return "Option group saved.";
    }
    const result = await pool.query(
      `INSERT INTO product_modifier_groups(product_id,name,is_required,min_select,max_select,sort_order)
       SELECT p.id,$1,$2,$3,$4,(SELECT count(*) FROM product_modifier_groups g WHERE g.product_id=p.id)
       FROM products p WHERE p.id=$5 AND p.outlet_key=$6 RETURNING id`,
      [name, isRequired, minSelect, Math.max(maxSelect, minSelect), text(data, "productId"), user.outletKey],
    );
    if (!result.rowCount) fail("Product not found.");
    return "Option group added.";
  });
}

export async function deleteModifierGroupAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const result = await pool.query(
      "DELETE FROM product_modifier_groups g USING products p WHERE g.id=$1 AND p.id=g.product_id AND p.outlet_key=$2 RETURNING g.name, p.name AS product",
      [text(data, "groupId"), user.outletKey],
    );
    if (!result.rowCount) fail("Option group not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "product.options_deleted", type: "product",
      summary: `Option group ${result.rows[0].name} removed from ${result.rows[0].product}.` });
    return "Option group deleted.";
  });
}

export async function saveModifierOptionAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const optionId = text(data, "optionId");
    const name = text(data, "name");
    const priceDelta = number(data, "priceDelta");
    if (!name) fail("Option name is required.");
    if (!Number.isFinite(priceDelta) || priceDelta < 0) fail("Enter a valid extra price.");
    if (optionId) {
      const result = await pool.query<{ before: string; product: string }>(
        `WITH old AS (SELECT o.id, o.price_delta FROM product_modifier_options o WHERE o.id=$3)
         UPDATE product_modifier_options o SET name=$1,price_delta=$2,updated_at=now()
         FROM product_modifier_groups g, products p, old
         WHERE o.id=$3 AND old.id=o.id AND g.id=o.group_id AND p.id=g.product_id AND p.outlet_key=$4
         RETURNING old.price_delta::text AS before, p.name AS product`,
        [name, priceDelta, optionId, user.outletKey]);
      if (!result.rowCount) fail("Option not found.");
      const before = Number(result.rows[0].before);
      if (before !== priceDelta) {
        await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "product.price_changed", type: "product",
          summary: `${result.rows[0].product} · ${name} +${formatIdr(before)} → +${formatIdr(priceDelta)}.`, metadata: { from: before, to: priceDelta } });
      }
      return "Option saved.";
    }
    const result = await pool.query(
      `INSERT INTO product_modifier_options(group_id,name,price_delta,is_available,sort_order)
       SELECT g.id,$1,$2,true,(SELECT count(*) FROM product_modifier_options o WHERE o.group_id=g.id)
       FROM product_modifier_groups g JOIN products p ON p.id=g.product_id WHERE g.id=$3 AND p.outlet_key=$4 RETURNING id`,
      [name, priceDelta, text(data, "groupId"), user.outletKey],
    );
    if (!result.rowCount) fail("Option group not found.");
    return "Option added.";
  });
}

// Urutan grup atau opsi dari seret-dan-lepas (permintaan owner 5 Okt 2026):
// seluruh daftar dikirim, server memastikan isinya persis grup/opsi produk ini
// di outlet ini, lalu menulis sort_order. Cabang ikut lewat menuRun.
export async function reorderModifiersAction(productId: string, groupId: string | null, ids: string[]): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const order = (Array.isArray(ids) ? ids : []).map(String);
    await transaction(async (client) => {
      const current = groupId
        ? await client.query<{ id: string }>(
          `SELECT o.id::text FROM product_modifier_options o JOIN product_modifier_groups g ON g.id = o.group_id JOIN products p ON p.id = g.product_id
            WHERE g.id::text = $1 AND p.id = $2 AND p.outlet_key = $3`, [String(groupId), String(productId), user.outletKey])
        : await client.query<{ id: string }>(
          "SELECT g.id::text FROM product_modifier_groups g JOIN products p ON p.id = g.product_id WHERE p.id = $1 AND p.outlet_key = $2", [String(productId), user.outletKey]);
      const known = new Set(current.rows.map((row) => row.id));
      if (order.length !== known.size || new Set(order).size !== order.length || order.some((id) => !known.has(id))) fail("The list changed meanwhile. Refresh and try again.");
      await client.query(
        `UPDATE ${groupId ? "product_modifier_options" : "product_modifier_groups"} t SET sort_order = x.position - 1, updated_at = now()
           FROM unnest($1::bigint[]) WITH ORDINALITY AS x(id, position) WHERE t.id = x.id`, [order]);
    });
    return groupId ? "Option order saved." : "Group order saved.";
  });
}

export async function deleteModifierOptionAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products"], async () => {
    const user = await operator(["owner", "manager"]);
    const result = await pool.query(
      `DELETE FROM product_modifier_options o USING product_modifier_groups g, products p
       WHERE o.id=$1 AND g.id=o.group_id AND p.id=g.product_id AND p.outlet_key=$2 RETURNING o.name, p.name AS product`,
      [text(data, "optionId"), user.outletKey],
    );
    if (!result.rowCount) fail("Option not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "product.options_deleted", type: "product",
      summary: `Option ${result.rows[0].name} removed from ${result.rows[0].product}.` });
    return "Option deleted.";
  });
}

// ---------- Outlet ----------

export async function saveOutletAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings"], async () => {
    const user = await operator(["owner", "manager"]);
    await requireStepUp(user);
    const name = text(data, "name");
    if (!name) fail("Outlet name is required.");
    for (const field of ["logoImageUrl", "bannerImageUrl"]) {
      const value = text(data, field);
      if (value && !imageLink.test(value)) fail("Use an uploaded image or a link starting with https://");
    }
    await pool.query(
      `UPDATE outlets SET name=$1,public_name=$2,tagline=$3,address=$4,phone=$5,logo_image_url=$6,
        banner_image_url=$7,updated_at=now() WHERE outlet_key=$8`,
      [name, text(data, "publicName") || null, text(data, "tagline") || null, text(data, "address") || null,
        text(data, "phone") || null, text(data, "logoImageUrl") || null, text(data, "bannerImageUrl") || null, user.outletKey],
    );
    return "Outlet profile saved.";
  });
}

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

// Aturan bisnis outlet: pajak, zona waktu, dan jenis pesanan menu digital.
export async function saveBusinessRulesAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings", "/admin/dashboard"], async () => {
    // Pajak menentukan uang yang ditagih ke pelanggan: hanya owner.
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const taxPercent = Number(text(data, "taxPercent"));
    const timezone = text(data, "timezone");
    const modes = ["dinein", "takeaway"].filter((mode) => data.get(`mode_${mode}`) === "on");
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 25) fail("Tax must be between 0% and 25%.");
    if (!["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"].includes(timezone)) fail("Choose a timezone.");
    if (!modes.length) fail("Offer at least one order type.");
    await pool.query("UPDATE outlets SET tax_rate=$1,timezone=$2,order_modes=$3::text[],updated_at=now() WHERE outlet_key=$4",
      [Math.round(taxPercent * 100) / 10_000, timezone, modes, user.outletKey]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "outlet.business_rules", type: "outlet",
      summary: `Tax ${taxPercent}%, ${timezone}, order types: ${modes.join(", ")}.` });
    return "Business rules saved. The tablet uses them after its next sync.";
  });
}

export async function saveOpeningHoursAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings"], async () => {
    const user = await operator(["owner", "manager"]);
    await requireStepUp(user);
    const hours = weekdays.map((key) => {
      const isOpen = data.get(`open_${key}`) === "on";
      const openTime = text(data, `from_${key}`);
      const closeTime = text(data, `to_${key}`);
      if (isOpen && (!timePattern.test(openTime) || !timePattern.test(closeTime))) fail("Choose opening and closing times.");
      return { key, day: key[0].toUpperCase() + key.slice(1), is_open: isOpen, open_time: isOpen ? openTime : null, close_time: isOpen ? closeTime : null };
    });
    await pool.query("UPDATE outlets SET opening_hours=$1::jsonb,updated_at=now() WHERE outlet_key=$2", [JSON.stringify(hours), user.outletKey]);
    return "Opening hours saved.";
  });
}

// QRIS toko disimpan begitu terbaca dari gambar (insiden 4 Okt 2026: owner
// tidak menemukan tombol Save panel dan QRIS tidak pernah tersimpan). Server
// tetap memeriksa checksum, rupiah, dan nama merchant sebelum menyimpan.
export async function saveQrisAction(payload: string): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    let qris: string;
    try {
      qris = normalizeStaticQris(String(payload ?? "").slice(0, 1000));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      return { ok: false, message: /checksum/i.test(reason) ? "The QR was only partly read. Try a sharper, straighter image."
        : /rupiah/i.test(reason) ? "This QRIS isn't in rupiah." : /merchant/i.test(reason) ? "This QRIS has no merchant name. Use the QRIS from your bank or payment app."
        : "This QR code isn't a QRIS payment code." };
    }
    await pool.query("UPDATE outlets SET qris_payload=$1, updated_at=now() WHERE outlet_key=$2", [qris, user.outletKey]);
    const merchant = qrisMerchantName(qris) ?? "merchant";
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "outlet.payments", type: "outlet", summary: `Store QRIS saved (${merchant}).` });
    revalidatePath("/admin/outlet/settings");
    return { ok: true, message: `Saved: ${merchant}. Tablets get it at their next sync.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: error instanceof HttpError ? error.message : "Couldn't save the QRIS. Try again." };
  }
}

export async function removeQrisAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    await pool.query("UPDATE outlets SET qris_payload=NULL, updated_at=now() WHERE outlet_key=$1", [user.outletKey]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "outlet.payments", type: "outlet", summary: "Store QRIS removed." });
    revalidatePath("/admin/outlet/settings");
    return { ok: true, message: "Store QRIS removed. Tablets stop showing it at their next sync." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: error instanceof HttpError ? error.message : "Couldn't remove the QRIS. Try again." };
  }
}

// Gambar QRIS yang gagal dibaca di browser dicatat sebagai laporan masalah
// (tanpa gambarnya) supaya kegagalan berikutnya terlihat oleh tim 1garis Studio.
export async function reportQrisReadAction(info: { reason: string; type: string; size: number; width: number; height: number }) {
  try {
    const user = await operator(["owner"]);
    const reason = ["open", "none", "notqris"].includes(info.reason) ? info.reason : "none";
    await recordReport(pool, {
      outletKey: user.outletKey, source: "dashboard", category: "payment", title: "Store QRIS image couldn't be read",
      message: `${reason === "open" ? "The file couldn't be opened" : reason === "notqris" ? "A QR code was found but it isn't QRIS" : "No QR code was found"} · ${String(info.type).slice(0, 60) || "unknown type"} · ${Math.round(Number(info.size) / 1024)} KB · ${Number(info.width) || 0}x${Number(info.height) || 0}`,
      fingerprint: `qris-read:${reason}`, reportedBy: user.id,
    });
  } catch (error) {
    unstable_rethrow(error);
  }
}

// Cara bayar menu digital outlet. QRIS dikirim sebagai teks hasil pindai
// gambar QRIS di browser, lalu diperiksa ulang di server sebelum disimpan.
export async function saveMenuPaymentsAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings"], async () => {
    // QRIS menentukan ke rekening mana uang pelanggan masuk: hanya owner.
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const methods = menuPaymentMethods.filter((method) => data.get(`method_${method}`) === "on");
    const menuUrl = text(data, "menuUrl");
    if (menuUrl && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(menuUrl)) fail("Digital menu address must start with https://");
    // QRIS toko disimpan/dihapus lewat saveQrisAction/removeQrisAction.
    await pool.query("UPDATE outlets SET menu_payment_methods=$1::text[],menu_url=$2,updated_at=now() WHERE outlet_key=$3",
      [methods.length ? methods : ["cashier"], menuUrl.replace(/\/+$/, "") || null, user.outletKey]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "outlet.payments", type: "outlet",
      summary: `Digital menu payments: ${(methods.length ? methods : ["cashier"]).join(", ")}.` });
    return methods.length ? "Digital menu settings saved." : "Saved. No payment method was selected, so Pay at cashier stays on.";
  });
}

// Jam sinkron otomatis tablet kasir. Di luar jam ini tablet bekerja offline;
// kasir tetap bisa menekan Sinkron Sekarang, dan tutup shift selalu sinkron.
export async function saveAndroidSyncTimesAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings"], async () => {
    const user = await operator(["owner", "manager"]);
    await requireStepUp(user);
    const times = [...new Set(data.getAll("syncTime").map(String).filter(Boolean))];
    if (!times.length) fail("Choose at least one sync time.");
    if (times.length > 12 || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) fail("Invalid sync times. Choose up to 12.");
    await pool.query("UPDATE outlets SET android_sync_times=$1::text[], updated_at=now() WHERE outlet_key=$2", [times.sort(), user.outletKey]);
    return "Sync times saved. The tablet picks them up at its next sync.";
  });
}

export async function saveTableAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const id = text(data, "id");
    const code = text(data, "tableCode");
    const label = text(data, "tableLabel");
    const area = cleanArea(text(data, "tableArea"));
    const pax = number(data, "paxCapacity") || null;
    if (!code || !label) fail("Table code and name are required.");
    await assertTableNumberFree(user.outletKey, code, id);
    if (id) {
      const result = await pool.query(
        "UPDATE qr_tables SET table_code=$1,table_label=$2,table_area=$3,pax_capacity=$4,updated_at=now() WHERE id=$5 AND outlet_key=$6",
        [code, label, area, pax, id, user.outletKey]);
      if (!result.rowCount) fail("Table not found.");
      return "Table updated.";
    }
    await pool.query(
      "INSERT INTO qr_tables(outlet_key,qr_token,table_code,table_label,table_area,pax_capacity) VALUES ($1,$2,$3,$4,$5,$6)",
      [user.outletKey, opaqueToken("qr_"), code, label, area, pax]);
    return "Table added. Its QR code is ready to download.";
  });
}

// Tablet kasir dan pesanan menyimpan meja sebagai angka (angka pertama di kode),
// jadi angka itu harus unik per outlet walau areanya berbeda.
function tableNumber(code: string): number | null {
  const digits = code.match(/\d+/)?.[0];
  return digits ? Number(digits) : null;
}

async function usedTableNumbers(outletKey: string, exceptId = ""): Promise<Map<number, string>> {
  const rows = await pool.query<{ table_code: string; table_label: string }>(
    "SELECT table_code, table_label FROM qr_tables WHERE outlet_key=$1 AND id::text<>$2", [outletKey, exceptId]);
  const used = new Map<number, string>();
  for (const row of rows.rows) {
    const n = tableNumber(row.table_code);
    if (n !== null) used.set(n, row.table_label);
  }
  return used;
}

async function assertTableNumberFree(outletKey: string, code: string, exceptId: string) {
  const n = tableNumber(code);
  if (n === null) fail("The table code needs a number, for example T12 or R3. Cashiers pick tables by number.");
  const taken = (await usedTableNumbers(outletKey, exceptId)).get(n);
  if (taken) fail(`Number ${n} is already used by ${taken}. Each table needs its own number, even in another area.`);
}

function cleanArea(value: string): string {
  const area = value.replace(/\s+/g, " ").trim();
  if (!area || area.length > 40) fail("Give the area a name of up to 40 characters.");
  return area;
}

// Tambah banyak meja sekaligus: kode T01..T20 dan nama "Table 1".."Table 20".
// Kode yang sudah ada dilewati, bukan ditimpa.
export async function addTablesAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const area = cleanArea(text(data, "tableArea"));
    const codePrefix = text(data, "codePrefix").toUpperCase().replace(/[^A-Z-]/g, "").slice(0, 8);
    const namePrefix = text(data, "namePrefix").slice(0, 30) || "Table";
    const from = Math.trunc(number(data, "from"));
    const count = Math.trunc(number(data, "count"));
    const pax = number(data, "paxCapacity") || null;
    if (!Number.isInteger(from) || from < 1 || from > 9999) fail("Start at a number between 1 and 9999.");
    if (!Number.isInteger(count) || count < 1 || count > 100) fail("Add between 1 and 100 tables at a time.");
    const width = Math.max(2, String(from + count - 1).length);
    const existing = await pool.query<{ max: number | null }>("SELECT max(sort_order) AS max FROM qr_tables WHERE outlet_key=$1", [user.outletKey]);
    let sort = (existing.rows[0]?.max ?? 0) + 1;
    const used = await usedTableNumbers(user.outletKey);
    let created = 0;
    for (let n = from; n < from + count; n += 1) {
      if (used.has(n)) continue;
      const result = await pool.query(
        `INSERT INTO qr_tables(outlet_key,qr_token,table_code,table_label,table_area,pax_capacity,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (outlet_key,table_code) DO NOTHING`,
        [user.outletKey, opaqueToken("qr_"), `${codePrefix}${String(n).padStart(width, "0")}`, `${namePrefix} ${n}`, area, pax, sort],
      );
      created += result.rowCount ?? 0;
      sort += 1;
    }
    const skipped = count - created;
    return { message: `${created} table(s) added to ${area}${skipped ? `, ${skipped} skipped because the number is already used` : ""}.`, href: `/admin/outlet/tables?area=${encodeURIComponent(area)}` };
  });
}

export async function setTableActiveAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const active = text(data, "active") === "true";
    const result = await pool.query("UPDATE qr_tables SET is_active=$1,updated_at=now() WHERE id=$2 AND outlet_key=$3", [active, text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Table not found.");
    return active ? "Table activated." : "Table deactivated. Its QR code can no longer place orders.";
  });
}

// Meja tidak dirujuk pesanan (pesanan menyimpan nomor dan label), jadi aman dihapus.
export async function deleteTableAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const result = await pool.query<{ table_label: string; table_area: string }>(
      "DELETE FROM qr_tables WHERE id=$1 AND outlet_key=$2 RETURNING table_label, table_area", [text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Table not found.");
    const { table_label: label, table_area: area } = result.rows[0];
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "table.deleted", type: "table", summary: `${label} (${area}) deleted. Its QR code no longer works.` });
    const left = await pool.query("SELECT 1 FROM qr_tables WHERE outlet_key=$1 AND table_area=$2 LIMIT 1", [user.outletKey, area]);
    return { message: `${label} deleted.`, href: left.rowCount ? `/admin/outlet/tables?area=${encodeURIComponent(area)}` : "/admin/outlet/tables" };
  });
}

// Area hanya nama di qr_tables: ganti nama memindahkan semua mejanya; nama yang
// sudah ada berarti menggabungkan dua area.
export async function renameAreaAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const from = text(data, "area");
    const to = cleanArea(text(data, "name"));
    const result = await pool.query("UPDATE qr_tables SET table_area=$1,updated_at=now() WHERE outlet_key=$2 AND table_area=$3", [to, user.outletKey, from]);
    if (!result.rowCount) fail("Area not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "table.area_renamed", type: "table", summary: `Area ${from} renamed to ${to} (${result.rowCount} tables).` });
    return { message: `Area renamed to ${to}.`, href: `/admin/outlet/tables?area=${encodeURIComponent(to)}` };
  });
}

export async function deleteAreaAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/tables"], async () => {
    const user = await operator(["owner", "manager"]);
    const area = text(data, "area");
    const result = await pool.query("DELETE FROM qr_tables WHERE outlet_key=$1 AND table_area=$2", [user.outletKey, area]);
    if (!result.rowCount) fail("Area not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "table.area_deleted", type: "table", summary: `Area ${area} deleted with ${result.rowCount} tables.` });
    return { message: `${area} and its ${result.rowCount} tables deleted.`, href: "/admin/outlet/tables" };
  });
}

// ---------- Tim ----------

export async function saveUserAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/users"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const id = text(data, "id");
    if (!id) fail("Use Add cashier to add someone new.");
    const input = z.object({
      name: z.string().min(1, "Name is required.").max(255),
      email: z.email("Enter a valid email."),
      role: z.enum(["owner", "manager", "staff", "viewer"]),
      password: z.string().min(6, "Password must be at least 6 characters.").max(128).optional(),
      pin: z.string().regex(pinPattern, "The approval PIN must be exactly 6 digits.").optional(),
    }).parse({
      name: text(data, "name"), email: text(data, "email"), role: text(data, "role"),
      password: text(data, "password") || undefined, pin: text(data, "pin") || undefined,
    });
    // PIN hanya untuk yang boleh menyetujui; harus beda dari PIN approver lain
    // supaya audit log tahu siapa yang menyetujui.
    const approver = input.role === "owner" || input.role === "manager";
    const pin = approver ? input.pin : undefined;
    if (pin) {
      const others = await pool.query<{ approval_pin_hash: string }>(
        "SELECT approval_pin_hash FROM users WHERE outlet_key=$1 AND id::text<>$2 AND approval_pin_hash IS NOT NULL", [user.outletKey, id]);
      for (const row of others.rows) if (await verifyPin(pin, row.approval_pin_hash)) fail("Another member already uses this PIN. Choose a different one.");
    }
    const passwordHash = input.password ? await hash(input.password, 12) : null;
    const pinHash = pin ? hashPin(pin) : null;
    if (id === user.id && input.role !== "owner") fail("You can't change your own role.");
    const before = (await pool.query<{ pos_role: string }>("SELECT pos_role FROM users WHERE id=$1 AND outlet_key=$2", [id, user.outletKey])).rows[0];
    const result = await pool.query(
      `UPDATE users SET name=$1,email=$2,pos_role=$3,password_hash=coalesce($4,password_hash),
         approval_pin_hash=CASE WHEN $7 THEN coalesce($5,approval_pin_hash) ELSE NULL END,updated_at=now() WHERE id=$6 AND outlet_key=$8`,
      [input.name, input.email.toLowerCase(), input.role, passwordHash, pinHash, id, approver, user.outletKey]);
    if (!result.rowCount) fail("Team member not found.");
    const changes = [before && before.pos_role !== input.role ? `role ${before.pos_role} → ${input.role}` : "", passwordHash ? "password reset" : "", pinHash ? "approval PIN changed" : ""].filter(Boolean);
    if (changes.length) await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "user.updated", type: "user", id, summary: `${input.name}: ${changes.join(", ")}.` });
    return pinHash ? "Team member updated. Tap Sync now on the tablet to use the new PIN." : "Team member updated.";
  });
}

// Buka kunci data penting dengan PIN persetujuan 6 angka
// (server/step-up.ts). Percobaan dibatasi supaya PIN tidak bisa ditebak.
export async function unlockSettingsAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings", "/admin/users"], async () => {
    const user = await operator(["owner", "manager"]);
    await enforceRateLimit(pool, rateLimitKey("step-up", await headers(), user.id), 5, 900);
    const pin = text(data, "pin");
    if (!/^\d{6}$/.test(pin)) fail("Enter your 6-digit PIN.");
    if (!(await checkStepUpPin(user, pin))) {
      await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "user.unlock_failed", type: "user", id: user.id, summary: `${user.name} entered a wrong PIN to open protected settings.` });
      fail("That PIN isn't right.");
    }
    await grantStepUp(user);
    const next = text(data, "next");
    return { message: `Unlocked for ${STEP_UP_MINUTES} minutes.`, href: next.startsWith("/admin/") ? next : "/admin/outlet/settings" };
  });
}

export async function lockSettingsAction(): Promise<FormState> {
  return run(["/admin/outlet/settings", "/admin/users"], async () => {
    await operator(["owner", "manager"]);
    await endStepUp();
    return "Locked.";
  });
}

// Owner menambah kasir sendiri (keputusan owner 4 Okt 2026): akun native khusus
// login tablet dengan peran Staff. Login dashboard tetap butuh akun pusat dari
// Studio, jadi akun ini tidak pernah bisa membuka dashboard.
export async function addCashierAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/users"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const input = z.object({
      name: z.string().trim().min(1, "Name is required.").max(255),
      email: z.email("Enter a valid email."),
      password: z.string().min(6, "The tablet password needs at least 6 characters.").max(128),
    }).parse({ name: text(data, "name"), email: text(data, "email").toLowerCase(), password: text(data, "password") });
    const existing = await pool.query<{ outlet_key: string }>("SELECT outlet_key FROM users WHERE lower(email)=$1", [input.email]);
    if (existing.rows[0]) fail(existing.rows[0].outlet_key === user.outletKey ? "This person is already on your team." : "This email already has a Mangalli account at another outlet. Use another email, or Branch access for your own branches.");
    const created = await pool.query<{ id: string }>(
      `INSERT INTO users(outlet_key,name,email,password_hash,pos_role,is_active) VALUES ($1,$2,$3,$4,'staff',true) RETURNING id::text`,
      [user.outletKey, input.name, input.email, await hash(input.password, 12)]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "user.created", type: "user", id: created.rows[0].id, summary: `${input.name} added as a cashier (tablet sign-in only).` });
    return { message: `${input.name} can now sign in on the tablet with this email and password.`, href: "/admin/users" };
  });
}

export async function setUserActiveAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/users"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const id = text(data, "id");
    const active = text(data, "active") === "true";
    if (id === user.id) fail("You can't deactivate your own account.");
    const result = await pool.query<{ name: string }>("UPDATE users SET is_active=$1,updated_at=now() WHERE id=$2 AND outlet_key=$3 RETURNING name", [active, id, user.outletKey]);
    if (!result.rowCount) fail("Team member not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: active ? "user.activated" : "user.deactivated", type: "user", id,
      summary: `${result.rows[0].name} ${active ? "activated" : "deactivated"}.` });
    if (!active) await pool.query("UPDATE android_pos_staff_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    return active ? "Team member activated." : "Team member deactivated and signed out.";
  });
}

// ---------- Pesanan ----------

export async function markMenuOrderPaidAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/orders", "/admin/kitchen", "/admin/dashboard"], async () => {
    const user = await operator(["owner", "manager", "staff"]);
    const method = text(data, "method") === "qris" ? "qris" : "cash";
    await transaction((client) => markMenuOrderPaid(client, { outletKey: user.outletKey, orderId: text(data, "orderId"), method, actorId: user.id }));
    return "Payment received. The order went to the kitchen.";
  });
}

export async function cancelUnpaidMenuOrderAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/orders", "/admin/dashboard"], async () => {
    const user = await operator(["owner", "manager", "staff"]);
    await transaction((client) => cancelUnpaidMenuOrder(client, { outletKey: user.outletKey, orderId: text(data, "orderId"), actorId: user.id }));
    return "Order cancelled.";
  });
}

export async function updateOrderStatusAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/orders", "/admin/kitchen", "/admin/dashboard"], async () => {
    const user = await operator(["owner", "manager", "staff"]);
    const orderId = text(data, "orderId");
    const next = text(data, "status");
    if (!restaurantStatuses.includes(next as (typeof restaurantStatuses)[number])) fail("Invalid status.");
    await transaction(async (client) => {
      const result = await client.query<{ restaurant_status: string; from_tablet: boolean; order_code: string; paid: boolean }>(
        `SELECT o.restaurant_status,(o.device_id IS NOT NULL) AS from_tablet,o.order_code,
           EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='completed') AS paid
         FROM orders o WHERE o.id=$1 AND o.outlet_key=$2 FOR UPDATE OF o`, [orderId, user.outletKey]);
      const order = result.rows[0];
      if (!order) fail("Order not found.");
      // Tablet kasir adalah sumber status pesanannya sendiri; perubahan dari
      // dashboard akan tertimpa saat tablet sinkron.
      if (order.from_tablet) fail("This order was taken on the cashier tablet. Update it from the tablet.");
      const current = normalizeStatus(order.restaurant_status);
      const status = next as (typeof restaurantStatuses)[number];
      if (!canTransition(current, status)) fail("This order has already changed. Reload the page.");
      // Membatalkan pesanan yang sudah dibayar berarti mengembalikan uang.
      if (status === "cancelled" && order.paid && user.role === "staff") fail("This order is paid. Ask a manager or the owner to refund it.");
      await client.query("UPDATE orders SET restaurant_status=$1,status=$2,updated_at=now() WHERE id=$3", [status, legacyStatus(status), orderId]);
      if (status === "cancelled") {
        const refunded = await refundIfPaid(client, orderId, user.id, "Cancelled from the dashboard.");
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: refunded ? "order.refunded" : "order.cancelled", type: "order", id: orderId,
          summary: `${order.order_code} cancelled from the dashboard${refunded ? `, ${formatIdr(refunded)} refunded` : ""}.` });
      }
      await client.query(
        `INSERT INTO pos_audit_logs(outlet_key,actor_id,action,auditable_type,auditable_id,metadata)
         VALUES ($1,$2,'order.status_changed','order',$3,$4::jsonb)`,
        [user.outletKey, user.id, orderId, JSON.stringify({ from: current, to: status })],
      );
    });
    return "Order status updated.";
  });
}

// ---------- Promo ----------

const timeValue = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function savePromotionAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/promotions"], async () => {
    const user = await operator(["owner", "manager"]);
    const id = text(data, "id");
    const name = text(data, "name");
    const kind = text(data, "kind");
    const value = number(data, "value");
    const maxDiscount = text(data, "maxDiscount") ? number(data, "maxDiscount") : null;
    const minSubtotal = number(data, "minSubtotal") || 0;
    const scope = text(data, "scope") || "order";
    const channels = ["tablet", "menu"].filter((channel) => data.get(`channel_${channel}`) === "on");
    const days = [1, 2, 3, 4, 5, 6, 7].filter((day) => data.get(`day_${day}`) === "on");
    const startTime = text(data, "startTime") || null;
    const endTime = text(data, "endTime") || null;
    const rawCode = text(data, "code");
    const code = rawCode ? normalizeCoupon(rawCode) : null;
    const maxUses = text(data, "maxUses") ? Math.trunc(number(data, "maxUses")) : null;
    const startsOn = text(data, "startsOn") || null;
    const endsOn = text(data, "endsOn") || null;
    if (rawCode && !code) fail("Use 3 to 24 letters or numbers for the coupon code (dash and underscore are fine).");
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) fail("Maximum uses must be 1 or more.");
    if ([startsOn, endsOn].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) fail("Choose valid dates.");
    if (startsOn && endsOn && endsOn < startsOn) fail("The end date is before the start date.");
    if (code) {
      const taken = await pool.query("SELECT 1 FROM promotions WHERE outlet_key=$1 AND code=$2 AND id::text<>$3", [user.outletKey, code, id]);
      if (taken.rowCount) fail(`The coupon code ${code} is already used by another promo.`);
    }
    if (!name || name.length > 60) fail("Give the promo a name of up to 60 characters.");
    if (!["percent", "amount"].includes(kind)) fail("Choose percent or rupiah.");
    if (!Number.isFinite(value) || value <= 0 || (kind === "percent" && value > 100)) fail(kind === "percent" ? "Enter a discount between 1 and 100%." : "Enter the discount in rupiah.");
    if (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) fail("The maximum discount must be more than Rp 0.");
    if (!Number.isFinite(minSubtotal) || minSubtotal < 0) fail("Enter a valid minimum spend.");
    if (!["order", "category", "product"].includes(scope)) fail("Choose what the promo applies to.");
    if (!channels.length) fail("Choose where the promo can be used.");
    if (!days.length) fail("Choose at least one day.");
    if ((startTime === null) !== (endTime === null) || (startTime && (!timeValue.test(startTime) || !timeValue.test(endTime!)))) fail("Choose both a start and an end time, or All day.");
    if (startTime && startTime === endTime) fail("Start and end time can't be the same.");
    // Kategori/produk yang dipilih harus milik outlet ini.
    const categoryIds = scope === "category" ? (await pool.query<{ id: string }>(
      "SELECT id::text FROM categories WHERE outlet_key=$1 AND id::text = ANY($2::text[])", [user.outletKey, data.getAll("categoryId").map(String)])).rows.map((row) => row.id) : [];
    const productIds = scope === "product" ? (await pool.query<{ id: string }>(
      "SELECT id FROM products WHERE outlet_key=$1 AND id = ANY($2::text[])", [user.outletKey, data.getAll("productId").map(String)])).rows.map((row) => row.id) : [];
    if (scope === "category" && !categoryIds.length) fail("Choose at least one category.");
    if (scope === "product" && !productIds.length) fail("Choose at least one product.");
    const values = [name, kind, value, kind === "percent" ? maxDiscount : null, minSubtotal, scope, categoryIds, productIds, channels, days, startTime, endTime, code, maxUses, startsOn, endsOn];
    const saved = id
      ? await pool.query<{ id: string }>(
        `UPDATE promotions SET name=$1,kind=$2,value=$3,max_discount=$4,min_subtotal=$5,scope=$6,category_ids=$7::bigint[],product_ids=$8::text[],
           channels=$9::text[],days=$10::smallint[],start_time=$11::time,end_time=$12::time,code=$13,max_uses=$14,starts_on=$15::date,ends_on=$16::date,
           updated_at=now() WHERE id=$17 AND outlet_key=$18 RETURNING id::text`,
        [...values, id, user.outletKey])
      : await pool.query<{ id: string }>(
        `INSERT INTO promotions(outlet_key,name,kind,value,max_discount,min_subtotal,scope,category_ids,product_ids,channels,days,start_time,end_time,
           code,max_uses,starts_on,ends_on)
         VALUES ($17,$1,$2,$3,$4,$5,$6,$7::bigint[],$8::text[],$9::text[],$10::smallint[],$11::time,$12::time,$13,$14,$15::date,$16::date) RETURNING id::text`,
        [...values, user.outletKey]);
    if (!saved.rowCount) fail("Promo not found.");
    const amount = kind === "percent" ? `${value}%` : formatIdr(value);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: id ? "promotion.updated" : "promotion.created", type: "promotion", id: saved.rows[0].id,
      summary: `${name}${code ? ` (coupon ${code})` : ""}: ${amount} off${minSubtotal ? `, min. ${formatIdr(minSubtotal)}` : ""}.` });
    return { message: id ? "Promo saved." : "Promo created. It applies at the next sync on the tablet.", href: "/admin/promotions" };
  });
}

export async function setPromotionActiveAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/promotions"], async () => {
    const user = await operator(["owner", "manager"]);
    const active = text(data, "active") === "true";
    const result = await pool.query<{ name: string }>("UPDATE promotions SET is_active=$1,updated_at=now() WHERE id=$2 AND outlet_key=$3 RETURNING name", [active, text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Promo not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: active ? "promotion.activated" : "promotion.paused", type: "promotion", id: text(data, "id"),
      summary: `${result.rows[0].name} ${active ? "switched on" : "switched off"}.` });
    return active ? "Promo is on." : "Promo is off.";
  });
}

export async function deletePromotionAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/promotions"], async () => {
    const user = await operator(["owner", "manager"]);
    const result = await pool.query<{ name: string }>("DELETE FROM promotions WHERE id=$1 AND outlet_key=$2 RETURNING name", [text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Promo not found.");
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "promotion.deleted", type: "promotion", summary: `${result.rows[0].name} deleted.` });
    return { message: "Promo deleted. Past orders keep their discount.", href: "/admin/promotions" };
  });
}

// ---------- Impor menu dengan Eline ----------

export async function importMenuAction(_state: FormState, data: FormData): Promise<FormState> {
  return menuRun(["/admin/products", "/admin/categories"], async () => {
    const user = await operator(["owner", "manager"]);
    let raw: unknown;
    try {
      raw = JSON.parse(text(data, "draft"));
    } catch {
      fail("The menu draft is incomplete. Read the menu again.");
    }
    // Draf dari browser divalidasi ulang; tidak ada yang dipercaya begitu saja.
    const draft = menuDraftSchema.parse(raw);
    const counts = await transaction((client) => importMenu(client, { outletKey: user.outletKey, actorId: user.id, draft }));
    return {
      message: `${counts.products} products imported${counts.skipped.length ? `, ${counts.skipped.length} already on your menu` : ""}.`,
      href: "/admin/products",
    };
  });
}

// ---------- Laporan masalah ----------

export async function reportProblemAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/support"], async () => {
    const user = await operator(["owner", "manager", "staff", "viewer"]);
    await enforceRateLimit(pool, rateLimitKey("dashboard-report", await headers(), user.id), 10, 600);
    const category = text(data, "category") as ReportCategory;
    const message = text(data, "message");
    if (!reportCategories.includes(category)) fail("Choose what the problem is about.");
    if (message.length < 5) fail("Describe what happened in a few words.");
    await recordReport(pool, {
      outletKey: user.outletKey, source: "dashboard", category, title: message.split(/(?<=[.!?])\s|\n/)[0].replace(/[.!?]$/, "").slice(0, 120) || "Problem report",
      message, context: { page: text(data, "page").slice(0, 200), role: user.role }, reportedBy: user.id,
    });
    return "Thanks. The report was sent and appears under Support.";
  });
}

export async function resolveReportAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/support"], async () => {
    const user = await operator(["owner", "manager"]);
    const resolved = text(data, "status") !== "open";
    const result = await pool.query(
      `UPDATE support_reports SET status=$1, resolved_by=CASE WHEN $2 THEN $3::bigint END, resolved_at=CASE WHEN $2 THEN now() END
        WHERE id=$4 AND outlet_key=$5`,
      [resolved ? "resolved" : "open", resolved, user.id, text(data, "id"), user.outletKey]);
    if (!result.rowCount) fail("Report not found.");
    return resolved ? "Marked as resolved." : "Reopened.";
  });
}

// ---------- Shift ----------

export async function openShiftAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/shifts", "/admin/dashboard"], async () => {
    const user = await operator(["owner", "manager"]);
    const openingCash = number(data, "openingCash");
    if (!Number.isFinite(openingCash) || openingCash < 0) fail("Enter a valid opening cash amount.");
    const result = await pool.query(
      `INSERT INTO pos_shifts(outlet_key,business_date,opened_by,opening_cash,expected_cash)
       VALUES ($1,(now() AT TIME ZONE $2)::date,$3,$4,$4) ON CONFLICT DO NOTHING`, [user.outletKey, user.timezone, user.id, openingCash]);
    if (!result.rowCount) fail("A dashboard shift is already open.");
    return "Shift opened.";
  });
}

export async function closeShiftAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/shifts", "/admin/dashboard"], async () => {
    const user = await operator(["owner", "manager"]);
    const shiftId = text(data, "shiftId");
    const actualCash = number(data, "actualCash");
    if (!Number.isFinite(actualCash) || actualCash < 0) fail("Enter a valid counted cash amount.");
    await transaction(async (client) => {
      const result = await client.query("SELECT 1 FROM pos_shifts WHERE id=$1 AND outlet_key=$2 AND status='open' AND device_id IS NULL FOR UPDATE", [shiftId, user.outletKey]);
      if (!result.rowCount) fail("Open shift not found. Tablet shifts are closed on the tablet.");
      await client.query(
        `UPDATE pos_shifts SET status='closed',closed_by=$1,closed_at=now(),actual_cash=$2,
         cash_difference=$2-expected_cash,updated_at=now() WHERE id=$3`, [user.id, actualCash, shiftId],
      );
    });
    return "Shift closed.";
  });
}

// Pengeluaran usaha untuk laporan laba (owner/manager). Setiap tambah, ubah,
// dan hapus tercatat di audit log karena mengubah angka laba.
export async function saveExpenseAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/expenses", "/admin/reports"], async () => {
    const user = await operator(["owner", "manager"]);
    const editing = text(data, "id");
    const spentOn = text(data, "spentOn");
    const category = text(data, "category");
    const amount = number(data, "amount");
    const note = text(data, "note").slice(0, 200) || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(Date.parse(spentOn))) fail("Choose the date of the expense.");
    if (!Object.hasOwn(expenseCategories, category)) fail("Choose a category.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000_000) fail("Enter the amount spent.");
    const label = expenseCategories[category as ExpenseCategory];
    await transaction(async (client) => {
      if (editing) {
        const updated = await client.query(
          "UPDATE expenses SET spent_on=$1, category=$2, amount=$3, note=$4, updated_at=now() WHERE id=$5 AND outlet_key=$6 RETURNING id",
          [spentOn, category, amount, note, editing, user.outletKey]);
        if (!updated.rowCount) fail("Expense not found.");
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "expense.updated", type: "expense", id: editing, summary: `${label} ${formatIdr(amount)} on ${spentOn}.` });
      } else {
        const created = await client.query<{ id: string }>(
          "INSERT INTO expenses(outlet_key, spent_on, category, amount, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text",
          [user.outletKey, spentOn, category, amount, note, user.id]);
        await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "expense.created", type: "expense", id: created.rows[0].id, summary: `${label} ${formatIdr(amount)} on ${spentOn}.` });
      }
    });
    return editing ? "Expense saved." : "Expense added.";
  });
}

export async function deleteExpenseAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/expenses", "/admin/reports"], async () => {
    const user = await operator(["owner", "manager"]);
    await transaction(async (client) => {
      const removed = await client.query<{ category: ExpenseCategory; amount: string; spent_on: string }>(
        "DELETE FROM expenses WHERE id=$1 AND outlet_key=$2 RETURNING category, amount::text, spent_on::text", [text(data, "id"), user.outletKey]);
      const row = removed.rows[0];
      if (!row) fail("Expense not found.");
      await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "expense.deleted", type: "expense", id: text(data, "id"),
        summary: `${expenseCategories[row.category] ?? row.category} ${formatIdr(Number(row.amount))} on ${row.spent_on} deleted.` });
    });
    return "Expense deleted.";
  });
}

// Email laporan harian: owner mengatur semua penerima, manager hanya dirinya.
export async function setDailyReportAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/outlet/settings"], async () => {
    const user = await operator(["owner", "manager"]);
    await requireStepUp(user);
    const id = text(data, "id");
    if (user.role !== "owner" && id !== user.id) fail("Only the owner can change someone else's daily report.");
    const on = text(data, "on") === "1";
    const result = await pool.query(
      `UPDATE users u SET daily_report_opt_out=$1, updated_at=now() FROM outlet_members m
        WHERE u.id=$2 AND m.user_id=u.id AND m.outlet_key=$3 AND m.pos_role IN ('owner','manager') RETURNING u.name`,
      [!on, id, user.outletKey]);
    if (!result.rowCount) fail("Person not found.");
    return on ? `Daily report on for ${result.rows[0].name}.` : `Daily report off for ${result.rows[0].name}.`;
  });
}

export async function sendTestDailyReportAction(): Promise<FormState> {
  return run([], async () => {
    const user = await operator(["owner", "manager"]);
    await enforceRateLimit(pool, rateLimitKey("daily-report-test", await headers(), user.id), 5, 60 * 60);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: user.timezone });
    try {
      await sendDailyReport(user.outletKey, today, user.id);
    } catch (error) {
      fail(error instanceof Error && /set up/.test(error.message) ? error.message : "The test email couldn't be sent. Try again in a minute.");
    }
    return `Test sent to ${user.email}.`;
  });
}

// ---------- Cabang ----------

// Akses cabang untuk anggota cabang ini (owner). Hanya ke cabang dalam brand
// yang sama tempat pemberi akses juga owner; peran mengikuti peran asal anggota.
export async function saveBranchAccessAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/users"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const id = text(data, "id");
    const chosen = data.getAll("outlet").map(String);
    await transaction(async (client) => {
      const member = (await client.query<{ name: string; pos_role: string }>("SELECT name, pos_role FROM users WHERE id=$1 AND outlet_key=$2", [id, user.outletKey])).rows[0];
      if (!member) fail("Only members whose account belongs to this branch can be given access here.");
      const allowed = (await client.query<{ outlet_key: string; name: string }>(
        `SELECT o.outlet_key, coalesce(o.public_name, o.name) AS name FROM outlets o JOIN outlets mine ON mine.outlet_key = $1
           JOIN outlet_members m ON m.outlet_key = o.outlet_key AND m.user_id = $2 AND m.pos_role = 'owner'
          WHERE o.brand_key = mine.brand_key AND o.outlet_key <> $1 AND o.is_active`, [user.outletKey, user.id])).rows;
      const keys = allowed.map((row) => row.outlet_key);
      if (chosen.some((key) => !keys.includes(key))) fail("You can only give access to branches you own.");
      await client.query("DELETE FROM user_outlets WHERE user_id=$1 AND outlet_key = ANY($2::text[]) AND NOT (outlet_key = ANY($3::text[]))", [id, keys, chosen]);
      for (const key of chosen) {
        await client.query("INSERT INTO user_outlets(user_id, outlet_key, pos_role) VALUES ($1,$2,$3) ON CONFLICT (user_id, outlet_key) DO UPDATE SET pos_role=EXCLUDED.pos_role", [id, key, member.pos_role]);
      }
      const names = allowed.filter((row) => chosen.includes(row.outlet_key)).map((row) => row.name);
      await audit(client, { outletKey: user.outletKey, actorId: user.id, action: "user.branch_access", type: "user", id, summary: `${member.name}: branch access ${names.length ? names.join(", ") : "removed"}.` });
    });
    return "Branch access saved.";
  });
}

export async function removeBranchAccessAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/users"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const id = text(data, "id");
    if (id === user.id) fail("You can't remove your own access.");
    const removed = await pool.query("DELETE FROM user_outlets WHERE user_id=$1 AND outlet_key=$2", [id, user.outletKey]);
    if (!removed.rowCount) fail("This person has no branch access here.");
    await pool.query("UPDATE android_pos_staff_sessions SET revoked_at=now() WHERE user_id=$1 AND outlet_key=$2 AND revoked_at IS NULL", [id, user.outletKey]);
    await audit(pool, { outletKey: user.outletKey, actorId: user.id, action: "user.branch_access", type: "user", id, summary: "Branch access removed." });
    return "Access removed.";
  });
}

// Pindah cabang di dashboard. Cookie hanya pilihan; server memeriksa ulang
// keanggotaan di setiap request (lihat requireWebOperator).
export async function switchOutletAction(data: FormData) {
  const user = await operator();
  const key = text(data, "outlet");
  const allowed = await pool.query("SELECT 1 FROM outlet_members WHERE user_id=$1 AND outlet_key=$2", [user.id, key]);
  if (allowed.rowCount) {
    (await cookies()).set(outletCookie, key, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/admin/dashboard");
}

export async function createBranchAction(_state: FormState, data: FormData): Promise<FormState> {
  return run(["/admin/branches"], async () => {
    const user = await operator(["owner"]);
    await requireStepUp(user);
    const name = text(data, "name").slice(0, 80);
    if (name.length < 2) fail("Give the branch a name, for example Kopi Senja Sanur.");
    await enforceRateLimit(pool, rateLimitKey("create-branch", await headers(), user.id), 5, 60 * 60);
    const key = await createBranch(user, { name, address: text(data, "address").slice(0, 300) || null, phone: text(data, "phone").slice(0, 40) || null });
    return { message: `${name} created with the menu from the main branch.`, href: `/admin/branches?created=${key}` };
  });
}
