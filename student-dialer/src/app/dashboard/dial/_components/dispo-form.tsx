"use client";

import { useState, useTransition } from "react";
import { submitDisposition } from "../actions";
import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  type Disposition,
} from "@/lib/types";
import { CallbackPicker } from "./callback-picker";
import { BookingForm } from "./booking-form";

type Mode = "buttons" | "callback" | "booking";

export function DispoForm({ leadQueueId }: { leadQueueId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [selecting, setSelecting] = useState<Disposition | null>(null);
  const [mode, setMode] = useState<Mode>("buttons");

  function handlePick(disposition: Disposition) {
    setError(null);

    if (disposition === "callback") {
      setMode("callback");
      return;
    }
    if (disposition === "booked") {
      setMode("booking");
      return;
    }

    setSelecting(disposition);
    const fd = new FormData();
    fd.append("lead_queue_id", leadQueueId);
    fd.append("disposition", disposition);
    fd.append("notes", notes);

    startTransition(async () => {
      const result = await submitDisposition(fd);
      if (!result.ok) {
        setError(result.error);
        setSelecting(null);
        return;
      }
      // Flash a success toast on the next render (page revalidates and
      // SuccessToast reads localStorage on mount).
      try {
        localStorage.setItem(
          "student-dialer:lastDispo",
          JSON.stringify({ disposition, at: Date.now() }),
        );
      } catch {
        // Best-effort; no toast is fine.
      }
    });
  }

  if (mode === "callback") {
    return (
      <CallbackPicker
        leadQueueId={leadQueueId}
        notes={notes}
        onNotesChange={setNotes}
        onCancel={() => setMode("buttons")}
      />
    );
  }

  if (mode === "booking") {
    return (
      <BookingForm
        leadQueueId={leadQueueId}
        notes={notes}
        onNotesChange={setNotes}
        onCancel={() => setMode("buttons")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Disposition
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DISPOSITIONS.map((d) => {
            const isThisPending = isPending && selecting === d;
            const isBooked = d === "booked";
            const isCallback = d === "callback";
            return (
              <button
                key={d}
                onClick={() => handlePick(d)}
                disabled={isPending}
                className={`px-3 py-2.5 rounded border text-xs font-medium uppercase tracking-[0.12em] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isBooked
                    ? "border-[var(--red)] bg-[var(--red)] text-white hover:bg-[var(--red-muted)]"
                    : isCallback
                      ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)] hover:bg-[var(--red)]/20"
                      : "border-[var(--border)] text-[var(--silver)] hover:border-[var(--border-strong)] hover:text-white hover:bg-[var(--card-elevated)]"
                }`}
              >
                {isThisPending ? "..." : DISPOSITION_LABELS[d]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes carry over to the sub-forms if the student picks
          Callback or Booked. */}
      <div>
        <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth remembering about this call..."
          disabled={isPending}
          className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none resize-none disabled:opacity-50"
        />
      </div>

      {error && <p className="text-xs text-[var(--red)] font-mono">{error}</p>}
    </div>
  );
}
