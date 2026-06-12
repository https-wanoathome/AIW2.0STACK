"use client";

import { useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { submitDisposition } from "../actions";

/**
 * Sub-form for the Callback disposition. Takes date/time plus the
 * shared notes, submits via submitDisposition with callback_at.
 */
export function CallbackPicker({
  leadQueueId,
  notes,
  onNotesChange,
  onCancel,
}: {
  leadQueueId: string;
  notes: string;
  onNotesChange: (next: string) => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [callbackAt, setCallbackAt] = useState<string>(() => {
    // Default: now + 1 hour, formatted as datetime-local input value.
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    dt.setSeconds(0, 0);
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  });

  function handleSubmit() {
    setError(null);
    if (!callbackAt) {
      setError("Pick a callback time.");
      return;
    }

    const fd = new FormData();
    fd.append("lead_queue_id", leadQueueId);
    fd.append("disposition", "callback");
    // Convert the datetime-local string back to a full ISO with local TZ.
    const local = new Date(callbackAt);
    fd.append("callback_at", local.toISOString());
    if (notes) fd.append("notes", notes);

    startTransition(async () => {
      const result = await submitDisposition(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        localStorage.setItem(
          "student-dialer:lastDispo",
          JSON.stringify({ disposition: "callback", at: Date.now() }),
        );
      } catch {
        // Best-effort.
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)]">
          Schedule callback
        </div>
        <button
          onClick={onCancel}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)] hover:text-[var(--silver)]"
        >
          <ChevronLeft className="h-3 w-3" />
          Back
        </button>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Callback time
        </label>
        <input
          type="datetime-local"
          value={callbackAt}
          onChange={(e) => setCallbackAt(e.target.value)}
          disabled={isPending}
          className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Notes (optional, becomes the GHL task body)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="What did they say? When do they want the call?"
          disabled={isPending}
          className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none resize-none"
        />
      </div>

      {error && <p className="text-xs text-[var(--red)] font-mono">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full py-2.5 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-50 transition-colors"
      >
        {isPending ? "Scheduling..." : "Schedule callback & next lead"}
      </button>
    </div>
  );
}
