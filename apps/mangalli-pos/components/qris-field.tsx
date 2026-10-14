"use client";

import jsQR from "jsqr";
import { LoaderCircle, QrCode, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { removeQrisAction, reportQrisReadAction, saveQrisAction } from "@/app/actions";
import { ConfirmDialog, showToast } from "@/components/interactive";

// The owner uploads the store's QRIS image (a photo of the cashier sticker or
// the file from the bank). It is decoded in the browser and only the QRIS text
// is sent; the server checks it and saves it right away. Failures are reported
// to Support (without the image) so they are visible to 1garis Studio.
type Read = { text: string } | { error: "open" | "none" | "notqris" };
type Detector = new (options: { formats: string[] }) => { detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>> };

function scan(bitmap: ImageBitmap, maxSide: number, crop: number): string | null {
  const sw = bitmap.width * crop;
  const sh = bitmap.height * crop;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

async function readQris(bitmap: ImageBitmap): Promise<Read> {
  const found: string[] = [];
  // The browser's own detector (Chrome on Android and ChromeOS) handles glare and angles best.
  const NativeDetector = (window as unknown as { BarcodeDetector?: Detector }).BarcodeDetector;
  if (NativeDetector) {
    try {
      found.push(...(await new NativeDetector({ formats: ["qr_code"] }).detect(bitmap)).map((code) => code.rawValue));
    } catch { /* fall back to jsQR */ }
  }
  // Several sizes and a centre crop: phone photos are large and the QR is often a small part of them.
  for (const crop of [1, 0.6]) {
    if (found.some((text) => text.trim().startsWith("000201"))) break;
    for (const maxSide of [2400, 1600, 1000, 700]) {
      const text = scan(bitmap, maxSide, crop);
      if (text) { found.push(text); break; }
    }
  }
  const qris = found.map((text) => text.trim()).find((text) => text.startsWith("000201"));
  return qris ? { text: qris } : { error: found.length ? "notqris" : "none" };
}

// Berkas QRIS dari bank sering berupa PDF (permintaan owner 13 Okt 2026). PDF digambar
// halaman demi halaman (paling banyak 3) dengan pdf.js tanpa worker terpisah; gambar
// yang tidak bisa dibuka createImageBitmap (SVG, HEIC di Safari) lewat elemen <img>.
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

async function canvasBitmap(draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => Promise<void> | void, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await draw(context, canvas);
  return createImageBitmap(canvas);
}

async function* pages(file: File): AsyncGenerator<ImageBitmap> {
  if (isPdf(file)) {
    const pdfjs = await import("pdfjs-dist");
    // @ts-expect-error -- pdf.js has no types for its worker; importing it registers globalThis.pdfjsWorker (main-thread worker).
    await import("pdfjs-dist/build/pdf.worker.min.mjs");
    // PDF dari luar: hanya digambar, formulir XFA tidak dijalankan (pdf.js 6 tidak memakai eval).
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false });
    const pdf = await task.promise;
    try {
      for (let number = 1; number <= Math.min(pdf.numPages, 3); number += 1) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(4, 2400 / Math.max(base.width, base.height)) });
        const bitmap = await canvasBitmap((_context, canvas) => page.render({ canvas, viewport }).promise, viewport.width, viewport.height);
        if (bitmap) yield bitmap;
      }
    } finally {
      void task.destroy();
    }
    return;
  }
  const direct = await createImageBitmap(file).catch(() => null);
  if (direct) { yield direct; return; }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth || 1200, image.naturalHeight || 1200));
    const bitmap = await canvasBitmap((context, canvas) => context.drawImage(image, 0, 0, canvas.width, canvas.height), (image.naturalWidth || 1200) * scale, (image.naturalHeight || 1200) * scale);
    if (bitmap) yield bitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const failures = {
  open: "This file can't be opened here. Use a JPG, PNG, WebP or PDF, or take a screenshot of the QRIS and upload that.",
  none: "No QR code found. Use the QRIS file from your bank or payment app, or a straight, sharp photo of the sticker.",
  notqris: "That QR code isn't a QRIS payment code. Use the QRIS from your bank or payment app.",
};

export function QrisField({ merchantName }: { merchantName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy("reading");
    setError(null);
    let read: Read = { error: "open" };
    let size = { width: 0, height: 0 };
    try {
      for await (const bitmap of pages(file)) {
        size = { width: bitmap.width, height: bitmap.height };
        try { read = await readQris(bitmap); } finally { bitmap.close(); }
        if ("text" in read) break;
      }
    } catch (reason) {
      console.error("QRIS file couldn't be read", reason);
      read = { error: "open" };
    }
    try {
      if ("error" in read) {
        setError(failures[read.error]);
        void reportQrisReadAction({ reason: read.error, type: file.type || file.name.split(".").pop() || "", size: file.size, ...size });
        return;
      }
      setBusy("saving");
      const saved = await saveQrisAction(read.text);
      showToast(saved.ok ? "ok" : "error", saved.message);
      if (saved.ok) router.refresh(); else setError(saved.message);
    } finally {
      setBusy(null);
    }
  };

  const picker = (
    <label className={busy ? "button small disabled" : "button small"}>
      {busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />} {busy === "reading" ? "Reading…" : busy === "saving" ? "Saving…" : merchantName ? "Replace" : "Upload QRIS"}
      <input
        accept="image/*,application/pdf,.pdf,.heic,.heif,.svg"
        disabled={busy !== null}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </label>
  );

  // Status QRIS sebagai kartu sendiri (nama merchant + lencana), bukan teks di samping tombol.
  return (
    <div className="field">
      Store QRIS
      <div className={`qris-status${merchantName ? "" : " empty"}`}>
        <span className="qris-status-icon"><QrCode size={18} /></span>
        <span className="qris-status-text">
          <span className="qris-status-name"><strong>{merchantName ?? "No QRIS yet"}</strong>{merchantName ? <span className="badge tone-success">Saved</span> : null}</span>
          <small>{merchantName ? "Tablets get it at next sync" : "Image or PDF from your bank"}</small>
        </span>
        <span className="qris-status-actions">
          {picker}
          {merchantName && !busy ? <button className="button small ghost danger" onClick={() => setConfirmRemove(true)} type="button">Remove</button> : null}
        </span>
      </div>
      {error ? <small className="form-message error" role="alert">{error}</small> : null}
      {confirmRemove ? (
        <ConfirmDialog
          label="Remove QRIS"
          message={`Remove the store QRIS${merchantName ? ` (${merchantName})` : ""}? Customers and the tablet can't pay with QRIS until you upload it again.`}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            const removed = await removeQrisAction();
            showToast(removed.ok ? "ok" : "error", removed.message);
            if (removed.ok) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
