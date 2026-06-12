import { HelpCircle } from "lucide-react";

/**
 * Renders a small all-caps label followed by a HelpCircle icon. Hover
 * (or focus on the icon) reveals a popover with a one-sentence
 * explanation of what the metric measures.
 *
 * Pure CSS hover via group + group-hover so it works without React state
 * and survives in server components. The popover is positioned absolutely
 * below the icon so it doesn't shift surrounding layout.
 *
 * Use everywhere a metric name might be ambiguous: TTL, Conn rate,
 * Vis to call, etc.
 */
export function MetricLabel({
  label,
  help,
  className = "",
}: {
  label: string;
  help: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <span>{label}</span>
      <span
        tabIndex={0}
        aria-label={`${label}: ${help}`}
        className="relative group inline-flex items-center cursor-help outline-none focus-visible:ring-1 focus-visible:ring-[var(--silver)] rounded-full"
      >
        <HelpCircle className="h-3 w-3 text-[var(--silver-muted)] hover:text-[var(--silver)] transition-colors" />
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 w-60 max-w-[16rem] px-3 py-2 rounded border border-[var(--border-strong)] bg-[var(--card)] text-[11px] leading-snug text-[var(--silver)] normal-case tracking-normal opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus:opacity-100 group-focus:visible transition-opacity z-30 shadow-lg"
        >
          {help}
        </span>
      </span>
    </span>
  );
}
