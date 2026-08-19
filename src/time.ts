/** SQLite `datetime('now')` values are UTC without a timezone suffix. */
export function parseUtc(sqliteUtc: string): number {
  return new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
}

export function minutesBetween(fromUtc: string, toMs = Date.now()): number {
  return Math.max(0, Math.round((toMs - parseUtc(fromUtc)) / 60000));
}

export function relativeAge(sqliteUtc: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - parseUtc(sqliteUtc)) / 60000));
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

export function daysSince(sqliteUtc: string, now = Date.now()): number {
  return (now - parseUtc(sqliteUtc)) / 86_400_000;
}
