/**
 * Timezone helpers. Uses the `x-vercel-ip-timezone` header that
 * Vercel sets automatically based on the viewer's IP. Falls back
 * to the server's local TZ in dev and UTC if nothing else works.
 */

import { headers } from "next/headers";

const FALLBACK_TZ = "UTC";

/**
 * Returns the viewer's IANA timezone (e.g. "Africa/Johannesburg").
 *
 * Order of precedence:
 *   1. Vercel header x-vercel-ip-timezone (production traffic)
 *   2. Server's local timezone (dev)
 *   3. UTC
 */
export async function getRequestTimezone(): Promise<string> {
  const h = await headers();
  const vercel = h.get("x-vercel-ip-timezone");
  if (vercel) return vercel;

  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local) return local;
  } catch {
    // fall through
  }

  return FALLBACK_TZ;
}

/**
 * Returns the UTC ISO string for midnight today in the given timezone.
 *
 * Example for "Africa/Johannesburg" (UTC+2) at 2026-05-15 14:00 SAST:
 *   returns 2026-05-14T22:00:00.000Z (midnight SAST is 22:00 UTC the day before)
 */
export function getTodayStartIso(timezone: string): string {
  const now = new Date();

  // 1. What is today's date (YYYY-MM-DD) in the target TZ?
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [y, m, d] = dateStr.split("-").map(Number);

  // 2. Treat that as midnight in the target TZ, and find the UTC equivalent.
  //    Trick: take that wall-clock time interpreted as UTC, then measure the
  //    skew by formatting it back in the target TZ.
  const midnightAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(midnightAsUtc));

  const match = parts.match(
    /(\d{4})-(\d{2})-(\d{2}),? (\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) return new Date(midnightAsUtc).toISOString();

  const ly = Number(match[1]);
  const lm = Number(match[2]);
  const ld = Number(match[3]);
  const lh = Number(match[4]);
  const lmin = Number(match[5]);
  const ls = Number(match[6]);

  const tzAsUtc = Date.UTC(ly, lm - 1, ld, lh, lmin, ls);
  const offsetMs = tzAsUtc - midnightAsUtc;

  return new Date(midnightAsUtc - offsetMs).toISOString();
}

/**
 * Format a UTC ISO timestamp for display in the user's timezone.
 */
export function formatInTz(
  iso: string | Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options,
  }).format(d);
}
