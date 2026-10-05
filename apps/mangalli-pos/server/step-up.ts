import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import type { Operator } from "./auth";
import { requiredEnv } from "./config";
import { pool } from "./db";
import { HttpError } from "./http";
import { verifyPin } from "./pin";

// Verifikasi ulang sebelum data penting (permintaan owner 5 Okt 2026: QRIS yang
// diganti diam-diam membuat uang pelanggan masuk ke rekening lain). Outlet
// settings, Team, dan aksi sensitif meminta PIN persetujuan 6 angka orang
// yang sedang masuk (sama dengan PIN di tablet). Hasilnya cookie bertanda tangan selama 15
// menit, terikat ke user dan outlet; server memeriksanya di setiap aksi.
export const STEP_UP_COOKIE = "mangalli_stepup";
export const STEP_UP_MINUTES = 15;

const sign = (value: string) => createHmac("sha256", requiredEnv("POS_SESSION_SECRET")).update(`step-up:${value}`).digest("base64url");

/** Waktu berakhir (ms) bila verifikasi masih berlaku untuk operator ini, selain itu null. */
export async function stepUpUntil(operator: Operator): Promise<number | null> {
  const raw = (await cookies()).get(STEP_UP_COOKIE)?.value ?? "";
  const [user, outlet, expires, signature] = raw.split("|");
  if (!user || !outlet || !expires || !signature || user !== operator.id || outlet !== operator.outletKey) return null;
  const expected = Buffer.from(sign(`${user}|${outlet}|${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(expires) > Date.now() ? Number(expires) : null;
}

// Tanpa PIN persetujuan belum ada rahasia untuk diminta; Team tetap terbuka
// supaya PIN bisa disetel, dan halaman menampilkan ajakan menyetelnya.
export async function hasStepUpSecret(operator: Operator): Promise<boolean> {
  const row = (await pool.query<{ approval_pin_hash: string | null }>("SELECT approval_pin_hash FROM users WHERE id=$1", [operator.id])).rows[0];
  return Boolean(row?.approval_pin_hash);
}

export async function requireStepUp(operator: Operator) {
  if (!(await hasStepUpSecret(operator))) return;
  if (!(await stepUpUntil(operator))) throw new HttpError(403, "For your security, open Outlet settings and enter your PIN, then try again.");
}

/** PIN persetujuan 6 angka milik operator sendiri, sama dengan PIN di tablet kasir. */
export async function checkStepUpPin(operator: Operator, pin: string): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false;
  const row = (await pool.query<{ approval_pin_hash: string | null }>("SELECT approval_pin_hash FROM users WHERE id=$1 AND is_active", [operator.id])).rows[0];
  return Boolean(row?.approval_pin_hash && (await verifyPin(pin, row.approval_pin_hash)));
}

export async function grantStepUp(operator: Operator) {
  const expires = Date.now() + STEP_UP_MINUTES * 60_000;
  const value = `${operator.id}|${operator.outletKey}|${expires}`;
  (await cookies()).set(STEP_UP_COOKIE, `${value}|${sign(value)}`, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: STEP_UP_MINUTES * 60,
  });
}

export async function endStepUp() {
  (await cookies()).delete(STEP_UP_COOKIE);
}
