import { Plus } from "lucide-react";
import Link from "next/link";

import { deletePromotionAction, savePromotionAction, setPromotionActiveAction } from "@/app/actions";
import { ActionForm, FieldLabel, CopyButton, DateField, Drawer, FormFooter, Select, SubmitButton, ToggleSwitch } from "@/components/interactive";
import { EmptyState, PageHeader } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { categoriesData, productsData } from "@/server/admin";
import { isPromotionLive, localClock, promotionSummary, scheduleSummary, type Promotion } from "@/server/promotion-rules";
import { loadPromotions } from "@/server/promotions";
import { pool } from "@/server/db";
import { formatDate } from "@/server/format";

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const halfHours = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

// Promo outlet: kartu sama tinggi berisi potongan, cakupan, jadwal, dan kanal;
// buat/edit di drawer. Bagian pilihan kategori/produk tampil sesuai cakupan
// lewat CSS :has, tanpa JavaScript tambahan.
export async function PromotionsSection({ operator, edit, creating }: { operator: Operator; edit: string; creating: boolean }) {
  const [promotions, categories, { products }, outlet] = await Promise.all([
    loadPromotions(pool, operator.outletKey),
    categoriesData(operator),
    productsData(operator, { q: "", category: "", status: "" }),
    pool.query<{ menu_url: string | null }>("SELECT menu_url FROM outlets WHERE outlet_key=$1", [operator.outletKey]),
  ]);
  const menuUrl = outlet.rows[0]?.menu_url?.replace(/\/+$/, "") ?? null;
  const today = localClock(new Date(), operator.timezone).date;
  const status = (promotion: Promotion, live: boolean): [string, string] => {
    if (!promotion.isActive) return ["Off", "neutral"];
    if (promotion.endsOn && today > promotion.endsOn) return ["Ended", "neutral"];
    if (promotion.maxUses !== null && promotion.used >= promotion.maxUses) return ["Used up", "neutral"];
    return live ? ["Live now", "success"] : ["Scheduled", "info"];
  };
  const current = promotions.find((promotion) => String(promotion.id) === edit);
  const now = new Date();
  const categoryName = new Map(categories.map((category) => [String(category.id), category.name]));
  const productName = new Map(products.map((product) => [product.id, product.name]));
  const scopeText = (promotion: Promotion) => promotion.scope === "order" ? "Whole order"
    : promotion.scope === "category" ? promotion.categoryIds.map((id) => categoryName.get(id) ?? "Deleted category").join(", ")
      : promotion.productIds.length === 1 ? productName.get(promotion.productIds[0]) ?? "1 product" : `${promotion.productIds.length} products`;

  return (
    <div className="page">
      <PageHeader
        title="Promotions"
        description="Discounts for the tablet and digital menu."
        info="One promo per order; the biggest discount wins."
        action={<Link className="button primary" href="/admin/promotions?new=1" scroll={false}><Plus size={16} /> New promo</Link>}
      />
      {promotions.length ? (
        <div className="bento">
          {promotions.map((promotion) => {
            const live = isPromotionLive(promotion, now, operator.timezone);
            const [label, tone] = status(promotion, live);
            const dates = [promotion.startsOn ? `from ${formatDate(promotion.startsOn)}` : "", promotion.endsOn ? `until ${formatDate(promotion.endsOn)}` : ""].filter(Boolean).join(" ");
            return (
              <article className="panel span-4 promo-card" key={promotion.id}>
                <header className="panel-header">
                  <div><h2>{promotion.name}</h2><p>{scopeText(promotion)}</p></div>
                  <span className={`badge tone-${tone}`}>{label}</span>
                </header>
                <div className="panel-body">
                  {promotion.code ? (
                    <div className="promo-coupon-row">
                      <span className="coupon-chip">{promotion.code}</span>
                      <div className="action-row">
                        <CopyButton label="Code" text={promotion.code} />
                        {menuUrl ? <CopyButton label="Link" text={`${menuUrl}/?coupon=${promotion.code}`} /> : null}
                      </div>
                    </div>
                  ) : null}
                  <strong className="promo-value">{promotion.kind === "percent" ? `${promotion.value}%` : `Rp ${promotion.value.toLocaleString("id-ID")}`}<span> off</span></strong>
                  <dl className="detail-list">
                    <dt>Rules</dt><dd>{promotionSummary(promotion).replace(/^[^·]+(· )?/, "") || "No minimum"}</dd>
                    <dt>When</dt><dd>{scheduleSummary(promotion)}{dates ? `, ${dates}` : ""}</dd>
                    {promotion.code ? <><dt>Used</dt><dd>{promotion.used}{promotion.maxUses ? ` of ${promotion.maxUses}` : " times"}</dd></> : null}
                    <dt>Where</dt><dd>{promotion.channels.map((channel) => (channel === "tablet" ? "Cashier tablet" : "Digital menu")).join(" & ")}</dd>
                  </dl>
                  <div className="promo-foot">
                    <ToggleSwitch action={setPromotionActiveAction} checked={promotion.isActive} fields={{ id: String(promotion.id), active: String(!promotion.isActive) }} label={promotion.isActive ? `Switch off ${promotion.name}` : `Switch on ${promotion.name}`} />
                    <Link className="button small ghost" href={`/admin/promotions?edit=${promotion.id}`} scroll={false}>Edit</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <EmptyState title="No promos yet" action={<Link className="button primary" href="/admin/promotions?new=1" scroll={false}><Plus size={16} /> Create promo</Link>} />
        </section>
      )}

      {creating || current ? (
        <Drawer closeHref="/admin/promotions" title={current ? current.name : "New promo"} description="Auto on the menu, picked on the tablet.">
          <ActionForm action={savePromotionAction} className="form promo-form" successHref="/admin/promotions">
            {current ? <input name="id" type="hidden" value={current.id} /> : null}
            <label className="field">Name<input defaultValue={current?.name} maxLength={60} name="name" placeholder="e.g. Happy hour coffee" required /></label>
            <div className="form-grid">
              <label className="field"><FieldLabel hint="With a code, the promo only applies when customers type it. Share it in your posts.">Coupon code</FieldLabel><input className="coupon-input" defaultValue={current?.code ?? ""} maxLength={24} name="code" placeholder="Optional, e.g. HEMAT20" /></label>
              <label className="field"><FieldLabel hint="Total orders that can use it.">Maximum uses</FieldLabel><input defaultValue={current?.maxUses ?? ""} min="1" name="maxUses" placeholder="No limit" type="number" /></label>
            </div>
            <fieldset className="check-group">
              <legend>Discount</legend>
              <div className="chips">
                <label className="chip"><input defaultChecked={(current?.kind ?? "percent") === "percent"} name="kind" type="radio" value="percent" /> Percent</label>
                <label className="chip"><input defaultChecked={current?.kind === "amount"} name="kind" type="radio" value="amount" /> Rupiah</label>
              </div>
            </fieldset>
            <div className="form-grid">
              <label className="field">Amount<span className="input-affix"><span className="promo-rp">Rp</span><input defaultValue={current?.value} min="1" name="value" required step="1" type="number" /><span className="end promo-pct">%</span></span></label>
              <label className="field promo-cap">Maximum discount<span className="input-affix"><span>Rp</span><input defaultValue={current?.maxDiscount ?? ""} min="1" name="maxDiscount" placeholder="No limit" type="number" /></span></label>
              <label className="field">Minimum spend<span className="input-affix"><span>Rp</span><input defaultValue={current?.minSubtotal || ""} min="0" name="minSubtotal" placeholder="No minimum" type="number" /></span></label>
            </div>
            <fieldset className="check-group">
              <legend>Applies to</legend>
              <div className="option-cards">
                {([["order", "Whole order", "Every item in the order"], ["category", "Categories", "Only items in the chosen categories"], ["product", "Products", "Only the chosen products"]] as const).map(([value, label, help]) => (
                  <label className="option-card" key={value}><input defaultChecked={(current?.scope ?? "order") === value} name="scope" type="radio" value={value} /><span><strong>{label}</strong><span>{help}</span></span></label>
                ))}
              </div>
            </fieldset>
            <div className="field promo-scope-category">Categories<div className="chips">{categories.map((category) => (
              <label className="chip" key={category.id}><input defaultChecked={current?.categoryIds.includes(String(category.id))} name="categoryId" type="checkbox" value={category.id} />{category.name}</label>
            ))}</div></div>
            <div className="field promo-scope-product">Products<div className="chips promo-products">{products.map((product) => (
              <label className="chip" key={product.id}><input defaultChecked={current?.productIds.includes(product.id)} name="productId" type="checkbox" value={product.id} />{product.name}</label>
            ))}</div></div>
            <div className="field">Days<div className="chips">{dayNames.map((day, index) => (
              <label className="chip" key={day}><input defaultChecked={current ? current.days.includes(index + 1) : true} name={`day_${index + 1}`} type="checkbox" />{day}</label>
            ))}</div></div>
            <div className="form-grid">
              <div className="field">From<Select defaultValue={current?.startTime ?? ""} label="Start time" name="startTime" options={[{ value: "", label: "All day" }, ...halfHours.map((time) => ({ value: time, label: time }))]} /></div>
              <div className="field">Until<Select defaultValue={current?.endTime ?? ""} label="End time" name="endTime" options={[{ value: "", label: "All day" }, ...halfHours.map((time) => ({ value: time, label: time }))]} /></div>
            </div>
            <div className="form-grid">
              <div className="field">Valid from<DateField defaultValue={current?.startsOn ?? ""} label="Valid from" name="startsOn" placeholder="Now" /></div>
              <div className="field">Valid until<DateField defaultValue={current?.endsOn ?? ""} label="Valid until" name="endsOn" placeholder="No end date" /></div>
            </div>
            <div className="field">Where<div className="chips">
              <label className="chip"><input defaultChecked={current ? current.channels.includes("tablet") : true} name="channel_tablet" type="checkbox" /> Cashier tablet</label>
              <label className="chip"><input defaultChecked={current ? current.channels.includes("menu") : true} name="channel_menu" type="checkbox" /> Digital menu</label>
            </div></div>
            <FormFooter><SubmitButton pendingLabel="Saving…">{current ? "Save promo" : "Create promo"}</SubmitButton></FormFooter>
          </ActionForm>
          {current ? (
            <ActionForm action={deletePromotionAction} className="inline-form promo-delete" confirm={`Delete ${current.name}? Past orders keep their discount.`} confirmLabel="Delete promo">
              <input name="id" type="hidden" value={current.id} />
              <SubmitButton className="button ghost danger" pendingLabel="Deleting…">Delete promo</SubmitButton>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}
