"use client";

import { Delete } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useActionFormState } from "@/components/interactive";

const LENGTH = 6;
// "clear" di kiri mengimbangi hapus di kanan (permintaan owner 5 Okt 2026).
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

// PIN 6 angka sebagai titik (permintaan owner 5 Okt 2026, meniru layar passcode
// ponsel; sama dengan PinPad di tablet). Isian asli tetap ada dan tersembunyi di
// balik titik, jadi papan ketik fisik, pengelola sandi, dan pembaca layar tetap
// bekerja. Dengan `keypad`, layar sentuh memakai papan angka besar tanpa
// memunculkan keyboard sistem; `autoSubmit` mengirim form begitu angka keenam
// masuk. PIN salah membuat titik bergetar lalu kosong untuk dicoba lagi.
export function PinField({ name = "pin", label = "6-digit PIN", keypad = false, autoSubmit = false, autoFocus = true }: {
  name?: string; label?: string; keypad?: boolean; autoSubmit?: boolean; autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const { state, pending } = useActionFormState();

  // Layar sentuh dengan papan angka: keyboard sistem tidak perlu muncul.
  useEffect(() => {
    const coarse = keypad && window.matchMedia("(pointer: coarse)").matches;
    if (coarse && input.current) input.current.inputMode = "none";
    if (autoFocus && !coarse) input.current?.focus({ preventScroll: true });
  }, [keypad, autoFocus]);

  // Sesudah PIN salah isian sempat nonaktif (form dikirim), jadi fokusnya hilang; kembalikan
  // supaya keyboard fisik bisa langsung mengetik ulang.
  useEffect(() => {
    if (shake && !window.matchMedia("(pointer: coarse)").matches) input.current?.focus({ preventScroll: true });
  }, [shake]);

  // Hasil gagal dari server (PIN salah, terlalu sering): kosongkan dan getarkan.
  // Hanya untuk form yang isinya PIN saja; di form Team galat kolom lain tidak menghapus PIN.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (autoSubmit && state && !state.ok) {
      setValue("");
      setShake((count) => count + 1);
    }
  }

  const update = (next: string) => {
    const digits = next.replace(/\D/g, "").slice(0, LENGTH);
    setValue(digits);
    if (autoSubmit && digits.length === LENGTH) {
      // Tunggu React menulis nilai ke isian tersembunyi sebelum form dibaca.
      requestAnimationFrame(() => input.current?.form?.requestSubmit());
    }
  };

  return (
    <div className={keypad ? "pin-field with-keypad" : "pin-field"}>
      <label className="pin-dots" data-shake={shake % 2 ? "a" : shake ? "b" : undefined}>
        <input
          aria-label={label}
          autoComplete="off"
          className="pin-input"
          disabled={pending}
          inputMode="numeric"
          maxLength={LENGTH}
          minLength={LENGTH}
          name={name}
          onChange={(event) => update(event.target.value)}
          pattern={`[0-9]{${LENGTH}}`}
          ref={input}
          required={autoSubmit}
          type="password"
          value={value}
        />
        {Array.from({ length: LENGTH }, (_, index) => <span aria-hidden="true" className={index < value.length ? "pin-dot filled" : "pin-dot"} key={index} />)}
      </label>
      {autoSubmit ? <p aria-live="polite" className={state && !state.ok && !pending ? "pin-status error" : "pin-status"}>{pending ? "Checking…" : state && !state.ok ? state.message : ""}</p> : null}
      {keypad ? (
        <div className="pin-keypad">
          {KEYS.map((key) => (
            <button
              aria-label={key === "back" ? "Delete" : key === "clear" ? "Clear PIN" : key}
              className={key === "clear" ? "pin-key pin-key-text" : "pin-key"}
              disabled={pending || (key === "back" || key === "clear" ? !value : value.length === LENGTH)}
              key={key}
              onClick={() => update(key === "back" ? value.slice(0, -1) : key === "clear" ? "" : value + key)}
              type="button"
            >
              {key === "back" ? <Delete size={22} /> : key === "clear" ? "Clear" : key}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
