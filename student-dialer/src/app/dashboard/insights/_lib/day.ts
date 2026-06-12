/**
 * Local-day helpers for the Insights tab. DB timestamps are UTC; the
 * viewer thinks in their own timezone, so day boundaries and bucket
 * keys are computed against an IANA timezone string.
 */

/**
 * For a local date (YYYY-MM-DD) in a timezone, return the UTC start
 * and end moments of that day.
 *
 * Trick: format a known UTC moment (noon UTC) in the target TZ. The
 * formatted hour reveals the TZ offset for that date. Apply the offset
 * to midnight UTC to get the real midnight in the TZ.
 */
export function dayBoundariesUtc(
  dateStr: string,
  timezone: string,
): { startMs: number; endMs: number } {
  const probeUtc = new Date(`${dateStr}T12:00:00.000Z`);
  const tzHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(probeUtc);
  // Some locales render hour 00 as "24". Coerce.
  const tzHour = parseInt(tzHourStr, 10) % 24;
  const offsetHours = tzHour - 12;
  const startMs =
    new Date(`${dateStr}T00:00:00.000Z`).getTime() -
    offsetHours * 3600 * 1000;
  return { startMs, endMs: startMs + 24 * 3600 * 1000 };
}

/**
 * YYYY-MM-DD bucket key for a UTC ISO timestamp in the given timezone.
 */
export function localDateKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Add or subtract days from a YYYY-MM-DD string.
 */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
