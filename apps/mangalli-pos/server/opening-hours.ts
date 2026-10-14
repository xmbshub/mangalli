// Jam buka outlet dari dashboard (Outlet > Opening hours) sebagai satu-satunya
// patokan: server menolak pesanan menu digital di luar jam buka, situs menu
// memakai salinannya (apps/sites/designs/digital-menu-mobile/opening-hours.ts)
// untuk menutup checkout lebih awal. Ubah keduanya bersama. Tablet memakai
// salinan minutesSinceClose (android-pos/.../offline/OpeningHours.kt) untuk
// pengingat shift yang lupa ditutup; kasus ujinya sama.
import { localClock } from "./promotion-rules";

export type OpeningHour = { key: string; is_open?: boolean; open_time?: string | null; close_time?: string | null };

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

// Jam tutup lebih awal dari jam buka berarti lewat tengah malam (07:00–05:00):
// sisa jam setelah tengah malam milik hari sebelumnya. Jam buka = jam tutup
// berarti 24 jam. Tanpa jadwal sama sekali, outlet dianggap selalu buka.
export function openingStatus(hours: OpeningHour[], now: Date, timezone: string): { open: boolean; label: string } {
  if (!hours.length) return { open: true, label: "" };
  const { weekday, minutes } = localClock(now, timezone);
  const day = (offset: number) => hours.find((hour) => hour.key === weekdays[(weekday - 1 + offset + 7) % 7]);
  const window = (hour: OpeningHour | undefined) =>
    hour?.is_open && hour.open_time && hour.close_time ? { start: toMinutes(hour.open_time), end: toMinutes(hour.close_time), close: hour.close_time } : null;

  const yesterday = window(day(-1));
  if (yesterday && yesterday.end < yesterday.start && minutes < yesterday.end) return { open: true, label: `Open until ${yesterday.close}` };
  const today = window(day(0));
  if (today) {
    if (today.start === today.end) return { open: true, label: "Open 24 hours" };
    const overnight = today.end < today.start;
    if (minutes >= today.start && (overnight || minutes < today.end)) return { open: true, label: `Open until ${today.close}` };
    if (minutes < today.start) return { open: false, label: `Closed now · opens at ${day(0)!.open_time}` };
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = day(offset);
    if (next?.is_open && next.open_time) return { open: false, label: `Closed now · opens ${offset === 1 ? "tomorrow" : next.key[0].toUpperCase() + next.key.slice(1)} at ${next.open_time}` };
  }
  return { open: false, label: "Closed" };
}

// Berapa menit toko sudah tutup (null bila sedang buka atau tanpa jadwal). Dipakai
// pengingat "shift masih terbuka lewat jam tutup" (permintaan owner 14 Okt 2026).
// Hari 24 jam (buka = tutup) dianggap tutup pada tengah malam berikutnya.
export function minutesSinceClose(hours: OpeningHour[], now: Date, timezone: string): number | null {
  if (!hours.length || openingStatus(hours, now, timezone).open) return null;
  const { weekday, minutes } = localClock(now, timezone);
  let latest: number | null = null;
  for (let offset = 0; offset >= -7; offset -= 1) {
    const hour = hours.find((item) => item.key === weekdays[(weekday - 1 + offset + 14) % 7]);
    if (!hour?.is_open || !hour.open_time || !hour.close_time) continue;
    const start = toMinutes(hour.open_time);
    const end = toMinutes(hour.close_time);
    const close = offset * 1440 + (end === start ? 1440 : end < start ? end + 1440 : end);
    if (close <= minutes && (latest === null || close > latest)) latest = close;
  }
  return latest === null ? null : minutes - latest;
}

/** Shift masih terbuka 2 jam atau lebih setelah toko tutup (dan setelah shift dibuka). */
export const SHIFT_OVERDUE_MINUTES = 120;
export function shiftOverdue(hours: OpeningHour[], openedAt: Date, now: Date, timezone: string): number | null {
  const closed = minutesSinceClose(hours, now, timezone);
  if (closed === null) return null;
  const late = Math.min(closed, Math.floor((now.getTime() - openedAt.getTime()) / 60_000));
  return late >= SHIFT_OVERDUE_MINUTES ? closed : null;
}
