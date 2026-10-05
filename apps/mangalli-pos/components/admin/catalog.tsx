import { Check, ImageOff, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  deleteCategoryAction, deleteModifierGroupAction, deleteModifierOptionAction, deleteProductAction, reorderModifiersAction, saveCategoryAction, saveModifierGroupAction,
  saveModifierOptionAction, saveProductAction, setProductAvailabilityAction,
} from "@/app/actions";
import { Sortable } from "@/components/sortable";
import { ActionForm, ExternalSubmit, FieldLabel, Drawer, FilterForm, Hint, SearchField, FormFooter, ImageField, Select, SubmitButton, ToggleSwitch } from "@/components/interactive";
import { MenuImporter } from "@/components/menu-import";
import { Badge, EmptyState, PageHeader, Pagination, Panel } from "@/components/ui";
import type { Operator } from "@/server/auth";
import { query } from "@/server/db";
import { menuDraftSchema } from "@/server/menu-import";
import { categoriesData, productDetail, productSorts, productsData, type ModifierGroup, type ProductRow, type ProductSort } from "@/server/admin";
import { menuMode, type MenuMode } from "@/server/branches";
import { formatIdr } from "@/server/pos";

type ProductFilters = { q: string; category: string; status: string; sort: string };
const PRODUCT_PAGE_SIZE = 50;

