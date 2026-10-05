"use client";

import jsQR from "jsqr";
import { Upload } from "lucide-react";
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

const failures = {
  open: "This file can't be opened here. Upload a JPG or PNG, or take a screenshot of the QRIS and upload that.",
  none: "No QR code found. Use the QRIS file from your bank or payment app, or a straight, sharp photo of the sticker.",
  notqris: "That QR code isn't a QRIS payment code. Use the QRIS from your bank or payment app.",
};

export function QrisField({ merchantName }: { merchantName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "muted"; text: string }>(
    { tone: "muted", text: merchantName ? `Saved: ${merchantName}` : "No QRIS saved yet." });

  const upload = async (file: File) => {
    setBusy("reading");
    setMessage({ tone: "muted", text: "Reading the QR code…" });
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file).catch(() => null);
      const read: Read = bitmap ? await readQris(bitmap) : { error: "open" };
      if ("error" in read) {
        setMessage({ tone: "error", text: failures[read.error] });
        void reportQrisReadAction({ reason: read.error, type: file.type, size: file.size, width: bitmap?.width ?? 0, height: bitmap?.height ?? 0 });
        return;
      }
      setBusy("saving");
      setMessage({ tone: "muted", text: "Saving…" });
      const saved = await saveQrisAction(read.text);
      setMessage({ tone: saved.ok ? "ok" : "error", text: saved.message });
      showToast(saved.ok ? "ok" : "error", saved.message);
      if (saved.ok) router.refresh();
    } finally {
      bitmap?.close();
      setBusy(null);
    }
  };

  return (
    <div className="field">
      Store QRIS
      <div className="file-field">
        <label className={busy ? "button disabled" : "button"}>
          <Upload size={16} /> {busy === "reading" ? "Reading…" : busy === "saving" ? "Saving…" : merchantName ? "Replace image" : "Upload image"}
          <input
            accept="image/*"
            disabled={busy !== null}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {merchantName && !busy ? <button className="button ghost danger" onClick={() => setConfirmRemove(true)} type="button">Remove</button> : null}
        <span className={`hint${message.tone === "muted" ? "" : ` form-message ${message.tone}`}`}>{message.text}</span>
      </div>
      {confirmRemove ? (
        <ConfirmDialog
          label="Remove QRIS"
          message={`Remove the store QRIS${merchantName ? ` (${merchantName})` : ""}? Customers and the tablet can't pay with QRIS until you upload it again.`}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            const removed = await removeQrisAction();
            showToast(removed.ok ? "ok" : "error", removed.message);
            if (removed.ok) { setMessage({ tone: "muted", text: "No QRIS saved yet." }); router.refresh(); }
          }}
        />
      ) : null}
    </div>
  );
}
