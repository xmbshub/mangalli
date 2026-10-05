"use client";

import { Bell, BellOff, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Alert = { id: string; code: string | null; paid: boolean; where: string; customer: string | null };

const STORAGE_KEY = "mangalli.orderSound";
const SOUND_EVENT = "mangalli:order-sound";
const POLL_MS = 10_000;

// Pilihan suara disimpan per peramban dan dibaca sebagai external store, jadi
// tombol sidebar dan kartu notifikasi selalu sepakat tanpa state ganda.
const readSound = () => { try { return localStorage.getItem(STORAGE_KEY) !== "off"; } catch { return true; } };
const subscribeSound = (callback: () => void) => {
  window.addEventListener(SOUND_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(SOUND_EVENT, callback); window.removeEventListener("storage", callback); };
};
const useSoundOn = () => useSyncExternalStore(subscribeSound, readSound, () => true);

// Notifikasi pesanan menu digital (permintaan owner 4 Okt 2026): dashboard
// menanyakan pesanan baru tiap 10 detik, membunyikan chime yang sama dengan
// tablet, menampilkan kartu pesanan, dan menandai judul tab. Peramban baru
// mengizinkan suara setelah ada klik di halaman, jadi kartu menawarkan tombol
// untuk menyalakannya bila pemutaran pertama ditolak.
export function OrderAlerts() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const soundOn = useSoundOn();
  const [blocked, setBlocked] = useState(false);
  const cursor = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(() => {
    const sound = audio.current;
    if (!sound) return;
    sound.currentTime = 0;
    sound.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, []);

  useEffect(() => {
    audio.current = new Audio("/sounds/order-chime.wav");
    audio.current.preload = "auto";
    // Tombol di sidebar mengabarkan perubahan lewat event ini; menyalakan suara
    // adalah klik pengguna, jadi saat itulah chime contoh boleh diputar.
    const changed = (event: Event) => { if ((event as CustomEvent<boolean>).detail) play(); };
    window.addEventListener(SOUND_EVENT, changed);
    return () => window.removeEventListener(SOUND_EVENT, changed);
  }, [play]);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const query = cursor.current === null ? "" : `?after=${cursor.current}`;
        const response = await fetch(`/api/order-alerts${query}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { latestId: string; orders: Alert[] };
        if (stopped) return;
        const fresh = cursor.current === null ? [] : data.orders;
        // Kursor tidak boleh mundur dari pesanan yang sudah ditampilkan.
        const ids = [data.latestId, ...fresh.map((item) => item.id)].map(BigInt);
        cursor.current = ids.reduce((a, b) => (a > b ? a : b)).toString();
        if (!fresh.length) return;
        setAlerts((current) => [...fresh.reverse(), ...current].slice(0, 4));
        if (readSound()) play();
        router.refresh();
      } catch {
        // Gagal jaringan: dicoba lagi di putaran berikutnya.
      }
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [play, router]);

  // Judul tab menghitung pesanan yang belum dilihat, supaya tetap terlihat dari
  // tab lain. Next menulis ulang <title> setiap navigasi dan router.refresh, jadi
  // tanda dipasang ulang lewat MutationObserver, bukan sekali saja.
  useEffect(() => {
    const apply = () => {
      const plain = document.title.replace(/^\(\d+\) /, "");
      const wanted = alerts.length ? `(${alerts.length}) ${plain}` : plain;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [alerts.length]);

  const dismiss = (id: string) => setAlerts((current) => current.filter((item) => item.id !== id));

  return (
    <div aria-live="polite" className="order-alerts">
        {alerts.map((alert) => (
          <div className="order-alert" key={alert.id} role="status">
            <span className="order-alert-icon"><Bell size={18} /></span>
            <div className="order-alert-body">
              <strong>New digital menu order{alert.code ? ` · ${alert.code}` : ""}</strong>
              <span>{alert.where}{alert.customer ? ` · ${alert.customer}` : ""} · {alert.paid ? "Paid, sent to kitchen" : "Awaiting payment"}</span>
              <div className="order-alert-actions">
                <Link className="button small primary" href={alert.paid ? "/admin/kitchen" : "/admin/orders?tab=unpaid"} onClick={() => dismiss(alert.id)}>{alert.paid ? "Open kitchen" : "View order"}</Link>
                {blocked && soundOn ? <button className="button small" onClick={play} type="button">Turn on sound</button> : null}
              </div>
            </div>
            <button aria-label="Dismiss" className="icon-button small" onClick={() => dismiss(alert.id)} type="button"><X size={16} /></button>
          </div>
        ))}
    </div>
  );
}

// Tombol suara di sidebar. Pilihan disimpan per peramban.
export function OrderSoundToggle() {
  const soundOn = useSoundOn();
  const toggle = () => {
    const next = !soundOn;
    try { localStorage.setItem(STORAGE_KEY, next ? "on" : "off"); } catch { /* abaikan */ }
    window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: next }));
  };
  return (
    <button aria-checked={soundOn} onClick={toggle} role="menuitemcheckbox" type="button">
      <span>Order sound {soundOn ? "on" : "off"}</span>{soundOn ? <Bell size={15} /> : <BellOff size={15} />}
    </button>
  );
}
