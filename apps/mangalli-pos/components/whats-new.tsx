"use client";

import { Sparkles, X } from "lucide-react";
import { useSyncExternalStore } from "react";

// Catatan rilis dashboard (migrasi 017): tampil sekali per browser untuk rilis
// terbaru. Dashboard selalu sudah versi terbaru setelah deploy; kartu ini hanya
// memberi tahu apa yang berubah.
const STORAGE_KEY = "mangalli_seen_release";
export type DashboardRelease = { code: number; name: string; notes: string };

const SEEN_EVENT = "mangalli:release-seen";
// Cadangan di memori bila penyimpanan browser diblokir, supaya "Got it" tetap menutup.
let dismissed = 0;
const readSeen = () => { try { return Math.max(dismissed, Number(localStorage.getItem(STORAGE_KEY) ?? 0)); } catch { return dismissed; } };
const subscribeSeen = (callback: () => void) => {
  window.addEventListener(SEEN_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(SEEN_EVENT, callback); window.removeEventListener("storage", callback); };
};

export function WhatsNew({ release }: { release: DashboardRelease | null }) {
  // Server: anggap sudah dilihat agar kartu tidak berkedip saat hidrasi.
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => Number.POSITIVE_INFINITY);
  if (!release || seen >= release.code) return null;
  const close = () => {
    dismissed = release.code;
    try { localStorage.setItem(STORAGE_KEY, String(release.code)); } catch { /* abaikan */ }
    window.dispatchEvent(new Event(SEEN_EVENT));
  };
  const lines = release.notes.split("\n").map((line) => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
  // Dialog di tengah layar dengan latar redup, seperti panel lain di dashboard.
  return (
    <div className="whats-new-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <section aria-labelledby="whats-new-title" aria-modal="true" className="whats-new" role="dialog">
        <header className="whats-new-head">
          <span className="whats-new-icon"><Sparkles size={18} /></span>
          <div><h2 id="whats-new-title">What&apos;s new in Mangalli</h2><p>{release.name}</p></div>
          <button aria-label="Close" className="icon-button" onClick={close} type="button"><X size={16} /></button>
        </header>
        <ul className="whats-new-list">{lines.slice(0, 8).map((line) => <li key={line}>{line}</li>)}</ul>
        <footer className="whats-new-foot"><button className="button primary" onClick={close} type="button">Got it</button></footer>
      </section>
    </div>
  );
}
