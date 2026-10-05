"use client";

import { AlertTriangle, ImagePlus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { importMenuAction } from "@/app/actions";
import { ActionForm, FormFooter, shrink, SubmitButton } from "@/components/interactive";
import type { MenuDraft } from "@/server/menu-import";

// Impor menu dengan Eline, tiga langkah di satu halaman: unggah foto/teks,
// Eline membaca (±30–60 detik), lalu owner memeriksa draf sebelum disimpan.
// Produk yang namanya sudah ada di menu ditandai dan tidak ikut diimpor.

type Photo = { id: string; file: File; preview: string };
type Product = MenuDraft["categories"][number]["products"][number] & { key: string; include: boolean; duplicate: boolean };
type Category = { key: string; name: string; products: Product[] };

const MAX_PHOTOS = 6;
const readingSteps = ["Reading the photos", "Finding categories and prices", "Working out sizes, levels, and add-ons", "Checking prices and names"];

function toCategories(draft: MenuDraft, existing: Set<string>): Category[] {
  return draft.categories.map((category, categoryIndex) => ({
    key: `c${categoryIndex}`,
    name: category.name,
    products: category.products.map((product, productIndex) => {
      const duplicate = existing.has(product.name.toLowerCase());
      return { ...product, key: `c${categoryIndex}p${productIndex}`, include: !duplicate, duplicate };
    }),
  }));
}

// initialDraft: draf yang disiapkan Eline dari chat; langsung ke langkah periksa.
export function MenuImporter({ existingProducts, initialDraft }: { existingProducts: string[]; initialDraft?: MenuDraft }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"upload" | "reading" | "review">(initialDraft ? "review" : "upload");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [categories, setCategories] = useState<Category[]>(() => (initialDraft ? toCategories(initialDraft, new Set(existingProducts.map((name) => name.toLowerCase()))) : []));
  const [warnings, setWarnings] = useState<string[]>(initialDraft?.warnings ?? []);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const existing = useMemo(() => new Set(existingProducts.map((name) => name.toLowerCase())), [existingProducts]);

  useEffect(() => {
    if (phase !== "reading") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => () => photos.forEach((photo) => URL.revokeObjectURL(photo.preview)), [photos]);

  function addFiles(list: FileList | File[]) {
    setError(null);
    const images = Array.from(list).filter((file) => /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name));
    if (images.length < Array.from(list).length) setError("Only photos are supported. For a PDF menu, take a screenshot of each page.");
    setPhotos((current) => [...current, ...images.map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file, preview: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
  }

  async function read() {
    setError(null);
    setElapsed(0);
    setPhase("reading");
    try {
      const body = new FormData();
      for (const photo of photos) body.append("files", await shrink(photo.file, 2000), "menu.jpg");
      body.set("text", text);
      const response = await fetch("/api/menu-import", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Eline couldn't read the menu. Try again.");
      const draft = result.draft as MenuDraft;
      setWarnings(draft.warnings);
      setCategories(toCategories(draft, existing));
      setPhase("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eline couldn't read the menu. Try again.");
      setPhase("upload");
    }
  }

  function updateProduct(key: string, change: Partial<Product>) {
    setCategories((current) => current.map((category) => ({ ...category, products: category.products.map((product) => (product.key === key ? { ...product, ...change } : product)) })));
  }

  const included = categories.flatMap((category) => category.products.filter((product) => product.include));
  const missingPrice = included.filter((product) => product.price === null).length;
  const toCheck = included.filter((product) => product.confidence === "low").length;
  const draft: MenuDraft = {
    outletName: null,
    warnings: [],
    categories: categories
      .map((category) => ({
        name: category.name.trim() || "Menu",
        products: category.products.filter((product) => product.include).map(({ name, description, price, optionGroups, confidence, note }) => ({ name: name.trim(), description: description?.trim() || null, price, optionGroups, confidence, note })),
      }))
      .filter((category) => category.products.length),
  };

  if (phase === "reading") {
    const step = readingSteps[Math.min(readingSteps.length - 1, Math.floor(elapsed / 12))];
    return (
      <section className="panel import-reading" aria-live="polite">
        <span className="import-orb"><Sparkles size={26} /></span>
        <h2>Eline is reading your menu</h2>
        <p>{step}…</p>
        <div className="import-progress"><span style={{ width: `${Math.min(95, elapsed * 1.6)}%` }} /></div>
        <small>{elapsed}s · usually 30 to 60 seconds. Keep this page open.</small>
      </section>
    );
  }

  if (phase === "review") {
    return (
      <div className="page-stack">
        <div className="bento">
          <article className="kpi span-3"><span className="kpi-label">Categories</span><span className="kpi-value">{draft.categories.length}</span></article>
          <article className="kpi span-3"><span className="kpi-label">Products to import</span><span className="kpi-value">{included.length}</span><span className="kpi-hint">{categories.reduce((sum, category) => sum + category.products.length, 0) - included.length} left out</span></article>
          <article className="kpi span-3"><span className="kpi-label">Option groups</span><span className="kpi-value">{included.reduce((sum, product) => sum + product.optionGroups.length, 0)}</span><span className="kpi-hint">Sizes, levels, add-ons</span></article>
          <article className="kpi span-3"><span className="kpi-label">Needs a look</span><span className={`kpi-value${toCheck ? " warn" : ""}`}>{toCheck}</span><span className="kpi-hint">{toCheck ? "Marked below" : "Everything read clearly"}</span></article>
        </div>
        {warnings.length ? (
          <div className="import-warnings">{warnings.map((warning) => <p key={warning}><AlertTriangle size={15} /> {warning}</p>)}</div>
        ) : null}
        {categories.map((category) => (
          <section className="panel" key={category.key}>
            <header className="panel-header">
              <input aria-label="Category name" className="import-category" onChange={(event) => setCategories((current) => current.map((item) => (item.key === category.key ? { ...item, name: event.target.value } : item)))} value={category.name} />
              <span className="cell-sub">{category.products.filter((product) => product.include).length} of {category.products.length}</span>
            </header>
            <div className="import-list">
              {category.products.map((product) => (
                <div className={`import-row${product.include ? "" : " off"}${product.confidence === "low" && product.include ? " check" : ""}`} key={product.key}>
                  <button aria-checked={product.include} aria-label={`Import ${product.name}`} className="switch" disabled={product.duplicate} onClick={() => updateProduct(product.key, { include: !product.include })} role="switch" type="button" />
                  <div className="import-main">
                    <input aria-label="Product name" className="import-name" onChange={(event) => updateProduct(product.key, { name: event.target.value })} value={product.name} />
                    <input aria-label="Description" className="import-desc" onChange={(event) => updateProduct(product.key, { description: event.target.value })} placeholder="No description" value={product.description ?? ""} />
                    {product.optionGroups.length ? (
                      <div className="import-groups">{product.optionGroups.map((group, groupIndex) => (
                        <span className="import-group" key={`${group.name}-${groupIndex}`}>
                          <strong>{group.name}</strong>{group.required ? " · required" : ` · up to ${group.maxSelect}`}: {group.options.map((option) => `${option.name}${option.priceDelta ? ` +${option.priceDelta.toLocaleString("id-ID")}` : ""}`).join(", ")}
                          <button aria-label={`Remove ${group.name}`} onClick={() => updateProduct(product.key, { optionGroups: product.optionGroups.filter((_, index) => index !== groupIndex) })} type="button"><X size={13} /></button>
                        </span>
                      ))}</div>
                    ) : null}
                    {product.duplicate ? <span className="import-note">Already on your menu, so it won&apos;t be imported.</span> : product.note ? <span className="import-note"><AlertTriangle size={13} /> {product.note}</span> : null}
                  </div>
                  <label className="import-price">
                    <span>Rp</span>
                    <input aria-label="Price" inputMode="numeric" onChange={(event) => { const digits = event.target.value.replace(/\D/g, ""); updateProduct(product.key, { price: digits ? Number(digits) : null, confidence: digits ? product.confidence : "low" }); }} placeholder="Price" value={product.price === null ? "" : product.price.toLocaleString("id-ID")} />
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))}
        <div className="import-bar">
          <button className="button" onClick={() => { setPhase("upload"); setCategories([]); }} type="button"><RotateCcw size={16} /> Start over</button>
          <ActionForm action={importMenuAction} className="inline-form">
            <input name="draft" type="hidden" value={JSON.stringify(draft)} />
            <FormFooter>
              {missingPrice ? <span className="form-message error">{missingPrice} product{missingPrice > 1 ? "s need" : " needs"} a price.</span> : null}
              <SubmitButton pendingLabel="Importing…">{`Import ${included.length} product${included.length === 1 ? "" : "s"}`}</SubmitButton>
            </FormFooter>
          </ActionForm>
        </div>
      </div>
    );
  }

  return (
    <div className="bento">
      <section className="panel span-8">
        <header className="panel-header"><div><h2>Menu photos</h2><p>Up to {MAX_PHOTOS} photos, in page order.</p></div><span className="cell-sub">{photos.length}/{MAX_PHOTOS}</span></header>
        <div className="panel-body">
          <button
            className={`import-drop${dragging ? " over" : ""}`}
            disabled={photos.length >= MAX_PHOTOS}
            onClick={() => input.current?.click()}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
            type="button"
          >
            <ImagePlus size={28} />
            <strong>{photos.length ? "Add more pages" : "Drop menu photos here"}</strong>
            <span>or tap to choose from your phone or computer</span>
          </button>
          {photos.length ? (
            <div className="import-thumbs">{photos.map((photo, index) => (
              <figure key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img alt={`Page ${index + 1}`} src={photo.preview} />
                <figcaption>Page {index + 1}</figcaption>
                <button aria-label={`Remove page ${index + 1}`} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} type="button"><X size={14} /></button>
              </figure>
            ))}</div>
          ) : null}
          <label className="field">Or paste the menu as text<textarea maxLength={8000} onChange={(event) => setText(event.target.value)} placeholder={"e.g. from WhatsApp:\nNasi Goreng 18rb\nEs Teh 5k / Jumbo 7k"} rows={4} value={text} /></label>
          {error ? <p className="form-message error">{error}</p> : null}
          <div className="form-footer">
            <button className="button primary" disabled={!photos.length && !text.trim()} onClick={read} type="button"><Sparkles size={16} /> Read menu with Eline</button>
          </div>
          <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} ref={input} type="file" />
        </div>
      </section>
      <section className="panel span-4">
        <header className="panel-header"><div><h2>How it works</h2><p>Nothing is saved until you import.</p></div></header>
        <ol className="import-steps">
          <li><strong>Upload your menu</strong><span>Photos of the printed menu, a menu board, or a screenshot.</span></li>
          <li><strong>Eline reads it</strong><span>Categories, prices, sizes, spice levels, and add-ons are set up for you.</span></li>
          <li><strong>You check and import</strong><span>Fix anything marked, switch off items you don&apos;t sell, then import.</span></li>
        </ol>
        <div className="import-tips">
          <strong>For the best result</strong>
          <span>Straight, sharp, well-lit photos</span>
          <span>One page per photo, nothing cut off</span>
          <span>Include add-on and topping lists</span>
          <span>PDF menu? Screenshot each page</span>
        </div>
      </section>
    </div>
  );
}
