import { t } from "./i18n";

/** SQLite `datetime('now')` values are UTC without a timezone suffix. */
export function parseUtc(sqliteUtc: string): number {
  return new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
}

export function minutesBetween(fromUtc: string, toMs = Date.now()): number {
  return Math.max(0, Math.round((toMs - parseUtc(fromUtc)) / 60000));
}

export function relativeAge(sqliteUtc: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - parseUtc(sqliteUtc)) / 60000));
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("daysAgo", { n: days });
  return t("monthsAgo", { n: Math.floor(days / 30) });
}

export function daysSince(sqliteUtc: string, now = Date.now()): number {
  return (now - parseUtc(sqliteUtc)) / 86_400_000;
}
