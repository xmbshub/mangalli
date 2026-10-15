"use client";

import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { showToast } from "@/components/interactive";
import { prefersReducedMotion } from "@/components/sheet-motion";
import type { FormState } from "@/server/http";

// Susun ulang dengan menyeret pegangan (permintaan owner 5 Okt 2026: urutan
// varian tanpa mengubah satu per satu). Pointer events supaya jari di tablet
// dan mouse sama-sama bekerja; panah atas/bawah pada pegangan untuk keyboard.
// Urutan baru dikirim utuh ke server sekali saat dilepas.
export function Sortable({ items, onReorder, label, className = "" }: {
  items: Array<{ id: string; node: ReactNode; name: string }>;
  onReorder: (ids: string[]) => Promise<FormState>;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const before = useRef<string[]>([]);
  // Urutan terbaru untuk pendengar window (baris yang dipindah React di DOM
  // kehilangan pointer capture, jadi gerak dan lepas didengar di window).
  const latest = useRef(order);
  useEffect(() => { latest.current = order; }, [order]);
  // Daftar dari server berubah (tambah/hapus): ikuti urutan server.
  const serverKey = items.map((item) => item.id).join(",");
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    setOrder(items.map((item) => item.id));
  }
  const byId = new Map(items.map((item) => [item.id, item]));

  const save = async (next: string[], previous: string[]) => {
    if (next.join(",") === previous.join(",")) return;
    const result = await onReorder(next);
    if (result?.message) showToast(result.ok ? "ok" : "error", result.message);
    if (result?.ok) router.refresh();
    else setOrder(previous);
  };

  // Gerak seret (audit apple-design 15 Okt 2026): baris yang dipegang menempel di
  // jari dari titik ia dipegang, baris lain bergeser halus ke tempat barunya
  // (FLIP dari posisi yang sedang tampil, jadi geseran bisa disela), dan saat
  // dilepas baris meluncur masuk ke slotnya.
  const drag = useRef<{ id: string; grab: number; pointer: number } | null>(null);
  const shown = useRef(new Map<string, number>());
  const follow = useCallback(() => {
    const current = drag.current;
    const row = current ? rows.current.get(current.id) : null;
    if (!current || !row) return;
    row.style.transform = "";
    row.style.transform = `translateY(${current.pointer - current.grab - row.getBoundingClientRect().top}px)`;
  }, []);
  const remember = () => rows.current.forEach((row, id) => shown.current.set(id, row.getBoundingClientRect().top));
  useLayoutEffect(() => {
    const before = shown.current;
    if (!before.size) return;
    shown.current = new Map();
    rows.current.forEach((row, id) => {
      if (id === drag.current?.id) return;
      const from = before.get(id);
      row.getAnimations().forEach((animation) => animation.cancel());
      const delta = from === undefined ? 0 : from - row.getBoundingClientRect().top;
      if (Math.abs(delta) < 1 || prefersReducedMotion()) return;
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" });
    });
    follow();
  }, [order, follow]);

  const move = (id: string, clientY: number) => {
    const current = latest.current;
    const from = current.indexOf(id);
    let to = from;
    current.forEach((other, index) => {
      const rect = rows.current.get(other)?.getBoundingClientRect();
      if (!rect || other === id) return;
      const middle = rect.top + rect.height / 2;
      if (index < from && clientY < middle) to = Math.min(to, index);
      if (index > from && clientY > middle) to = Math.max(to, index);
    });
    if (to === from) return;
    const next = current.filter((other) => other !== id);
    next.splice(to, 0, id);
    // Posisi yang sedang tampil (termasuk geseran yang belum selesai) jadi titik awal FLIP.
    remember();
    latest.current = next;
    setOrder(next);
  };

  const startDrag = (id: string, clientY: number) => {
    const row = rows.current.get(id);
    if (!row) return;
    row.getAnimations().forEach((animation) => animation.cancel());
    before.current = latest.current;
    drag.current = { id, grab: clientY - row.getBoundingClientRect().top, pointer: clientY };
    document.body.classList.add("is-sorting");
    setDragging(id);
    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      drag.current.pointer = event.clientY;
      follow();
      move(id, event.clientY);
    };
    const finish = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-sorting");
      drag.current = null;
      // Dari posisi jari ke slot, tanpa melompat.
      const offset = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
      const landed = rows.current.get(id);
      if (landed) {
        landed.style.transform = "";
        if (offset && !prefersReducedMotion()) landed.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)" });
      }
      setDragging(null);
      if (event.type === "pointercancel") { setOrder(before.current); return; }
      void save(latest.current, before.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div aria-label={label} className={`sortable ${className}`.trim()} role="list">
      {order.map((id, index) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <div className={dragging === id ? "sortable-row dragging" : "sortable-row"} key={id} ref={(node) => { if (node) rows.current.set(id, node); else rows.current.delete(id); }} role="listitem">
            <button
              aria-label={`Move ${item.name}. Drag, or use the arrow keys.`}
              className="sortable-handle"
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                const to = index + (event.key === "ArrowUp" ? -1 : 1);
                if (to < 0 || to >= order.length) return;
                const next = order.filter((other) => other !== id);
                next.splice(to, 0, id);
                const previous = order;
                remember();
                setOrder(next);
                void save(next, previous);
              }}
              onPointerDown={(event) => { event.preventDefault(); startDrag(id, event.clientY); }}
              type="button"
            >
              <GripVertical size={16} />
            </button>
            <div className="sortable-body">{item.node}</div>
          </div>
        );
      })}
    </div>
  );
}
