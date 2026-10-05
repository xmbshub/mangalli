"use client";

import { useEffect, useRef, useState } from "react";

// Tooltip bersama untuk batang grafik dan sel heatmap (`[data-label]` di .bar
// dan .heat-cell). Dulu ::after CSS yang selalu di tengah elemen, sehingga
// terpotong di tepi panel (permintaan owner 5 Okt 2026). Kini satu lapisan
// fixed yang dijepit ke layar: sorot untuk mouse, ketuk untuk tablet, fokus
// untuk keyboard.
const TARGET = ".bar[data-label], .heat-cell[data-label]";

export function ChartTips() {
  const tip = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const target = (event: Event) => (event.target as Element | null)?.closest?.(TARGET) as HTMLElement | null;
    const over = (event: PointerEvent) => { if (event.pointerType === "mouse") setAnchor(target(event)); };
    const out = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !(event.relatedTarget as Element | null)?.closest?.(TARGET)) setAnchor(null);
    };
    const tap = (event: PointerEvent) => { if (event.pointerType !== "mouse") setAnchor(target(event)); };
    const focus = (event: FocusEvent) => setAnchor(target(event));
    const hide = () => setAnchor(null);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", tap);
    document.addEventListener("focusin", focus);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", tap);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  useEffect(() => {
    const element = tip.current;
    if (!anchor || !element) return;
    const box = anchor.getBoundingClientRect();
    const margin = 8;
    // Tetap di dalam kartunya (dan layar), jadi tidak menutupi sidebar.
    const card = anchor.closest(".panel")?.getBoundingClientRect();
    const minLeft = Math.max(margin, (card?.left ?? 0) + margin);
    const maxLeft = Math.min(window.innerWidth, card?.right ?? window.innerWidth) - element.offsetWidth - margin;
    const left = Math.max(minLeft, Math.min(box.left + box.width / 2 - element.offsetWidth / 2, maxLeft));
    const top = box.top - element.offsetHeight - 6 >= margin ? box.top - element.offsetHeight - 6 : box.bottom + 6;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = "visible";
  }, [anchor]);

  if (!anchor) return null;
  return <div className="floating tooltip chart-tip" ref={tip} role="tooltip" style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}>{anchor.dataset.label}</div>;
}
