"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { DISPOSITION_LABELS, type Disposition } from "@/lib/types";

const STORAGE_KEY = "student-dialer:lastDispo";
const TOAST_TTL_MS = 2500;
const FRESH_WINDOW_MS = 5000;

function toastLabel(dispo: string): string {
  if (dispo === "booked") return "Booked";
  if (dispo === "callback") return "Callback scheduled";
  const label = DISPOSITION_LABELS[dispo as Disposition];
  return label ? `${label} logged` : `${dispo} logged`;
}

/**
 * Reads a "just logged" flash message from localStorage and displays a
 * brief success toast in the bottom-right corner. The dispo, callback
 * and booking forms write to localStorage right before the page
 * revalidates, so this picks up the message on the next render.
 */
export function SuccessToast() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { disposition?: string; at?: number };
      localStorage.removeItem(STORAGE_KEY);
      // Stale message? Don't display.
      if (!data.at || Date.now() - data.at > FRESH_WINDOW_MS) return;
      // setState from a timeout callback, not the effect body, to avoid
      // a synchronous setState in the effect
      // (react-hooks/set-state-in-effect). A 0ms delay is invisible.
      showTimer = setTimeout(() => {
        setMsg(toastLabel(data.disposition ?? ""));
        hideTimer = setTimeout(() => setMsg(null), TOAST_TTL_MS);
      }, 0);
    } catch {
      // localStorage unavailable or bad JSON; silently no toast.
    }
    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (!msg) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
      <div className="inline-flex items-center gap-2.5 px-5 py-3 border border-green-500/60 bg-green-500/15 backdrop-blur-sm rounded-md text-sm text-white font-mono shadow-lg">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500/30">
          <Check className="h-3 w-3 text-green-400" strokeWidth={3} />
        </span>
        {msg}
      </div>
    </div>
  );
}
