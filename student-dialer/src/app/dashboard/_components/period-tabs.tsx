import Link from "next/link";

export type PeriodKey =
  | "24h"
  | "48h"
  | "3d"
  | "7d"
  | "14d"
  | "1m"
  | "3m"
  | "all";

export const PERIODS: Array<{ key: PeriodKey; label: string; ms: number | null }> =
  [
    { key: "24h", label: "24h", ms: 24 * 3600_000 },
    { key: "48h", label: "48h", ms: 48 * 3600_000 },
    { key: "3d", label: "3d", ms: 3 * 24 * 3600_000 },
    { key: "7d", label: "7d", ms: 7 * 24 * 3600_000 },
    { key: "14d", label: "14d", ms: 14 * 24 * 3600_000 },
    { key: "1m", label: "1mo", ms: 30 * 24 * 3600_000 },
    { key: "3m", label: "3mo", ms: 90 * 24 * 3600_000 },
    { key: "all", label: "All time", ms: null },
  ];

/**
 * Returns the lower-bound ISO string for the given period.
 * null = no filter (all time).
 */
export function getPeriodStartIso(period: PeriodKey): string | null {
  const def = PERIODS.find((p) => p.key === period);
  if (!def || def.ms === null) return null;
  return new Date(Date.now() - def.ms).toISOString();
}

/**
 * Returns the [start, end] ISO bounds of the PREVIOUS equivalent
 * period. Used for week-over-week (or 24h-over-24h, etc) deltas.
 * For example: with period=7d, returns the 7-day window ending right
 * before now-7d (i.e. days -14 to -7 from now). Returns null for
 * period=all (no prior window to compare).
 */
export function getPreviousPeriodBounds(
  period: PeriodKey,
): { start: string; end: string } | null {
  const def = PERIODS.find((p) => p.key === period);
  if (!def || def.ms === null) return null;
  const now = Date.now();
  return {
    start: new Date(now - 2 * def.ms).toISOString(),
    end: new Date(now - def.ms).toISOString(),
  };
}

export function periodLabel(period: PeriodKey): string {
  return PERIODS.find((p) => p.key === period)?.label ?? period;
}

/**
 * Human-readable comparison label for the previous period. Used on
 * delta indicators. Example: "vs prev 7d", "vs yesterday" for 24h.
 */
export function comparisonLabel(period: PeriodKey): string {
  if (period === "24h") return "vs yesterday";
  if (period === "all") return "";
  return `vs prev ${periodLabel(period)}`;
}

export function PeriodTabs({ current }: { current: PeriodKey }) {
  return (
    <div className="inline-flex flex-wrap border border-[var(--border)] rounded overflow-hidden">
      {PERIODS.map((p) => {
        const href = `/dashboard/stats?period=${p.key}`;
        const active = current === p.key;
        return (
          <Link
            key={p.key}
            href={href}
            className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-colors border-r border-[var(--border)] last:border-r-0 ${
              active
                ? "bg-[var(--red)] text-white"
                : "text-[var(--silver)] hover:text-white hover:bg-[var(--card-elevated)]"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
