"use client";

import { useEffect, useRef } from "react";

// Kolom PIN 6 angka yang langsung aktif tanpa menggulir halaman di belakang dialog.
export function PinField({ name = "pin" }: { name?: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <input aria-label="6-digit PIN" autoComplete="off" inputMode="numeric" maxLength={6} minLength={6} name={name} pattern="[0-9]{6}" placeholder="6-digit PIN" ref={input} required type="password" />;
}
