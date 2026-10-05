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
    formatDateTime: (value: Date | string | null) =>
      value ? format({ timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, new Date(value)) : "—",
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
