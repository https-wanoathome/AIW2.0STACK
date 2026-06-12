"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Calendar, Check, ChevronDown } from "lucide-react";
import { PERIODS, type PeriodKey } from "./period-tabs";

/**
 * Period filter rendered as a single pill button that opens a
 * dropdown of period options. Replaces the PeriodTabs horizontal
 * strip: easier to scan, less screen real-estate.
 *
 * The button shows a calendar icon + the current period label.
 * Click opens the dropdown anchored below the button.
 */
export function PeriodSelector({
  current,
  basePath = "/dashboard/stats",
  extraParams,
}: {
  current: PeriodKey;
  /**
   * The route to navigate to when a period is selected. Defaults to
   * the stats tab. Pass `/dashboard/insights` etc on other pages so
   * clicking a period stays where the user is.
   */
  basePath?: string;
  /**
   * Additional URL params to preserve. Each is appended to the href.
   */
  extraParams?: Record<string, string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape close the menu.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function hrefFor(p: PeriodKey): string {
    const params = new URLSearchParams();
    params.set("period", p);
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v != null && v !== "") params.set(k, v);
      }
    }
    return `${basePath}?${params.toString()}`;
  }

  const currentDef = PERIODS.find((p) => p.key === current) ?? PERIODS[0];

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded border border-[var(--border)] bg-[var(--card)] text-sm text-white hover:border-[var(--border-strong)] hover:bg-[var(--card-elevated)] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Calendar
          className="h-4 w-4 text-[var(--silver-muted)]"
          strokeWidth={1.75}
        />
        <span className="font-medium">Last {currentDef.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[var(--silver-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 min-w-[180px] border border-[var(--border)] rounded bg-[var(--card)] shadow-2xl z-30 py-1"
          role="listbox"
        >
          {PERIODS.map((p) => {
            const active = p.key === current;
            return (
              <Link
                key={p.key}
                href={hrefFor(p.key)}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[var(--card-elevated)] text-white"
                    : "text-[var(--silver)] hover:bg-[var(--card-elevated)]/60 hover:text-white"
                }`}
                role="option"
                aria-selected={active}
              >
                <span>Last {p.label}</span>
                {active && (
                  <Check
                    className="h-3.5 w-3.5 text-[var(--red)]"
                    strokeWidth={2.5}
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
