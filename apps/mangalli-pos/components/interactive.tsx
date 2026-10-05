"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Info, LoaderCircle, Plus, Search, Upload, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, startTransition, useCallback, useActionState, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { FormState } from "@/server/http";

// Bagian interaktif design system: form aksi dengan pesan hasil di tempat,
// drawer untuk buat/edit, filter yang langsung berlaku, dan penyegar otomatis.

type Action = (state: FormState, data: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: null, pending: false });

// Notifikasi hasil aksi sebagai toast (permintaan owner 5 Okt 2026), bukan
// teks di dalam form. <Toaster /> di kerangka dashboard yang menampilkannya.
export type Toast = { id: number; tone: "ok" | "error"; message: string };
const TOAST_EVENT = "mangalli:toast";
export function showToast(tone: Toast["tone"], message: string) {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(TOAST_EVENT, { detail: { tone, message } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let next = 1;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Omit<Toast, "id">>).detail;
      const toast = { ...detail, id: next++ };
      setToasts((current) => [...current.filter((item) => item.message !== toast.message), toast].slice(-3));
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), toast.tone === "error" ? 7000 : 3500);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div aria-live="polite" className="toasts">
      {toasts.map((toast) => (
        <div className={`toast ${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
          {toast.tone === "ok" ? <Check size={16} /> : <Info size={16} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} type="button"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// Status kirim per form, supaya tombol di luar form (kaki drawer) ikut tahu.
const pendingForms = new Map<string, boolean>();
const pendingListeners = new Set<() => void>();
const notifyPending = () => pendingListeners.forEach((listener) => listener());

// Form tidak dikosongkan saat gagal, supaya isian tidak hilang. Setelah
// berhasil: pindah ke `href` dari aksi atau `successHref`, atau kosongkan
// form bila `reset`. `confirm` membuka dialog konfirmasi milik aplikasi.
export function ActionForm({ action, children, className = "form", confirm, confirmLabel = "Confirm", successHref, reset, id }: {
  action: Action; children: ReactNode; className?: string; confirm?: string; confirmLabel?: string; successHref?: string; reset?: boolean; id?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  // Pindah halaman dijalankan di dalam aksi, bukan di effect: form di drawer
  // bisa sudah hilang saat data diperbarui (misalnya setelah menghapus).
  const [state, dispatch, pending] = useActionState(async (previous: FormState, data: FormData) => {
    const result = await action(previous, data);
    if (result?.message) showToast(result.ok ? "ok" : "error", result.message);
    const href = result?.ok ? result.href ?? successHref : undefined;
    if (href) router.push(href, { scroll: false });
    return result;
  }, null);
  const [asking, setAsking] = useState<FormData | null>(null);
  useEffect(() => {
    if (!id) return;
    pendingForms.set(id, pending);
    notifyPending();
    return () => { pendingForms.delete(id); notifyPending(); };
  }, [id, pending]);
  useEffect(() => {
    if (state?.ok && !(state.href ?? successHref) && reset) ref.current?.reset();
  }, [state, successHref, reset]);
  return (
    <FormContext value={{ state, pending }}>
      <form
        className={className}
        id={id}
        ref={ref}
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
          if (confirm) setAsking(data);
          else startTransition(() => dispatch(data));
        }}
      >
        {children}
        {asking && confirm ? (
          <ConfirmDialog
            label={confirmLabel}
            message={confirm}
            onCancel={() => setAsking(null)}
            onConfirm={() => { const data = asking; setAsking(null); startTransition(() => dispatch(data)); }}
          />
        ) : null}
      </form>
    </FormContext>
  );
}

export function ConfirmDialog({ message, label, onCancel, onConfirm }: { message: string; label: string; onCancel: () => void; onConfirm: () => void }) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div aria-labelledby="confirm-title" aria-modal="true" className="dialog" onClick={(event) => event.stopPropagation()} role="alertdialog">
        <div><h2 id="confirm-title">{message}</h2><p>This can&apos;t be undone.</p></div>
        <div className="form-footer">
          <button className="button" onClick={onCancel} type="button">Keep</button>
          <button className={/^(Delete|Cancel|Remove)/.test(label) ? "button solid-danger" : "button primary"} onClick={onConfirm} ref={confirmButton} type="button">{label}</button>
        </div>
      </div>
    </div>
  );
}

export function SubmitButton({ children, className = "button primary", name, value, pendingLabel }: {
  children: ReactNode; className?: string; name?: string; value?: string; pendingLabel?: string;
}) {
  const { pending } = useContext(FormContext);
  return <button className={className} disabled={pending} name={name} type="submit" value={value}>{pending && pendingLabel ? pendingLabel : children}</button>;
}

// Tombol kirim di luar form (misalnya di kaki drawer yang selalu terlihat),
// terhubung lewat atribut `form`.
export function ExternalSubmit({ form, children, pendingLabel, className = "button primary" }: { form: string; children: ReactNode; pendingLabel?: string; className?: string }) {
  const pending = useSyncExternalStore(
    (listener) => { pendingListeners.add(listener); return () => { pendingListeners.delete(listener); }; },
    () => pendingForms.get(form) ?? false,
    () => false,
  );
  return <button className={className} disabled={pending} form={form} type="submit">{pending && pendingLabel ? pendingLabel : children}</button>;
}

export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="form-footer">{children}</div>;
}

// Sakelar satu ketukan (misalnya Tersedia/Habis). Tampil sudah berpindah
// selama aksi berjalan; kembali bila server menolak.
export function ToggleSwitch({ action, checked, label, fields, confirmOff, confirmOffLabel }: { action: Action; checked: boolean; label: string; fields: Record<string, string>; confirmOff?: string; confirmOffLabel?: string }) {
  // confirmOff: mematikan sakelar ini berbahaya (misalnya menonaktifkan anggota), jadi minta konfirmasi.
  return (
    <ActionForm action={action} className="inline-form" confirm={checked ? confirmOff : undefined} confirmLabel={confirmOffLabel}>
      {Object.entries(fields).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}
      <SwitchButton checked={checked} label={label} />
    </ActionForm>
  );
}

function SwitchButton({ checked, label }: { checked: boolean; label: string }) {
  const { pending } = useContext(FormContext);
  return <button aria-checked={pending ? !checked : checked} aria-label={label} className="switch" disabled={pending} role="switch" type="submit" />;
}

export function Drawer({ title, description, closeHref, children, footer }: { title: string; description?: string; closeHref: string; children: ReactNode; footer?: ReactNode }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Fokus ke isian pertama supaya bisa langsung mengetik; di layar sentuh ke
    // judul saja agar keyboard tidak langsung menutupi form.
    const field = window.matchMedia("(pointer: coarse)").matches ? null : heading.current?.closest(".drawer")?.querySelector<HTMLElement>(".drawer-body :is(input:not([type=hidden]), select, textarea):not(:disabled)");
    (field ?? heading.current)?.focus({ preventScroll: true });
    // Esc dari panel Ask Eline atau dropdown yang terbuka bukan untuk drawer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || (event.target as Element | null)?.closest?.(".ask-eline")) return;
      router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [closeHref, router]);
  return (
    <>
      <Link aria-label="Close panel" className="drawer-backdrop" href={closeHref} scroll={false} />
      <aside aria-labelledby="drawer-title" aria-modal="true" className="drawer" role="dialog">
        <header className="drawer-header">
          <div><h2 id="drawer-title" ref={heading} tabIndex={-1}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <Link aria-label="Close" className="icon-button" href={closeHref} scroll={false}><X size={18} /></Link>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </aside>
    </>
  );
}

// Filter daftar lewat URL: pilihan langsung berlaku, pencarian menunggu
// jeda mengetik. URL bisa dibagikan dan tombol kembali tetap bekerja.
export function FilterForm({ action, children }: { action: string; children: ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <Form
      action={action}
      className="toolbar"
      ref={ref}
      replace
      scroll={false}
      onChange={(event) => {
        clearTimeout(timer.current);
        const delay = (event.target as HTMLElement).tagName === "INPUT" ? 400 : 0;
        timer.current = setTimeout(() => ref.current?.requestSubmit(), delay);
      }}
      onSubmit={(event) => {
        // Filter kosong tidak ikut ke URL, dan pindah filter kembali ke halaman 1.
        const empty = [...event.currentTarget.querySelectorAll<HTMLInputElement>("input[name]")].filter((input) => !input.value && !input.disabled);
        empty.forEach((input) => { input.disabled = true; });
        setTimeout(() => empty.forEach((input) => { input.disabled = false; }));
      }}
    >
      {children}
    </Form>
  );
}

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

// Unggah gambar ke R2 lewat /api/uploads. Gambar diperkecil di browser dulu
// (sisi terpanjang `maxSide`, WebP/JPEG) supaya cepat di koneksi outlet.
// Nilai yang disimpan form tetap URL, jadi tautan lama tetap berlaku.
export async function shrink(file: File, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  const webp = await encode("image/webp");
  return webp && webp.type === "image/webp" ? webp : (await encode("image/jpeg")) ?? file;
}

export function ImageField({ name, label, defaultValue, kind, hint, shape = "square" }: {
  name: string; label: string; defaultValue?: string | null; kind: "product" | "logo" | "banner"; hint?: string; shape?: "square" | "wide" | "round";
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const maxSide = kind === "banner" ? 1920 : kind === "logo" ? 640 : 1200;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", await shrink(file, maxSide), "image");
      const response = await fetch("/api/uploads", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Upload failed. Try again.");
      setUrl(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="field image-field">
      {label}
      <div className="image-field-row">
        <button
          type="button"
          className={`image-preview ${shape}${url ? "" : " empty"}`}
          onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}
          aria-label={url ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded images live on R2 */}
          {url ? <img alt="" src={url} /> : <Upload size={20} />}
          {busy ? <span className="image-busy"><LoaderCircle className="spin" size={20} /></span> : null}
        </button>
        <div className="image-field-actions">
          <div className="action-row">
            <button className="button small" disabled={busy} onClick={() => input.current?.click()} type="button"><Upload size={14} /> {url ? "Replace" : "Upload"}</button>
            {url ? <button className="button small ghost danger" disabled={busy} onClick={() => setUrl("")} type="button">Remove</button> : null}
            <button className="button small ghost" onClick={() => setLinkMode(!linkMode)} type="button">{linkMode ? "Hide link" : "Link"}</button>
          </div>
          {linkMode ? <input onChange={(event) => setUrl(event.target.value.trim())} placeholder="https://" type="url" value={url} /> : null}
          <small className={error ? "form-message error" : undefined}>{error ?? hint ?? "JPG, PNG, or WebP up to 4 MB."}</small>
        </div>
      </div>
      <input accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} ref={input} type="file" />
      <input name={name} type="hidden" value={url} />
    </div>
  );
}

// Pilih area meja dari area yang sudah ada, atau ketik area baru.
export function AreaPicker({ name, areas, defaultValue }: { name: string; areas: string[]; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? areas[0] ?? "Indoor");
  const [custom, setCustom] = useState(!!defaultValue && !areas.includes(defaultValue));
  const options = [...new Set([...areas, "Indoor", "Outdoor"])];
  return (
    <div className="field">
      Area
      <div className="chips">
        {options.map((area) => (
          <button className={`chip-button${!custom && value === area ? " active" : ""}`} key={area} onClick={() => { setCustom(false); setValue(area); }} type="button">{area}</button>
        ))}
        <button className={`chip-button${custom ? " active" : ""}`} onClick={() => { setCustom(true); setValue(""); }} type="button"><Plus size={14} /> New area</button>
      </div>
      {custom ? <input autoFocus maxLength={40} onChange={(event) => setValue(event.target.value)} placeholder="e.g. Rooftop, 2nd floor, Smoking" value={value} /> : null}
      <input name={name} type="hidden" value={value} />
    </div>
  );
}

// Lapisan melayang untuk dropdown dan kalender: dirender di body dengan posisi
// tetap dari tombol pemicunya, jadi tidak terpotong drawer/panel yang bisa
// digulir. Membuka ke kiri bila sisi kanan penuh dan ke atas bila bawah penuh.
function Floating({ anchor, open, onClose, className, children, role, id, label }: {
  anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; className: string; children: ReactNode; role?: string; id?: string; label?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0, visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      const element = panel.current;
      if (!box || !element) return;
      const gap = 6;
      const margin = 8;
      const width = Math.max(element.scrollWidth, box.width);
      const below = window.innerHeight - box.bottom - gap - margin;
      const above = box.top - gap - margin;
      const height = element.scrollHeight;
      const up = height > below && above > below;
      const maxHeight = Math.max(160, Math.min(up ? above : below, 320));
      let left = box.left;
      if (left + width > window.innerWidth - margin) left = Math.max(margin, box.right - width);
      setStyle({
        position: "fixed", left, minWidth: box.width, maxHeight, visibility: "visible",
        ...(up ? { bottom: window.innerHeight - box.top + gap } : { top: box.bottom + gap }),
      });
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) onClose();
    };
    // Fase capture + stopPropagation: Esc hanya menutup lapisan ini, bukan drawer di bawahnya.
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape, true); };
  }, [open, anchor, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(<div aria-label={label} className={`floating ${className}`} id={id} ref={panel} role={role} style={style}>{children}</div>, document.body);
}

// Penjelasan isian sebagai tooltip di samping labelnya, bukan teks di bawah
// isian, supaya baris form sejajar. Muncul saat disorot mouse, diketuk, atau
// difokus lewat keyboard.
export function Hint({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <span
        aria-describedby={open ? id : undefined}
        aria-label="More info"
        className="hint-icon"
        onBlur={close}
        // Tablet: ketuk membuka (sorot hanya untuk mouse, karena sentuhan
        // langsung mengirim pointerleave), dan ketukan tidak memindahkan fokus
        // ke isian milik label. Ketuk di luar menutup lewat blur.
        onClick={(event) => { event.preventDefault(); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") close(); }}
        ref={anchor}
        role="img"
        tabIndex={0}
      >
        <Info size={14} />
      </span>
      <Floating anchor={anchor} className="tooltip" id={id} onClose={close} open={open} role="tooltip">{children}</Floating>
    </>
  );
}

/** Label isian dengan tooltip opsional: `<label className="field"><FieldLabel …/><input/></label>`. */
export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return <span className="field-label">{children}{hint ? <Hint>{hint}</Hint> : null}</span>;
}

// Pengganti <select> bawaan browser: tombol + daftar pilihan milik aplikasi.
// Nilai dikirim lewat input tersembunyi, jadi tetap bekerja di form server
// action maupun FilterForm (`submitOnChange` langsung menerapkan filter).
export function Select({ name, options, defaultValue = "", label, placeholder = "Choose…", submitOnChange = false, className = "" }: {
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  label: string;
  placeholder?: string;
  submitOnChange?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [synced, setSynced] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  // Nilai dari URL berubah (Clear, preset, tombol kembali): ikuti nilai baru.
  if (synced !== defaultValue) { setSynced(defaultValue); setValue(defaultValue); }
  const hidden = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function choose(next: string) {
    setOpen(false);
    trigger.current?.focus();
    if (next === value) return;
    setValue(next);
    if (hidden.current) hidden.current.value = next;
    if (submitOnChange) hidden.current?.form?.requestSubmit();
  }

  return (
    <div className={`select ${className}`.trim()}>
      <button
        aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}: ${selected?.label ?? placeholder}`}
        className={`select-trigger${selected ? "" : " placeholder"}`} ref={trigger} type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); show(); return; }
          if (!open) return;
          if (event.key === "Tab") setOpen(false);
          else if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
          else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (options[active]) choose(options[active].value); }
        }}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <Floating anchor={trigger} className="select-list" id={listId} label={label} onClose={() => setOpen(false)} open={open} role="listbox">
        {options.map((option, index) => (
          <div
            aria-selected={option.value === value} className={`select-option${index === active ? " active" : ""}`} id={`${listId}-${index}`} key={option.value}
            onClick={() => choose(option.value)} onPointerMove={() => setActive(index)} role="option"
          >
            <span>{option.label}</span>{option.value === value ? <Check aria-hidden="true" size={15} /> : null}
          </div>
        ))}
      </Floating>
      <input name={name} ref={hidden} type="hidden" value={value} />
    </div>
  );
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const readable = (value: string) => { const [year, month, day] = value.split("-").map(Number); return `${day} ${monthNames[month - 1].slice(0, 3)} ${year}`; };

