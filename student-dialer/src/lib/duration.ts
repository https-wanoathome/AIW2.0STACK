/**
 * Smart duration formatting.
 *
 * Used everywhere we display a span of time (time-to-lead, average call,
 * vis-to-call, online time, etc). Scales the unit to the magnitude so a
 * 3-day TTL doesn't read as "4320m" and a 12-second response doesn't
 * read as "0h 0m 12s".
 *
 * Returns:
 *   null / NaN          -> "0s"
 *   < 60 seconds        -> "45s"
 *   < 60 minutes        -> "12m" or "12m 30s"
 *   < 24 hours          -> "3h" or "3h 25m"
 *   24 hours or more    -> "2d" or "2d 4h"
 *
 * Always two parts max so the output stays compact in scoreboard cells.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "0s";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;

  const totalMin = Math.floor(s / 60);
  const remS = s % 60;
  if (totalMin < 60) {
    return remS === 0 ? `${totalMin}m` : `${totalMin}m ${remS}s`;
  }

  const totalH = Math.floor(totalMin / 60);
  const remM = totalMin % 60;
  if (totalH < 24) {
    return remM === 0 ? `${totalH}h` : `${totalH}h ${remM}m`;
  }

  const totalD = Math.floor(totalH / 24);
  const remH = totalH % 24;
  return remH === 0 ? `${totalD}d` : `${totalD}d ${remH}h`;
}

/**
 * Relative-time formatter for "X ago" style timestamps.
 *
 *   < 60 seconds   -> "just now"
 *   < 60 minutes   -> "12m ago"
 *   < 24 hours     -> "3h ago"
 *   24 hours or +  -> "2d ago"
 *
 * Used on the contact card to show how fresh the lead is. Single-unit
 * output keeps the line tight in small mono lists.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
