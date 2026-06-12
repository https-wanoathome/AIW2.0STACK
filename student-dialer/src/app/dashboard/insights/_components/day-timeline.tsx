/**
 * 24-hour day timeline. Hand-rolled SVG, no chart library. Light green
 * bands show online sessions (from session_events); darker nested
 * bands show actual calls (from call_logs, anchored on started_at).
 * Server component: pure markup, hover detail via SVG <title>.
 */

export type TimelineBand = { startMs: number; endMs: number };
export type TimelineCallBand = TimelineBand & { label: string };

const SVG_W = 2400;
const SVG_H = 130;

export function DayTimeline({
  dayStartMs,
  onlineBands,
  callBands,
}: {
  dayStartMs: number;
  onlineBands: TimelineBand[];
  callBands: TimelineCallBand[];
}) {
  const msToX = (ms: number) =>
    Math.max(0, Math.min(SVG_W, ((ms - dayStartMs) / 60000 / 1440) * SVG_W));

  const online = onlineBands.map((b) => ({
    x: msToX(b.startMs),
    width: Math.max(2, msToX(b.endMs) - msToX(b.startMs)),
  }));
  const calls = callBands.map((b) => ({
    x: msToX(b.startMs),
    width: Math.max(2, msToX(b.endMs) - msToX(b.startMs)),
    label: b.label,
  }));
  const empty = online.length === 0 && calls.length === 0;

  return (
    <div className="border border-[var(--border)] rounded bg-[var(--card)] p-4 pb-2">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full"
        style={{ height: SVG_H }}
        preserveAspectRatio="none"
      >
        {/* Axis */}
        <line
          x1="0"
          y1="92"
          x2={SVG_W}
          y2="92"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1.5"
        />

        {/* Hour ticks + labels (every hour minor, every 3h major) */}
        {Array.from({ length: 25 }, (_, h) => h).map((h) => {
          const x = (h / 24) * SVG_W;
          const major = h % 3 === 0;
          return (
            <g key={h}>
              <line
                x1={x}
                y1="92"
                x2={x}
                y2={major ? 104 : 98}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={major ? 1.5 : 1}
              />
              {major && h < 24 && (
                <text
                  x={x}
                  y="122"
                  fontSize="14"
                  fill="rgba(255,255,255,0.7)"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {h.toString().padStart(2, "0")}:00
                </text>
              )}
            </g>
          );
        })}

        {/* Online bands (light green) */}
        {online.map((b, i) => (
          <rect
            key={`online-${i}`}
            x={b.x}
            y="10"
            width={b.width}
            height="64"
            fill="rgba(34, 197, 94, 0.30)"
            rx="3"
          />
        ))}

        {/* On-call bands (darker green, nested inside the online band) */}
        {calls.map((c, i) => (
          <rect
            key={`call-${i}`}
            x={c.x}
            y="24"
            width={c.width}
            height="36"
            fill="rgba(21, 128, 61, 0.85)"
            rx="3"
          >
            <title>{c.label}</title>
          </rect>
        ))}
      </svg>

      {empty && (
        <div className="text-center text-xs text-[var(--silver-muted)] pb-2">
          No activity on this day. Use the day picker to jump to a day
          with activity.
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-3 mb-2 text-xs uppercase tracking-[0.16em] text-[var(--silver-muted)]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-4 h-4 rounded-sm bg-green-500/30" />
          Online
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-4 h-4 rounded-sm bg-green-700" />
          On call
        </span>
      </div>
    </div>
  );
}
