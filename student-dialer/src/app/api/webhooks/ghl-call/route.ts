import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * GHL "Outbound Call Completed" webhook.
 *
 * Receives a payload like:
 *   {
 *     contact_id, contact_name, contact_phone, contact_email,
 *     call_status,            // "completed" | "no-answer" | "voicemail" | "busy" | "canceled"
 *     call_duration_seconds,  // string like "38" or "" (empty for no-answer)
 *     call_direction,         // "outbound"
 *     call_from, call_to,
 *     call_started_at,        // "2026-05-22 09:14:07" in the GHL location TZ (no offset)
 *     call_ended_at,          // same, or ""
 *     user_id, user_name      // GHL user id of the agent
 *   }
 *
 * - Verifies X-Webhook-Secret against WEBHOOK_SECRET (403 on mismatch).
 * - Mirrors every raw request into webhook_debug, valid or not.
 * - Parses offset-less local timestamps using GHL_LOCATION_TZ env.
 * - Maps GHL user_id to profiles.id via profiles.ghl_user_id.
 * - Links the most recent lead_queue row for the contact.
 * - Upserts call_logs on (ghl_contact_id, started_at) so retries are
 *   idempotent. Missing contact_id returns 200 so GHL does not retry.
 */
export async function POST(req: Request) {
  const provided = req.headers.get("x-webhook-secret");
  const expected = process.env.WEBHOOK_SECRET;
  const secretValid = !!expected && provided === expected;

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // Not JSON. Mirrored below regardless.
  }

  const admin = createAdminClient();

  try {
    await admin.from("webhook_debug").insert({
      route: "ghl-call",
      headers,
      body: Object.keys(body).length > 0 ? body : { raw: rawBody },
      note: `secret_valid=${secretValid}`,
    });
  } catch (e) {
    console.error("[webhooks/ghl-call] debug log failed", e);
  }

  if (!secretValid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const receivedAt = new Date();

  const ghlContactId = String(body.contact_id ?? "").trim();
  if (!ghlContactId) {
    // 200 so GHL does not retry a payload that can never succeed.
    return NextResponse.json(
      { ok: false, reason: "missing contact_id" },
      { status: 200 },
    );
  }

  const ghlUserId = String(body.user_id ?? "").trim() || null;
  const rawStatus = String(body.call_status ?? "").trim().toLowerCase();
  // Normalize the hyphen GHL uses for "no-answer".
  const callStatus = rawStatus.replace(/-/g, "_") || "unknown";
  const direction =
    String(body.call_direction ?? "").trim().toLowerCase() || null;

  const durationStr = String(body.call_duration_seconds ?? "").trim();
  const durationParsed = durationStr ? parseInt(durationStr, 10) : null;
  const durationSeconds =
    durationParsed != null && !isNaN(durationParsed) ? durationParsed : null;

  // GHL sends "YYYY-MM-DD HH:MM:SS" in the location's local TZ with no
  // offset. started_at falls back to received_at because the column is
  // NOT NULL and keys the ON CONFLICT pair.
  const tz = process.env.GHL_LOCATION_TZ || "UTC";
  const startedAtStr = String(body.call_started_at ?? "").trim();
  const endedAtStr = String(body.call_ended_at ?? "").trim();
  const startedAt = parseTimestamp(startedAtStr, tz) ?? receivedAt;
  let endedAt = parseTimestamp(endedAtStr, tz);
  if (!endedAt && durationSeconds != null) {
    endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  }

  // GHL user id -> our profile id.
  let ourUserId: string | null = null;
  if (ghlUserId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("ghl_user_id", ghlUserId)
      .maybeSingle<{ id: string }>();
    ourUserId = profile?.id ?? null;
  }

  // Most recent lead_queue row for this contact.
  const { data: lead } = await admin
    .from("lead_queue")
    .select("id")
    .eq("ghl_contact_id", ghlContactId)
    .order("queued_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  const leadQueueId = lead?.id ?? null;

  const { error: upsertErr } = await admin.from("call_logs").upsert(
    {
      ghl_contact_id: ghlContactId,
      ghl_user_id: ghlUserId,
      user_id: ourUserId,
      lead_queue_id: leadQueueId,
      call_status: callStatus,
      call_duration_seconds: durationSeconds,
      direction,
      started_at: startedAt.toISOString(),
      ended_at: endedAt?.toISOString() ?? null,
      received_at: receivedAt.toISOString(),
      raw: body,
    },
    {
      onConflict: "ghl_contact_id,started_at",
      ignoreDuplicates: false,
    },
  );

  if (upsertErr) {
    console.error("[webhooks/ghl-call] upsert failed", upsertErr);
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * Parse a GHL timestamp in any of the shapes the merge fields produce:
 * epoch seconds/millis, ISO with an explicit offset or Z, or the
 * offset-less "YYYY-MM-DD HH:MM:SS" local time (interpreted in tz).
 */
function parseTimestamp(s: string, tz: string): Date | null {
  if (!s) return null;
  if (/^\d{10}(\d{3})?$/.test(s)) {
    const n = parseInt(s, 10);
    return new Date(s.length === 13 ? n : n * 1000);
  }
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return parseLocalInTz(s, tz);
}

/**
 * Parse a "YYYY-MM-DD HH:MM:SS" string interpreted as a local time in
 * the given IANA timezone, returning a Date in true UTC.
 *
 * Treat the string as if it were UTC (naive). Format that naive moment
 * in the target TZ to see what wall-clock it displays as. The diff is
 * the TZ's current offset (DST included). Apply it for the real instant.
 */
function parseLocalInTz(s: string, tz: string): Date | null {
  if (!s) return null;
  const naiveUtcMs = new Date(s.replace(" ", "T") + "Z").getTime();
  if (isNaN(naiveUtcMs)) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(naiveUtcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const tzDisplayedMs = Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    parseInt(get("hour"), 10) % 24,
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10),
  );
  const offsetMs = naiveUtcMs - tzDisplayedMs;
  return new Date(naiveUtcMs + offsetMs);
}
