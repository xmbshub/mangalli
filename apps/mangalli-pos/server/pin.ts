import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { compare } from "bcryptjs";

// PIN persetujuan manager/owner. Disimpan sebagai PBKDF2-SHA256 (bukan bcrypt)
// karena tablet memverifikasinya sendiri saat offline dengan algoritma yang
// sama seperti login kasir offline (OfflineCredentialStore.kt).
const ITERATIONS = 120_000;

export const pinPattern = /^\d{6}$/;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(pin, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (stored.startsWith("$2")) return compare(pin, stored); // hash bcrypt lama
  const [scheme, iterations, salt, digest] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "base64");
  const actual = pbkdf2Sync(pin, Buffer.from(salt, "base64"), Number(iterations), expected.length, "sha256");
  return timingSafeEqual(expected, actual);
}
