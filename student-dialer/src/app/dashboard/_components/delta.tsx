import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

/**
 * Period-over-period delta indicator. Renders as a pill-shaped badge
 * with a colored background tint, inspired by the Esseles design
 * reference. Much more scannable than inline text + arrow.
 *
 * `direction` tells the component which way is "good":
 *   - "up"  : higher is better (bookings, conn rate). Up arrow + green pill.
 *   - "down": lower is better (avg TTL, skip rate). Down arrow + green pill.
 *
 * Renders nothing if previous is missing (period=all) or both values
 * are zero (avoids showing "0% vs 0").
 *
 * Optional `label` (e.g. "vs prev 7d") renders OUTSIDE the pill as
 * small muted text so the pill itself stays compact.
 */
export function Delta({
  current,
  previous,
  direction = "up",
  label,
}: {
  current: number;
  previous: number | null | undefined;
  direction?: "up" | "down";
  label?: string;
}) {
  if (previous == null) return null;
  if (current === 0 && previous === 0) return null;

  // When previous is 0 and current is non-zero, the delta is technically
  // infinite. Show "new" instead so the UI doesn't claim infinity%.
  if (previous === 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/15 text-green-400 border border-green-500/20">
          <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
          new
        </span>
        {label && (
          <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)]">
            {label}
          </span>
        )}
      </span>
    );
  }

  const change = (current - previous) / previous;
  const absPct = Math.abs(Math.round(change * 100));
  const isUp = change > 0;
  const isFlat = absPct === 0;

  // "good" direction: an up move is good if direction=up, vice versa.
  const good =
    direction === "up" ? isUp && !isFlat : !isUp && !isFlat;

  const pillClass = isFlat
    ? "bg-white/5 text-white/60 border-white/10"
    : good
      ? "bg-green-500/15 text-green-400 border-green-500/20"
      : "bg-red-500/15 text-red-400 border-red-500/20";

  const Icon = isFlat ? ArrowRight : isUp ? ArrowUp : ArrowDown;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${pillClass}`}
      >
        <Icon className="h-3 w-3" strokeWidth={2.5} />
        {absPct}%
      </span>
      {label && (
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)]">
          {label}
        </span>
      )}
    </span>
  );
}
