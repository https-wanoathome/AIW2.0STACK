"use client";

import { useState, useTransition, useEffect } from "react";
import { Phone } from "lucide-react";
import { claimLead } from "../actions";

export type UpcomingCallback = {
  id: string;
  ghl_contact_id: string;
  callback_at: string;
  contact_name: string;
  contact_phone: string | null;
};

function timeFromNow(
  iso: string,
  now: number,
): { text: string; dueSoon: boolean; overdue: boolean } {
  const diff = new Date(iso).getTime() - now;
  const minutes = Math.round(diff / 60_000);
  const overdue = minutes < 0;
  const dueSoon = minutes <= 5 && minutes >= -60;
  const abs = Math.abs(minutes);
  if (abs < 60) {
    return {
      text: overdue ? `${abs}m overdue` : `in ${abs}m`,
      dueSoon,
      overdue,
    };
  }
  const hours = Math.floor(abs / 60);
  return {
    text: overdue ? `${hours}h overdue` : `in ${hours}h`,
    dueSoon: false,
    overdue,
  };
}

/**
 * Scheduled callbacks owned by me, soonest first. "Call now" re-claims
 * the lead via claimLead (logs a reclaim event, opens GHL).
 */
export function UpcomingCallbacks({
  callbacks,
}: {
  callbacks: UpcomingCallback[];
}) {
  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();
  const [reclaimingId, setReclaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (callbacks.length === 0) return null;

  function handleReclaim(cb: UpcomingCallback) {
    setError(null);
    setReclaimingId(cb.id);
    startTransition(async () => {
      const res = await claimLead(cb.id);
      if (!res.ok) {
        setError(res.error);
        setReclaimingId(null);
        return;
      }
      if (res.data?.ghl_url) {
        window.open(res.data.ghl_url, "_blank", "noopener,noreferrer");
      }
      // Scroll to the top so the dispo form is in view when the
      // student returns from GHL.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  const sorted = [...callbacks].sort(
    (a, b) =>
      new Date(a.callback_at).getTime() - new Date(b.callback_at).getTime(),
  );

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)]">
          Upcoming callbacks
        </div>
        <span className="font-display text-2xl text-white">
          {callbacks.length}
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map((cb) => {
          const t = timeFromNow(cb.callback_at, now);
          const accentClass = t.overdue
            ? "border-[var(--red)] bg-[var(--red)]/10"
            : t.dueSoon
              ? "border-[var(--red)]/60 bg-[var(--red)]/5"
              : "border-[var(--border)] bg-[var(--card)]";
          return (
            <div
              key={cb.id}
              className={`flex items-center justify-between px-4 py-3 border rounded ${accentClass}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-medium truncate">
                  {cb.contact_name}
                </div>
                <div className="text-xs text-[var(--silver-muted)] font-mono mt-0.5">
                  {cb.contact_phone ?? "no phone"}{" "}
                  <span
                    className={
                      t.overdue || t.dueSoon
                        ? "text-[var(--red)]"
                        : "text-[var(--silver)]"
                    }
                  >
                    {t.text}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleReclaim(cb)}
                  disabled={isPending && reclaimingId === cb.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--red)] bg-[var(--red)] text-white text-xs uppercase tracking-[0.12em] hover:bg-[var(--red-muted)] disabled:opacity-50 transition-colors"
                >
                  <Phone className="h-3 w-3" />
                  {isPending && reclaimingId === cb.id ? "..." : "Call now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <div className="mt-2 text-xs text-[var(--red)] font-mono">{error}</div>
      )}
    </div>
  );
}
