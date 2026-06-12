"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { setOnlineStatus } from "../actions";

const HEARTBEAT_INTERVAL_MS = 15_000;
const IDLE_THRESHOLD_MS = 30_000;
const IDLE_CHECK_INTERVAL_MS = 1_000;
// Even with an active claim, force offline after this long with zero
// dashboard interaction so a forgotten claim doesn't accumulate
// phantom online seconds.
const ACTIVE_LEAD_MAX_IDLE_MS = 30 * 60_000;

type ActivityContextValue = {
  online: boolean;
  setOnline: (next: boolean) => void;
  isPending: boolean;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    throw new Error("useActivity must be used inside ActivityProvider");
  }
  return ctx;
}

export function ActivityProvider({
  initialOnline,
  hasActiveLead = false,
  children,
}: {
  initialOnline: boolean;
  // True while a lead is in status='calling'. The student is on the
  // phone in a separate GHL tab, so we bypass the 30s idle check and
  // apply the 30 min cap instead.
  hasActiveLead?: boolean;
  children: React.ReactNode;
}) {
  const [online, setOnlineState] = useState(initialOnline);
  const [isPending, startTransition] = useTransition();
  // Calling Date.now() in a useRef initializer is impure during render
  // (react-hooks/purity), so start at 0 and stamp mount time in the
  // effect below. It runs before the idle-check interval's first tick,
  // so behavior is unchanged.
  const lastActivityRef = useRef<number>(0);
  const lastHeartbeatRef = useRef<number>(0);

  useEffect(() => {
    if (lastActivityRef.current === 0) {
      lastActivityRef.current = Date.now();
    }
  }, []);

  // Track active-lead in a ref so the interval closure always sees the
  // current value without restarting on every prop change.
  const hasActiveLeadRef = useRef(hasActiveLead);
  useEffect(() => {
    hasActiveLeadRef.current = hasActiveLead;
    // A fresh claim counts as activity even if the student is already
    // moving to the GHL tab.
    if (hasActiveLead) {
      lastActivityRef.current = Date.now();
    }
  }, [hasActiveLead]);

  // Refresh "last activity" timestamp on any user interaction.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, []);

  // While online: send heartbeat periodically and watch for idle.
  useEffect(() => {
    if (!online) return;

    // Immediate heartbeat on going online.
    void fetch("/api/heartbeat", { method: "POST" });
    lastHeartbeatRef.current = Date.now();

    const tick = setInterval(() => {
      const now = Date.now();

      const idleThreshold = hasActiveLeadRef.current
        ? ACTIVE_LEAD_MAX_IDLE_MS
        : IDLE_THRESHOLD_MS;
      if (now - lastActivityRef.current >= idleThreshold) {
        setOnlineState(false);
        startTransition(async () => {
          await setOnlineStatus(false, "idle");
        });
        return;
      }

      if (now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
        void fetch("/api/heartbeat", { method: "POST" });
        lastHeartbeatRef.current = now;
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => clearInterval(tick);
  }, [online]);

  function setOnline(next: boolean) {
    setOnlineState(next);
    lastActivityRef.current = Date.now();
    startTransition(async () => {
      await setOnlineStatus(next);
    });
  }

  return (
    <ActivityContext.Provider value={{ online, setOnline, isPending }}>
      {children}
    </ActivityContext.Provider>
  );
}
