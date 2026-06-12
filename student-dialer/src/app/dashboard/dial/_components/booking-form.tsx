"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft } from "lucide-react";
import { submitBooking, fetchFreeSlots } from "../actions";

// Common timezones for a US/global audience. Browser-local is added
// on top if it's not already in the list.
const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "America/Los_Angeles", label: "USA - Pacific (PST / PDT)" },
  { value: "America/Denver", label: "USA - Mountain (MST / MDT)" },
  { value: "America/Phoenix", label: "USA - Arizona (no DST)" },
  { value: "America/Chicago", label: "USA - Central (CST / CDT)" },
  { value: "America/New_York", label: "USA - Eastern (EST / EDT)" },
  { value: "Africa/Johannesburg", label: "South Africa (SAST)" },
  { value: "Europe/London", label: "UK (GMT / BST)" },
  { value: "Asia/Dubai", label: "UAE (Gulf)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST / AEDT)" },
  { value: "UTC", label: "UTC" },
];

/**
 * Sub-form for the Booked disposition. Pick date + slot from the
 * booking calendar; submit creates the GHL appointment.
 */
export function BookingForm({
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

  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [timezone, setTimezone] = useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [slots, setSlots] = useState<string[]>([]);
  // Date always starts populated (today), so the first slot fetch begins
  // on mount: start in the loading state instead of flipping it inside
  // the effect (react-hooks/set-state-in-effect).
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotStart, setSlotStart] = useState<string>("");
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Reset slot state when the fetch inputs change. Called from the date
  // and timezone change handlers so the effect below never calls
  // setState synchronously.
  function resetSlots() {
    setLoadingSlots(true);
    setSlotsError(null);
    setSlots([]);
    setSlotStart("");
  }

  const tzList = TIMEZONE_OPTIONS.some((o) => o.value === timezone)
    ? TIMEZONE_OPTIONS
    : [
        { value: timezone, label: `${timezone} (browser local)` },
        ...TIMEZONE_OPTIONS,
      ];

  useEffect(() => {
    if (!date) return;

    // Build a wide enough window in the chosen timezone so day-edge
    // slots aren't lost. We send +/- 12h around the picked date.
    const startUtc = new Date(
      new Date(`${date}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
    ).toISOString();
    const endUtc = new Date(
      new Date(`${date}T00:00:00Z`).getTime() + 36 * 3600 * 1000,
    ).toISOString();

    fetchFreeSlots(startUtc, endUtc, timezone).then((res) => {
      setLoadingSlots(false);
      if (!res.ok) {
        setSlotsError(res.error);
        return;
      }
      // Filter to slots whose date in the chosen TZ matches the picked date.
      const filtered = (res.data?.slots ?? []).filter((s) => {
        const slotDay = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(s));
        return slotDay === date;
      });
      setSlots(filtered);
    });
  }, [date, timezone]);

  function handleSubmit() {
    setError(null);
    if (!slotStart) {
      setError("Pick a slot.");
      return;
    }

    const fd = new FormData();
    fd.append("lead_queue_id", leadQueueId);
    fd.append("slot_start", slotStart);
    if (notes) fd.append("notes", notes);

    startTransition(async () => {
      const result = await submitBooking(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        localStorage.setItem(
          "student-dialer:lastDispo",
          JSON.stringify({ disposition: "booked", at: Date.now() }),
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
          Book a discovery call
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (e.target.value) resetSlots();
            }}
            min={new Date().toISOString().slice(0, 10)}
            disabled={isPending}
            className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
            Time zone
          </label>
          <select
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              if (date) resetSlots();
            }}
            disabled={isPending}
            className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none"
          >
            {tzList.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Available slots
        </label>
        {loadingSlots && (
          <div className="text-xs text-[var(--silver-muted)] font-mono">
            Loading slots...
          </div>
        )}
        {slotsError && (
          <div className="text-xs text-[var(--red)] font-mono">
            {slotsError}
          </div>
        )}
        {!loadingSlots && !slotsError && slots.length === 0 && (
          <div className="text-xs text-[var(--silver-muted)] font-mono">
            No availability on this date. Try another.
          </div>
        )}
        {slots.length > 0 && (
          <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
            {slots.map((s) => {
              const label = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(s));
              const selected = slotStart === s;
              return (
                <button
                  key={s}
                  onClick={() => setSlotStart(s)}
                  disabled={isPending}
                  className={`px-2 py-2 rounded border text-xs font-mono transition-colors ${
                    selected
                      ? "border-[var(--red)] bg-[var(--red)] text-white"
                      : "border-[var(--border)] text-[var(--silver)] hover:border-[var(--border-strong)] hover:text-white"
                  } disabled:opacity-50`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
          Notes (optional, saves to GHL contact)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="Context for the discovery call..."
          disabled={isPending}
          className="w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none resize-none"
        />
      </div>

      {error && <p className="text-xs text-[var(--red)] font-mono">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isPending || !slotStart}
        className="w-full py-2.5 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? "Booking..." : "Book & next lead"}
      </button>
    </div>
  );
}