// Pemilih tanggal milik aplikasi (pengganti <input type="date">): kalender
// satu bulan, Senin di kiri, nilai YYYY-MM-DD di input tersembunyi.
export function DateField({ name, label, defaultValue = "", placeholder = "Any date", min, max, submitOnChange = false }: {
  name: string; label: string; defaultValue?: string; placeholder?: string; min?: string; max?: string; submitOnChange?: boolean;
}) {
  const monthOf = (date: string) => { const base = date ? new Date(`${date}T00:00:00`) : new Date(); return new Date(base.getFullYear(), base.getMonth(), 1); };
  const [value, setValue] = useState(defaultValue);
  const [synced, setSynced] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(defaultValue));
  if (synced !== defaultValue) { setSynced(defaultValue); setValue(defaultValue); setView(monthOf(defaultValue)); }
  const trigger = useRef<HTMLButtonElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const today = isoDate(new Date());

  function pick(next: string) {
    setValue(next);
    setOpen(false);
    if (hidden.current) hidden.current.value = next;
    if (submitOnChange) hidden.current?.form?.requestSubmit();
  }

  const offset = (view.getDay() + 6) % 7;
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: offset }, () => null), ...Array.from({ length: days }, (_, index) => isoDate(new Date(view.getFullYear(), view.getMonth(), index + 1)))];
  return (
    <div className="select date-field">
      <button aria-expanded={open} aria-label={`${label}: ${value ? readable(value) : placeholder}`} className={`select-trigger${value ? "" : " placeholder"}`} onClick={() => setOpen(!open)} ref={trigger} type="button">
        <span>{value ? readable(value) : placeholder}</span><CalendarDays aria-hidden="true" size={16} />
      </button>
      <Floating anchor={trigger} className="select-list calendar" label={label} onClose={() => setOpen(false)} open={open} role="dialog">
        <div className="calendar-head">
          <button aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} type="button"><ChevronLeft size={16} /></button>
          <strong>{monthNames[view.getMonth()]} {view.getFullYear()}</strong>
          <button aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} type="button"><ChevronRight size={16} /></button>
        </div>
        <div className="calendar-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span className="calendar-dow" key={index}>{day}</span>)}
          {cells.map((cell, index) => cell ? (
            <button
              aria-pressed={cell === value} className={`calendar-day${cell === value ? " on" : ""}${cell === today ? " today" : ""}`}
              disabled={Boolean((min && cell < min) || (max && cell > max))} key={cell} onClick={() => pick(cell)} type="button"
            >{Number(cell.slice(8))}</button>
          ) : <span key={`blank-${index}`} />)}
        </div>
        <div className="calendar-foot">
          <button onClick={() => pick(today)} type="button">Today</button>
          {value ? <button onClick={() => pick("")} type="button">Clear</button> : null}
        </div>
      </Floating>
      <input name={name} ref={hidden} type="hidden" value={value} />
    </div>
  );
}

// Kotak cari di FilterForm. Input tidak terkontrol supaya mengetik tetap
// lancar; nilainya mengikuti URL lagi (Clear, tombol kembali) selama tidak
// sedang diketik.
export function SearchField({ name = "q", defaultValue, label, placeholder }: { name?: string; defaultValue: string; label: string; placeholder: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = defaultValue;
  }, [defaultValue]);
  return (
    <label className="search"><Search aria-hidden="true" size={16} /><span className="sr-only">{label}</span><input defaultValue={defaultValue} name={name} placeholder={placeholder} ref={input} type="search" /></label>
  );
}

// Tombol salin (mis. tautan kupon untuk konten media sosial).
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="button small ghost" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }} title={text} type="button">
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : label}
    </button>
  );
}
