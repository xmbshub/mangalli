"use client";

import { FileArchive, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ConfirmDialog, showToast } from "@/components/interactive";

// Impor berkas data Mangalli ke outlet kosong (POST /api/data/import). Tetap
// terpasang setelah impor (outlet tidak kosong lagi) supaya ringkasannya terbaca.
export function DataImport({ empty }: { empty: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const start = async () => {
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/data/import", { method: "POST", body });
      const result = await response.json().catch(() => ({})) as { message?: string; products?: number; orders?: number; shifts?: number; expenses?: number; unmatchedPeople?: string[] };
      if (!response.ok) throw new Error(result.message ?? "Import failed.");
      const missing = result.unmatchedPeople?.length ? ` History by ${result.unmatchedPeople.join(", ")} shows without a name; add them to the team before the next import.` : "";
      showToast("ok", "Data imported.");
      setMessage({ ok: true, text: `Imported ${result.products} products, ${result.orders} orders, ${result.shifts} shifts and ${result.expenses} expenses.${missing}` });
      setFile(null);
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Import failed.";
      showToast("error", text);
      setMessage({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="data-import">
      {!empty && !message ? <span className="muted small">Not available</span> : null}
      {empty ? <div className="inline-form">
        <button className="button small" disabled={busy} onClick={() => input.current?.click()} type="button">
          {file ? <FileArchive size={16} /> : <Upload size={16} />}<span className="truncate">{file ? file.name : "Choose file"}</span>
        </button>
        <button className="button small primary" disabled={!file || busy} onClick={() => setAsking(true)} type="button">{busy ? "Importing…" : "Import"}</button>
      </div> : null}
      {message ? <p className={`form-message ${message.ok ? "ok" : "error"}`}>{message.text}</p> : null}
      {asking && file ? (
        <ConfirmDialog
          label="Import data"
          message={`Import ${file.name} into this outlet? Its menu, tables, orders, shifts and expenses are added here.`}
          onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); void start(); }}
        />
      ) : null}
      <input accept=".zip,application/zip" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(null); event.target.value = ""; }} ref={input} type="file" />
    </div>
  );
}
