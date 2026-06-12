import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * Heartbeat endpoint. Client pings every ~15s while online.
 *
 * Each heartbeat:
 *   1. Increments session_activity.online_seconds_today by 15. If
 *      today_date is not today UTC, the counter rolls over to 15.
 *   2. Mirrors the running count into session_online_daily.
 *   3. Logs an 'online' session_event when resuming a stale session.
 *   4. Updates last_heartbeat_at = now, is_online = true.
 *
 * The dashboard treats last_heartbeat_at older than 30s as offline,
 * so missed heartbeats stop the counter on their own.
 */
const HEARTBEAT_INCREMENT_SECONDS = 15;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const todayUtc = now.slice(0, 10); // "YYYY-MM-DD"

  const { data: existing } = await admin
    .from("session_activity")
    .select("today_date, online_seconds_today")
    .eq("user_id", user.id)
    .maybeSingle<{
      today_date: string | null;
      online_seconds_today: number | null;
    }>();

  const sameDay = existing?.today_date === todayUtc;
  const newSeconds = sameDay
    ? (existing?.online_seconds_today ?? 0) + HEARTBEAT_INCREMENT_SECONDS
    : HEARTBEAT_INCREMENT_SECONDS;

  // Mirror the running count into session_online_daily so period
  // queries never miss the final day's count when a user goes offline
  // and never comes back. Best-effort; the heartbeat still succeeds
  // even if this write fails.
  await admin.from("session_online_daily").upsert(
    {
      user_id: user.id,
      day: todayUtc,
      online_seconds: newSeconds,
    },
    { onConflict: "user_id,day" },
  );

  // Session events: a session is "open" if the last event was 'online'
  // and recent (heartbeats kept it alive). If the last event was
  // 'offline', missing, or older than 60s, log a fresh 'online' to
  // start a new session.
  const { data: lastEvent } = await admin
    .from("session_events")
    .select("event, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ event: string; created_at: string }>();

  const sessionStale =
    !lastEvent ||
    lastEvent.event !== "online" ||
    Date.now() - new Date(lastEvent.created_at).getTime() > 60_000;

  if (sessionStale) {
    await admin.from("session_events").insert({
      user_id: user.id,
      event: "online",
      source: "heartbeat-resume",
    });
  }

  const { error } = await admin.from("session_activity").upsert(
    {
      user_id: user.id,
      is_online: true,
      last_heartbeat_at: now,
      today_date: todayUtc,
      online_seconds_today: newSeconds,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    at: now,
    online_seconds_today: newSeconds,
  });
}
