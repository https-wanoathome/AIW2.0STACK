"use client";

import { useEffect, useState } from "react";

function fmt(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Live-updating timers shown on the lead card.
 *
 * - inQueue: time since queued_at (always shown)
 * - visible: time since first_visible_at (shown when set)
 */
export function LeadTimers({
  queuedAt,
  firstVisibleAt,
}: {
  queuedAt: string;
  firstVisibleAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const inQueueSeconds = Math.max(
    0,
    Math.floor((now - new Date(queuedAt).getTime()) / 1000),
  );

  const visibleSeconds = firstVisibleAt
    ? Math.max(0, Math.floor((now - new Date(firstVisibleAt).getTime()) / 1000))
    : null;

  return (
    <div className="flex items-center gap-6 text-xs uppercase tracking-[0.16em] text-[var(--silver)] font-mono">
      <div>
        In queue{" "}
        <span className="text-[var(--silver)]">{fmt(inQueueSeconds)}</span>
      </div>
      {visibleSeconds !== null && (
        <div>
          Visible{" "}
          <span className="text-[var(--silver)]">{fmt(visibleSeconds)}</span>
        </div>
      )}
    </div>
  );
}
