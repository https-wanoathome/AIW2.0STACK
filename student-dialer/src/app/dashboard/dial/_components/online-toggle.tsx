"use client";

import { useActivity } from "./activity-provider";

export function OnlineToggle() {
  const { online, setOnline, isPending } = useActivity();

  return (
    <button
      onClick={() => setOnline(!online)}
      disabled={isPending}
      className={`group inline-flex items-center gap-2.5 px-3 py-2 rounded border text-[10px] uppercase tracking-[0.24em] transition-colors ${
        online
          ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)] hover:border-[var(--red)]"
          : "border-[var(--border)] text-[var(--silver-muted)] hover:border-[var(--border-strong)] hover:text-[var(--silver)]"
      } disabled:opacity-50`}
    >
      <span
        className={`h-2 w-2 rounded-full transition-colors ${
          online ? "bg-[var(--red)] animate-pulse" : "bg-[var(--silver-muted)]"
        }`}
      />
      {online ? "Online" : "Offline"}
    </button>
  );
}
