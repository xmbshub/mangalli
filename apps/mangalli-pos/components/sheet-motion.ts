"use client";

import { useCallback, useEffect, useRef } from "react";

// Gerak lembar dan drawer (audit apple-design 15 Okt 2026, "Designing Fluid
// Interfaces"): di ponsel lembar ditarik mengikuti jari 1:1 dari titik ia
// dipegang, saat dilepas melanjutkan kecepatan jari, tujuan (tutup atau kembali)
// dipilih dari proyeksi momentum, dan lembar bisa dipegang lagi di tengah gerak.
// Menutup lewat tombol berjalan di jalur yang sama dengan saat muncul.

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

/** Pegas teredam kritis (damping 1.0, tanpa memantul); response dalam detik. Mengembalikan pembatal. */
export function spring(from: number, to: number, velocity: number, onUpdate: (value: number) => void, onDone: () => void, response = 0.32) {
  const omega = (2 * Math.PI) / response;
  const x0 = from - to;
  const start = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const t = (now - start) / 1000;
    const decay = Math.exp(-omega * t);
    const x = (x0 + (velocity + omega * x0) * t) * decay;
    const v = (velocity - omega * (velocity + omega * x0) * t) * decay;
    if (Math.abs(x) < 0.5 && Math.abs(v) < 20) { onUpdate(to); onDone(); return; }
    onUpdate(to + x);
    frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}

// Titik henti gerak lempar, rumus deselerasi gulir Apple (rate 0,998).
const project = (velocity: number) => (velocity / 1000) * 0.998 / (1 - 0.998);
// Melewati batas: makin jauh makin berat, tidak berhenti mendadak.
const rubberband = (overshoot: number, size: number) => (overshoot * size * 0.55) / (size + 0.55 * Math.abs(overshoot));

const translateY = (element: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42;

/**
 * Mengembalikan ref untuk lembar (sheet) dan tiranya (backdrop), serta close().
 * handle: area yang selalu bisa ditarik (kepala lembar). whole: seluruh lembar
 * bisa ditarik selama isinya tidak perlu digulir (lembar menu, bukan form yang
 * berisi isian dan pegangan seret sendiri).
 */
export function useSheetMotion<S extends HTMLElement, B extends HTMLElement>({ handle, whole = false, onClosed }: { handle: string; whole?: boolean; onClosed: () => void }) {
  const sheet = useRef<S>(null);
  const backdrop = useRef<B>(null);
  const closer = useRef<() => void>(() => {});
  const done = useRef(onClosed);
  useEffect(() => { done.current = onClosed; }, [onClosed]);

  useEffect(() => {
    const element = sheet.current;
    const shade = backdrop.current;
    if (!element) return;
    let stop: (() => void) | null = null;
    let closing = false;

    const place = (y: number) => {
      const height = element.offsetHeight || 1;
      element.style.transform = `translateY(${y < 0 ? rubberband(y, height) : y}px)`;
      if (shade) shade.style.opacity = String(Math.max(0, Math.min(1, 1 - y / height)));
    };
    const finish = () => done.current();
    const close = (from?: number, velocity = 0) => {
      if (closing) return;
      closing = true;
      if (shade) shade.style.pointerEvents = "none";
      stop?.();
      if (prefersReducedMotion()) {
        // Gerak dikurangi: cukup memudar, tanpa meluncur.
        const fade = [{ opacity: 1 }, { opacity: 0 }];
        element.animate(fade, { duration: 150, fill: "forwards" });
        shade?.animate(fade, { duration: 150, fill: "forwards" });
        window.setTimeout(finish, 150);
        return;
      }
      if (!isPhone()) {
        // Drawer desktop muncul memudar sambil naik 8 px; keluar lewat jalur yang sama.
        element.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px)" }], { duration: 160, easing: "ease-in", fill: "forwards" });
        shade?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        window.setTimeout(finish, 160);
        return;
      }
      const start = from ?? translateY(element);
      element.style.animation = "none";
      stop = spring(start, element.offsetHeight, velocity, place, finish, 0.3);
    };
    closer.current = () => close();

    let pointer: number | null = null;
    let startX = 0, startY = 0, grab = 0, base = 0, y = 0, dragging = false;
    let samples: Array<{ t: number; y: number }> = [];
    const scrollable = () => element.scrollHeight > element.clientHeight + 1;
    const onHandle = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(handle));
    // Seluruh lembar bisa ditarik hanya bila isinya tidak digulir; kalau digulir,
    // browser yang memegang gerak vertikal dan kita hanya menarik dari kepala.
    const free = () => whole && !scrollable();
    const syncTouch = () => { element.style.touchAction = isPhone() && free() ? "none" : ""; };
    syncTouch();

    const begin = (event: PointerEvent) => {
      dragging = true;
      stop?.();
      stop = null;
      base = translateY(element);
      element.style.animation = "none";
      grab = event.clientY;
      y = base;
      samples = [{ t: event.timeStamp, y: event.clientY }];
      element.setPointerCapture(event.pointerId);
      element.classList.add("dragging");
    };
    const down = (event: PointerEvent) => {
      if (!isPhone() || closing || event.button !== 0) return;
      if (!onHandle(event.target) && !free()) return;
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      // Lembar yang sedang bergerak langsung tertangkap jari, tanpa menunggu ambang.
      if (stop) begin(event);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (!dragging) {
        const dy = event.clientY - startY;
        // Ambang 10 px dan arah ke bawah dulu, supaya ketukan tetap ketukan.
        if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(event.clientX - startX)) return;
        if (dy < 0) { pointer = null; return; }
        begin(event);
        grab = startY;
      }
      event.preventDefault();
      y = base + event.clientY - grab;
      place(y);
      samples = [...samples.filter((sample) => event.timeStamp - sample.t < 100), { t: event.timeStamp, y: event.clientY }];
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (!dragging) return;
      dragging = false;
      element.classList.remove("dragging");
      // Jari yang baru menyeret tidak ikut "mengetuk" ubin di bawahnya.
      const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
      element.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => element.removeEventListener("click", swallow, { capture: true }), 0);
      const first = samples[0];
      const span = event.timeStamp - first.t;
      const velocity = event.type === "pointercancel" || span <= 0 ? 0 : ((event.clientY - first.y) / span) * 1000;
      if (y + project(velocity) > element.offsetHeight / 2) close(y, velocity);
      else stop = spring(y, 0, velocity, place, () => { stop = null; });
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    window.addEventListener("resize", syncTouch);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      window.removeEventListener("resize", syncTouch);
      stop?.();
    };
  }, [handle, whole]);

  const close = useCallback(() => closer.current(), []);
  return { sheet, backdrop, close };
}
