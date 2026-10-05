// Jendela hari usaha untuk email laporan harian, dari jam buka outlet.
// Murni (tanpa database) supaya bisa dites. Waktu ditulis sebagai waktu lokal
// outlet "YYYY-MM-DD HH:MM"; database mengubahnya dengan AT TIME ZONE.
import type { OpeningHour } from "./opening-hours";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function addMinutes(date: string, minutes: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMinutes(value.getUTCMinutes() + minutes);
  return value.toISOString().slice(0, 16).replace("T", " ");
}
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export type BusinessWindow = { start: string; end: string; sendAt: string; open: boolean };

// Buka biasa: hari kalender penuh, dikirim 30 menit setelah jam tutup.
// Lewat tengah malam (07:00–05:00): dari jam buka sampai jam tutup besok pagi,
// dikirim 30 menit sesudahnya. Libur atau tanpa jadwal: hari kalender, 23:30.
export function businessWindow(hours: OpeningHour[], date: string): BusinessWindow {
  const weekday = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const hour = hours.find((item) => item.key === weekday);
  const fullDay = { start: addMinutes(date, 0), end: addMinutes(date, 24 * 60) };
  if (!hour?.is_open || !hour.open_time || !hour.close_time) return { ...fullDay, sendAt: addMinutes(date, 23 * 60 + 30), open: false };
  const open = toMinutes(hour.open_time);
  const close = toMinutes(hour.close_time);
  if (close === open) return { ...fullDay, sendAt: addMinutes(date, 24 * 60 + 30), open: true };
  if (close < open) return { start: addMinutes(date, open), end: addMinutes(date, 24 * 60 + close), sendAt: addMinutes(date, 24 * 60 + close + 30), open: true };
  return { ...fullDay, sendAt: addMinutes(date, close + 30), open: true };
}

// Waktu lokal sekarang di zona outlet, format sama dengan BusinessWindow.
export function localNow(now: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export const shiftDate = (date: string, days: number) => addMinutes(date, days * 24 * 60).slice(0, 10);

// Hari usaha yang laporannya jatuh tempo sekarang: kemarin atau hari ini (waktu
// lokal outlet) yang jam kirimnya sudah lewat, paling lama 18 jam yang lalu,
// supaya rilis pertama tidak mengirim laporan hari-hari lama.
export function dueDates(hours: OpeningHour[], now: string): string[] {
  const today = now.slice(0, 10);
  const earliest = (() => { const value = new Date(`${now.replace(" ", "T")}:00Z`); value.setUTCHours(value.getUTCHours() - 18); return value.toISOString().slice(0, 16).replace("T", " "); })();
  return [shiftDate(today, -1), today].filter((date) => {
    const { sendAt } = businessWindow(hours, date);
    return sendAt <= now && sendAt >= earliest;
  });
}