export async function ProductsSection({ operator, filters, edit, creating, page, group }: { operator: Operator; filters: ProductFilters; edit: string; creating: boolean; page: number; group: string }) {
  const sort = (filters.sort || "menu") as ProductSort;
  const [{ products, categories, total }, detail, mode] = await Promise.all([
    productsData(operator, { ...filters, sort, page, pageSize: PRODUCT_PAGE_SIZE }),
    edit ? productDetail(operator, edit) : null,
    menuMode(operator.outletKey),
  ]);
  const branch = mode.kind === "branch";
  const base = new URLSearchParams(Object.entries({ ...filters, ...(page > 1 ? { page: String(page) } : {}) }).filter(([, value]) => value));
  const href = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(base);
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    const text = params.toString();
    return `/admin/products${text ? `?${text}` : ""}`;
  };
  const filtered = Boolean(filters.q || filters.category || filters.status);
  if (!products.length && page > 1) redirect(href({ page: "1" }));
  const pageHref = (next: number) => {
    const params = new URLSearchParams(base);
    if (next > 1) params.set("page", String(next)); else params.delete("page");
    const text = params.toString();
    return `/admin/products${text ? `?${text}` : ""}`;
  };

  return (
    <div className="page">
      <PageHeader
        title="Products"
        description={`${total} ${filtered ? `product${total === 1 ? "" : "s"} found` : `product${total === 1 ? "" : "s"}`}`}
        action={branch ? undefined : <div className="action-row">
          <Link className="button" href="/admin/products/import"><Sparkles size={16} /> Import with Eline</Link>
          {categories.length ? <Link className="button primary" href={href({ new: "1" })} scroll={false}><Plus size={16} /> Add product</Link> : null}
        </div>}
      />
      {branch ? <BranchMenuNotice mode={mode} /> : null}
      <FilterForm action="/admin/products">
        <SearchField defaultValue={filters.q} label="Search products" placeholder="Search products" />
        <Select defaultValue={filters.category} label="Category" name="category" options={[{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} submitOnChange />
        <Select defaultValue={filters.status} label="Status" name="status" options={[{ value: "", label: "All statuses" }, ...[{ value: "available", label: "Available" }, { value: "unavailable", label: "Sold out" }, { value: "hidden", label: "Hidden" }, { value: "low_stock", label: "Low stock (5 or less)" }, { value: "out_of_stock", label: "Out of stock" }]]} submitOnChange />
        <Select defaultValue={sort} label="Sort" name="sort" options={(Object.keys(productSorts) as ProductSort[]).map((key) => ({ value: key, label: productSorts[key].label }))} submitOnChange />
        {filtered || sort !== "menu" ? <Link className="button ghost" href="/admin/products">Clear</Link> : null}
      </FilterForm>
      <Panel>
        {products.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Product</th><th className="hide-sm">Category</th><th className="right">Price</th><th>Stock</th><th className="hide-sm">Options</th><th>Available</th><th /></tr></thead>
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td><Link className="cell-main" href={href({ edit: product.id })} scroll={false}>
                  <Thumb url={product.image_url} />
                  <span><strong>{product.name}</strong>{product.is_best_seller || product.is_people_love_this ? <span className="cell-sub">{[product.is_best_seller && "Best seller", product.is_people_love_this && "Customer favourite"].filter(Boolean).join(" · ")}</span> : null}</span>
                </Link></td>
                <td className="hide-sm">{product.category_name}</td>
                <td className="right num">{formatIdr(Number(product.price))}</td>
                <td className="nowrap"><StockBadge stock={product.stock} /></td>
                <td className="hide-sm muted nowrap">{product.modifier_count ? `${product.modifier_count} group${product.modifier_count > 1 ? "s" : ""}` : "—"}</td>
                <td>{product.availability === "hidden" ? <Badge value="hidden" /> : (
                  <ToggleSwitch action={setProductAvailabilityAction} checked={product.availability === "available"}
                    fields={{ id: product.id, availability: product.availability === "available" ? "unavailable" : "available" }}
                    label={product.availability === "available" ? `Mark ${product.name} as sold out` : `Mark ${product.name} as available`} />
                )}</td>
                <td className="right"><Link className="button small ghost" href={href({ edit: product.id })} scroll={false}>Edit</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : categories.length ? (
          <EmptyState title={filtered ? "No matching products" : "No products yet"} action={filtered ? <Link className="button" href="/admin/products">Clear filters</Link> : <Link className="button primary" href={href({ new: "1" })} scroll={false}><Plus size={16} /> Add product</Link>} />
        ) : (
          <EmptyState title="No products yet" action={<div className="action-row"><Link className="button primary" href="/admin/products/import"><Sparkles size={16} /> Import your menu with Eline</Link><Link className="button" href="/admin/categories?new=1">Add a category yourself</Link></div>} />
        )}
        <Pagination href={pageHref} page={page} pageSize={PRODUCT_PAGE_SIZE} total={total} />
      </Panel>
      {branch && detail ? (
        <Drawer closeHref={href()} title={detail.product.name} description={`${detail.product.category_name} · menu from ${mode.mainName ?? "the main branch"}`}>
          <BranchProductForm product={detail.product} />
        </Drawer>
      ) : creating && !branch ? (
        <Drawer closeHref={href()} footer={<ExternalSubmit form="product-form" pendingLabel="Adding…">Add product</ExternalSubmit>} title="Add product">
          <ProductForm categories={categories} closeHref={href()} />
        </Drawer>
      ) : detail ? (
        <Drawer closeHref={href()} description={`${detail.product.category_name} · ${formatIdr(Number(detail.product.price))}`}
          footer={<ExternalSubmit form="product-form" pendingLabel="Saving…">Save changes</ExternalSubmit>} title={detail.product.name}>
          <ProductForm categories={categories} closeHref={href()} product={detail.product} />
          <ModifierEditor editing={group} groupHref={(id) => href({ edit: detail.product.id, ...(id ? { group: id } : {}) })} groups={detail.groups} productId={detail.product.id} />
          <ActionForm action={deleteProductAction} className="form-section" successHref={href()} confirm={`Delete ${detail.product.name}? It disappears from the tablet and the digital menu. Past orders keep it.`} confirmLabel="Delete product">
            <input name="id" type="hidden" value={detail.product.id} />
            <h3>Delete product</h3>
            <p>To hide it, set Status to Hidden instead.</p>
            <FormFooter><SubmitButton className="button danger" pendingLabel="Deleting…"><Trash2 size={15} /> Delete product</SubmitButton></FormFooter>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}

// Cabang selain cabang utama: menu disalin dari cabang utama.
function BranchMenuNotice({ mode }: { mode: MenuMode }) {
  return <p className="notice">Menu is managed at <strong>{mode.mainName ?? "the main branch"}</strong>. Here: price, status and stock.</p>;
}

function BranchProductForm({ product }: { product: ProductRow }) {
  const mainPrice = product.main_price === null || product.main_price === undefined ? null : Number(product.main_price);
  return (
    <ActionForm action={saveProductAction}>
      <input name="id" type="hidden" value={product.id} />
      <div className="form-grid">
        <label className="field">{mainPrice === null ? "Price" : <FieldLabel hint={`Main branch price ${formatIdr(mainPrice)}. Enter another price to charge differently here; enter the main price to follow it again.`}>Price here</FieldLabel>}<span className="input-affix"><span>Rp</span><input defaultValue={Number(product.price)} inputMode="numeric" min="0" name="price" step="1" type="number" /></span></label>
        <div className="field">Status<Select defaultValue={product.availability} label="Status" name="availability" options={[{ value: "available", label: "Available" }, { value: "unavailable", label: "Sold out" }, { value: "hidden", label: "Hidden" }]} /></div>
        <div className="field field-wide stock-field">
          <input name="stockField" type="hidden" value="1" />
          <label className="chip" style={{ justifySelf: "start" }}><input defaultChecked={product.stock !== null && product.stock !== undefined} name="trackStock" type="checkbox" /> Track stock</label>
          <label className="field stock-count"><FieldLabel hint="Stock is counted per branch.">Units in stock now</FieldLabel><input defaultValue={product.stock !== null && product.stock !== undefined ? Math.max(0, product.stock) : ""} inputMode="numeric" min="0" name="stock" placeholder="e.g. 20" type="number" /></label>
        </div>
      </div>
      <FormFooter><SubmitButton pendingLabel="Saving…">Save for this branch</SubmitButton></FormFooter>
    </ActionForm>
  );
}

// Sisa stok: kosong bila tidak dilacak; kuning saat tinggal 5 atau kurang, merah saat habis.
function StockBadge({ stock }: { stock: number | null }) {
  if (stock === null) return <span className="muted">—</span>;
  if (stock <= 0) return <span className="badge tone-danger">Out of stock</span>;
  return <span className={`badge ${stock <= 5 ? "tone-warning" : "tone-neutral"}`}>{stock} left</span>;
}

function Thumb({ url }: { url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element -- product photos live on external hosts
  return url ? <img alt="" className="thumb" loading="lazy" src={url} /> : <span className="thumb empty"><ImageOff size={16} /></span>;
}

function ProductForm({ categories, product, closeHref }: { categories: Array<{ id: string; name: string }>; product?: ProductRow; closeHref: string }) {
  return (
    // Tombol simpan ada di kaki drawer (selalu terlihat), terhubung lewat id form.
    // Setelah simpan (tambah atau ubah) panel tertutup ke daftar dengan filter yang sama.
    <ActionForm action={saveProductAction} id="product-form" successHref={closeHref}>
      {product ? <input name="id" type="hidden" value={product.id} /> : null}
      <div className="form-grid">
        <label className="field field-wide">Name<input defaultValue={product?.name} name="name" required /></label>
        <div className="field">Category<Select defaultValue={product?.category_id ?? ""} label="Category" name="categoryId" options={categories.map((category) => ({ value: category.id, label: category.name }))} placeholder="Choose a category" /></div>
        <label className="field">Price<span className="input-affix"><span>Rp</span><input defaultValue={product ? Number(product.price) : undefined} inputMode="numeric" min="0" name="price" required step="1" type="number" /></span></label>
        <label className="field"><FieldLabel hint="What one portion costs you to make: ingredients, cup, packaging. Optional. Reports use it to show your profit; past sales keep the cost they had when sold.">Cost</FieldLabel><span className="input-affix"><span>Rp</span><input defaultValue={product?.cost_price !== null && product?.cost_price !== undefined ? Number(product.cost_price) : undefined} inputMode="numeric" min="0" name="costPrice" placeholder="Optional" step="1" type="number" /></span></label>
        <div className="field">Status<Select defaultValue={product?.availability ?? "available"} label="Status" name="availability" options={[{ value: "available", label: "Available" }, { value: "unavailable", label: "Sold out" }, { value: "hidden", label: "Hidden" }]} /></div>
        <label className="field">Sort order<input defaultValue={product?.sort_order ?? 0} name="sortOrder" type="number" /></label>
        <div className="field field-wide stock-field">
          <input name="stockField" type="hidden" value="1" />
          <label className="chip" style={{ justifySelf: "start" }}><input defaultChecked={product?.stock !== null && product?.stock !== undefined} name="trackStock" type="checkbox" /> Track stock</label>
          <label className="field stock-count"><FieldLabel hint="Orders from the tablet and the digital menu count down from here; cancelled orders count back. When it reaches 0 the product shows as sold out. Change it after a restock or a recount.">Units in stock now</FieldLabel><input defaultValue={product?.stock !== null && product?.stock !== undefined ? Math.max(0, product.stock) : ""} inputMode="numeric" min="0" name="stock" placeholder="e.g. 20" type="number" /></label>
        </div>
        <label className="field field-wide">Description<textarea defaultValue={product?.description ?? ""} name="description" rows={3} /></label>
        <div className="field-wide"><ImageField defaultValue={product?.image_url} hint="Shown on the tablet and the digital menu. Square photos look best." kind="product" label="Photo" name="imageUrl" /></div>
        <div className="field field-wide">Highlights<div className="chips">
          <label className="chip"><input defaultChecked={product?.is_best_seller} name="isBestSeller" type="checkbox" /> Best seller</label>
          <label className="chip"><input defaultChecked={product?.is_people_love_this} name="isPeopleLoveThis" type="checkbox" /> Customer favourite</label>
        </div></div>
      </div>
    </ActionForm>
  );
}

function ModifierEditor({ productId, groups, editing, groupHref }: { productId: string; groups: ModifierGroup[]; editing: string; groupHref: (id?: string) => string }) {
  return (
    <section className="form-section">
      <h3>Options<Hint>Sizes, levels, toppings, add-ons. Edit a name or price, then press Enter. Drag the handle to reorder.</Hint></h3>
      <Sortable label="Option groups" onReorder={reorderModifiersAction.bind(null, productId, null)} items={groups.map((group) => ({ id: group.id, name: group.name, node: (
        <div className="line-items">
          {editing === group.id ? (
            <ActionForm action={saveModifierGroupAction} className="line-item total group-edit" successHref={groupHref()}>
              <input name="groupId" type="hidden" value={group.id} />
              <label className="field">Group name<input defaultValue={group.name} name="name" required /></label>
              <label className="field">Max choices<input defaultValue={group.maxSelect} min="1" name="maxSelect" type="number" /></label>
              <label className="chip"><input defaultChecked={group.isRequired} name="isRequired" type="checkbox" /> Required</label>
              <div className="action-row">
                <Link className="button small ghost" href={groupHref()} scroll={false}>Cancel</Link>
                <SubmitButton className="button small primary" pendingLabel="Saving…">Save group</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <div className="line-item total">
              <span>{group.name}<span className="cell-sub">{group.isRequired ? "Required" : "Optional"} · up to {group.maxSelect}</span></span>
              <span className="action-row">
                <Link className="button small ghost" href={groupHref(group.id)} scroll={false}><Pencil size={14} /> Edit</Link>
                <ActionForm action={deleteModifierGroupAction} className="inline-form" confirm={`Delete ${group.name} and its ${group.options.length} options?`} confirmLabel="Delete">
                  <input name="groupId" type="hidden" value={group.id} />
                  <SubmitButton className="button small ghost danger"><Trash2 size={14} /> Delete</SubmitButton>
                </ActionForm>
              </span>
            </div>
          )}
          <Sortable className="options" label={`Options of ${group.name}`} onReorder={reorderModifiersAction.bind(null, productId, group.id)} items={group.options.map((option) => ({ id: option.id, name: option.name, node: (
            <div className="line-item option-row">
              <ActionForm action={saveModifierOptionAction} className="option-edit">
                <input name="optionId" type="hidden" value={option.id} />
                <input aria-label={`Name of ${option.name}`} defaultValue={option.name} name="name" required />
                <span className="input-affix"><span>+Rp</span><input aria-label={`Extra price of ${option.name}`} defaultValue={Number(option.priceDelta)} min="0" name="priceDelta" type="number" /></span>
                <SubmitButton className="icon-button small"><Check size={15} /><span className="sr-only">Save {option.name}</span></SubmitButton>
              </ActionForm>
              <ActionForm action={deleteModifierOptionAction} className="inline-form" confirm={`Delete ${option.name}?`} confirmLabel="Delete">
                <input name="optionId" type="hidden" value={option.id} />
                <SubmitButton className="icon-button small danger"><Trash2 size={15} /><span className="sr-only">Delete {option.name}</span></SubmitButton>
              </ActionForm>
            </div>
          ) }))} />
          <ActionForm action={saveModifierOptionAction} className="line-item option-row option-new" reset>
            <input name="groupId" type="hidden" value={group.id} />
            <input aria-label="Option name" name="name" placeholder="New option" required />
            <span className="input-affix"><span>+Rp</span><input aria-label="Extra price" min="0" name="priceDelta" placeholder="0" type="number" /></span>
            <SubmitButton className="button small">Add</SubmitButton>
          </ActionForm>
        </div>
      ) }))} />
      <ActionForm action={saveModifierGroupAction} className="form" reset>
        <input name="productId" type="hidden" value={productId} />
        <div className="form-grid">
          <label className="field">New group<input name="name" placeholder="e.g. Size, Sugar level" required /></label>
          <label className="field">Max choices<input defaultValue="1" min="1" name="maxSelect" type="number" /></label>
          <label className="chip field-wide" style={{ justifySelf: "start" }}><input name="isRequired" type="checkbox" /> Required</label>
        </div>
        <FormFooter><SubmitButton className="button">Add group</SubmitButton></FormFooter>
      </ActionForm>
    </section>
  );
}

export async function CategoriesSection({ operator, edit, creating }: { operator: Operator; edit: string; creating: boolean }) {
  const [categories, mode] = await Promise.all([categoriesData(operator), menuMode(operator.outletKey)]);
  const branch = mode.kind === "branch";
  const current = branch ? undefined : categories.find((category) => category.id === edit);
  creating = creating && !branch;
  return (
    <div className="page">
      <PageHeader title="Categories" description="Menu sections on the tablet and digital menu." action={branch ? undefined : <Link className="button primary" href="/admin/categories?new=1" scroll={false}><Plus size={16} /> Add category</Link>} />
      {branch ? <BranchMenuNotice mode={mode} /> : null}
      <Panel>
        {categories.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Category</th><th>Products</th><th>Sort order</th><th /></tr></thead>
            <tbody>{categories.map((category) => (
              <tr key={category.id}>
                <td><Link href={`/admin/categories?edit=${category.id}`} scroll={false}><strong>{category.name}</strong></Link></td>
                <td>{category.product_count ? <Link className="muted" href={`/admin/products?category=${category.id}`}>{category.product_count} products</Link> : <span className="muted">Empty</span>}</td>
                <td className="num muted">{category.sort_order}</td>
                <td className="right">{branch ? null : <Link className="button small ghost" href={`/admin/categories?edit=${category.id}`} scroll={false}>Edit</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title="No categories yet" action={<Link className="button primary" href="/admin/categories?new=1" scroll={false}>Add category</Link>} />}
      </Panel>
      {creating || current ? (
        <Drawer closeHref="/admin/categories" title={current ? current.name : "Add category"}>
          <ActionForm action={saveCategoryAction} successHref="/admin/categories">
            {current ? <input name="id" type="hidden" value={current.id} /> : null}
            <label className="field">Name<input defaultValue={current?.name} name="name" required /></label>
            <label className="field"><FieldLabel hint="Lower shows first.">Sort order</FieldLabel><input defaultValue={current?.sort_order ?? categories.length} name="sortOrder" type="number" /></label>
            <FormFooter><SubmitButton pendingLabel="Saving…">{current ? "Save changes" : "Add category"}</SubmitButton></FormFooter>
          </ActionForm>
          {current ? (
            <ActionForm action={deleteCategoryAction} className="form-section" confirm={`Delete ${current.name}?`} confirmLabel="Delete" successHref="/admin/categories">
              <input name="id" type="hidden" value={current.id} />
              <h3>Delete category</h3>
              <p>{current.product_count ? "Move its products out first." : "This category is empty."}</p>
              <FormFooter><SubmitButton className="button danger">Delete category</SubmitButton></FormFooter>
            </ActionForm>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}

// Halaman impor menu: pembungkus server untuk MenuImporter (klien).
export async function MenuImportSection({ operator, draftId }: { operator: Operator; draftId: string }) {
  const { products } = await productsData(operator, { q: "", category: "", status: "" });
  // Draf dari chat Ask Eline (migrasi 018), hanya milik outlet ini dan maksimal sehari.
  const stored = /^[0-9a-f-]{36}$/i.test(draftId)
    ? (await query<{ draft: unknown }>("SELECT draft FROM menu_drafts WHERE id=$1 AND outlet_key=$2 AND created_at > now() - interval '1 day'", [draftId, operator.outletKey])).rows[0]
    : undefined;
  const draft = stored ? menuDraftSchema.safeParse(stored.draft) : null;
  return (
    <div className="page">
      <PageHeader title="Import menu with Eline" description={draft?.success ? "Eline prepared this from your chat. Check names, prices and options, then tap Import." : "Upload your menu. Eline sets up categories, prices, sizes, and add-ons; you check before anything is saved."} action={<Link className="button" href="/admin/products">Back to products</Link>} />
      {draftId && !draft?.success ? <p className="notice">This draft has expired. Ask Eline again or upload a menu.</p> : null}
      <MenuImporter existingProducts={products.map((product) => product.name)} initialDraft={draft?.success ? draft.data : undefined} />
    </div>
  );
}
