"use client";

import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { showToast } from "@/components/interactive";
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
    latest.current = next;
    setOrder(next);
  };

  const startDrag = (id: string) => {
    before.current = latest.current;
    document.body.classList.add("is-sorting");
    setDragging(id);
    const onMove = (event: PointerEvent) => move(id, event.clientY);
    const finish = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-sorting");
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
                setOrder(next);
                void save(next, previous);
              }}
              onPointerDown={(event) => { event.preventDefault(); startDrag(id); }}
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
