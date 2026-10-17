import "server-only";

// Times on the dashboard are shown in the outlet's own timezone; the server
// and database run in UTC.
// Day first (27 Sep 2026). en-GB writes September as "Sept"; every other month
// is three letters, so it is shortened to keep columns even.
const locale = "en-GB";
const format = (options: Intl.DateTimeFormatOptions, value: Date) => new Intl.DateTimeFormat(locale, options).format(value).replace("Sept", "Sep");

export function outletFormat(zone: string) {
  return {
    formatTime: (value: Date | string | null) =>
      value ? format({ timeZone: zone, hour: "2-digit", minute: "2-digit" }, new Date(value)) : "—",
    formatDateTime: (value: Date | string | null, withYear = false) =>
      value ? format({ timeZone: zone, day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" }, new Date(value)) : "—",
    todayLabel: () => new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(new Date()),
  };
}

// Plain dates (YYYY-MM-DD) are already local business dates.
export function formatDate(value: string | null, weekday = false): string {
  if (!value) return "—";
  return format({ timeZone: "UTC", day: "numeric", month: "short", year: "numeric", ...(weekday ? { weekday: "short" } : {}) }, new Date(`${value}T12:00:00Z`));
}

export function minutesSince(value: Date | string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

/** Lama menunggu, sama dengan elapsedLabel di APK: "Just now", "12 min", "2 h 5 min", "3 d 2 h". */
export function elapsedLabel(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}
