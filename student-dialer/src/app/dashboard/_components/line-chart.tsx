/**
 * Minimal SVG line chart for daily-trend visualization. No external
 * chart library. Renders:
 *   - A faint baseline grid (4 horizontal lines)
 *   - Hour-tick-free X axis with sparse day labels
 *   - One or more colored data series as smooth-ish polylines
 *   - Data point dots on each series for readability
 *
 * Designed for low cognitive load: small footprint, scannable shape,
 * not interactive. If we want tooltips later, we can layer a client
 * component over this one.
 */
export type LineSeries = {
  label: string;
  color: string;
  /**
   * Y values for each date in the same order as `dates`. Length must
   * match `dates.length`.
   */
  values: number[];
};

export function LineChart({
  series,
  dates,
  height = 200,
}: {
  series: LineSeries[];
  /**
   * X-axis labels for each data point. Length must match each series.
   */
  dates: string[];
  height?: number;
}) {
  if (dates.length === 0 || series.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded bg-[var(--card)] p-8 text-center text-sm text-[var(--silver-muted)]">
        No data to chart yet.
      </div>
    );
  }

  // Layout constants. ViewBox uses 0-1000 horizontal so we can position
  // by simple percentages. preserveAspectRatio="none" lets the SVG
  // stretch to fill any container width.
  const W = 1000;
  const H = height;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 18;
  const padBottom = 32;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  // Find max value across all series so all share a Y scale.
  const allVals = series.flatMap((s) => s.values);
  const maxVal = Math.max(1, ...allVals);

  const xStep = dates.length > 1 ? plotW / (dates.length - 1) : plotW;
  const xFor = (i: number) => padLeft + i * xStep;
  const yFor = (v: number) =>
    padTop + plotH - (v / maxVal) * plotH;

  // Horizontal grid lines at 0, 25, 50, 75, 100% of the plot area.
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  // Y axis labels: just min (0) and max value, on the left margin.
  const yLabelStyle = "fill-[var(--silver-muted)] text-[10px] font-mono";

  // X axis labels: show only every Nth label so a 14-day chart shows
  // ~4-5 labels and doesn't look crowded.
  const xLabelStride = Math.max(1, Math.ceil(dates.length / 6));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      {/* Grid */}
      {gridLines.map((t, i) => {
        const y = padTop + plotH - t * plotH;
        return (
          <line
            key={`grid-${i}`}
            x1={padLeft}
            x2={W - padRight}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            strokeDasharray={i === 0 ? "" : "3 3"}
          />
        );
      })}

      {/* Y labels (0 + max) */}
      <text x={padLeft - 8} y={padTop + plotH + 4} textAnchor="end" className={yLabelStyle}>
        0
      </text>
      <text x={padLeft - 8} y={padTop + 4} textAnchor="end" className={yLabelStyle}>
        {maxVal}
      </text>

      {/* X labels */}
      {dates.map((d, i) =>
        i % xLabelStride === 0 ? (
          <text
            key={`xl-${i}`}
            x={xFor(i)}
            y={H - 10}
            textAnchor="middle"
            className="fill-[var(--silver-muted)] text-[10px] font-mono uppercase tracking-[0.12em]"
          >
            {d}
          </text>
        ) : null,
      )}

      {/* Series: polyline + dots */}
      {series.map((s) => {
        const points = s.values
          .map((v, i) => `${xFor(i)},${yFor(v)}`)
          .join(" ");
        return (
          <g key={s.label}>
            <polyline
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) => (
              <circle
                key={`dot-${s.label}-${i}`}
                cx={xFor(i)}
                cy={yFor(v)}
                r="3"
                fill={s.color}
                stroke="rgb(20,20,20)"
                strokeWidth="1.5"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
