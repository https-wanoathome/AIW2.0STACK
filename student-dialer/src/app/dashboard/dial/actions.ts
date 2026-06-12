"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  assignContactToUser,
  addContactTags,
  addContactNote,
  createContactTask,
  createAppointment,
  getFreeSlots,
  getContact,
  getGHLContactURL,
  GHLError,
} from "@/lib/ghl";
import { getStandardClaimExpiryIso } from "@/lib/expiry";
import { revalidatePath } from "next/cache";
import { DISPOSITIONS, type Disposition, type Profile } from "@/lib/types";

type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return profile;
}

/**
 * Claim a lead: mark it 'calling', stamp claimed_at, assign the GHL
 * contact, and log a claim event. Accepts:
 *   - status='queued' (initial claim)
 *   - status='soft_claimed' or 'scheduled_callback' with claimed_by=me
 *     (re-claim within the ownership window)
 *
 * Returns the GHL contact URL for the client to window.open.
 */
export async function claimLead(
  leadQueueId: string,
): Promise<ActionResult<{ ghl_url: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  const claimedAt = new Date().toISOString();

  const { data: lead, error: leadErr } = await admin
    .from("lead_queue")
    .select(
      "id, ghl_contact_id, queued_at, status, claimed_by, claimed_at, claim_expires_at, time_to_lead_seconds",
    )
    .eq("id", leadQueueId)
    .single();

  if (leadErr || !lead) {
    return { ok: false, error: `Lead not found: ${leadErr?.message ?? ""}` };
  }

  const isQueued = lead.status === "queued";
  const isMyActive =
    (lead.status === "soft_claimed" || lead.status === "scheduled_callback") &&
    lead.claimed_by === profile.id;

  if (!isQueued && !isMyActive) {
    return { ok: false, error: `Lead is ${lead.status} (not yours to claim).` };
  }

  // TTL only computed on the first claim from queued state.
  const update: Record<string, unknown> = {
    status: "calling",
    claimed_by: profile.id,
    claimed_at: claimedAt,
    claim_expires_at: null,
    updated_at: claimedAt,
  };
  if (isQueued && lead.queued_at) {
    update.time_to_lead_seconds = Math.floor(
      (new Date(claimedAt).getTime() - new Date(lead.queued_at).getTime()) /
        1000,
    );
  }

  const { error: updErr } = await admin
    .from("lead_queue")
    .update(update)
    .eq("id", leadQueueId);

  if (updErr) {
    return { ok: false, error: `Failed to claim lead: ${updErr.message}` };
  }

  // If the SeenPinger hasn't fired yet, stamp first_visible_at to
  // claimed_at so visible-to-call is 0 instead of negative.
  await admin
    .from("lead_queue")
    .update({ first_visible_at: claimedAt, updated_at: claimedAt })
    .eq("id", leadQueueId)
    .is("first_visible_at", null);

  // Assign the contact in GHL. Skipped when the profile has no linked
  // GHL user; the claim still goes through.
  if (profile.ghl_user_id) {
    try {
      await assignContactToUser(lead.ghl_contact_id, profile.ghl_user_id);
    } catch (e) {
      // Roll back to the lead's PREVIOUS state so it stays claimable.
      await admin
        .from("lead_queue")
        .update({
          status: lead.status,
          claimed_by: lead.claimed_by,
          claimed_at: lead.claimed_at,
          claim_expires_at: lead.claim_expires_at,
          time_to_lead_seconds: lead.time_to_lead_seconds,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadQueueId);
      const message =
        e instanceof GHLError
          ? `GHL assign failed: ${e.status} ${e.body.slice(0, 200)}`
          : e instanceof Error
            ? e.message
            : "GHL write failed.";
      return { ok: false, error: message };
    }
  }

  // Audit trail: 'claim' from queued, 'reclaim' otherwise.
  await admin.from("lead_claim_events").insert({
    lead_queue_id: leadQueueId,
    user_id: profile.id,
    event_type: isQueued ? "claim" : "reclaim",
  });

  revalidatePath("/dashboard/dial");

  return {
    ok: true,
    data: { ghl_url: getGHLContactURL(lead.ghl_contact_id) },
  };
}

/**
 * Submit a disposition for the lead I'm calling.
 *
 *   dq        -> status 'dead', completed_at stamped
 *   callback  -> status 'scheduled_callback', callback_at + claim
 *                expiry at the chosen time, GHL callback task
 *   others    -> status 'soft_claimed' for 24h
 *
 * Every dispo writes tag dispo:<value> plus the optional note to GHL,
 * best-effort: GHL failures never roll back the queue update.
 * 'booked' goes through submitBooking instead.
 */
export async function submitDisposition(
  formData: FormData,
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const leadQueueId = formData.get("lead_queue_id") as string;
  const disposition = formData.get("disposition") as Disposition;
  const notes = ((formData.get("notes") as string) ?? "").trim();
  const callbackAtRaw = (formData.get("callback_at") as string) ?? "";

  if (!leadQueueId || !disposition) {
    return { ok: false, error: "Lead and disposition are required." };
  }
  if (!DISPOSITIONS.includes(disposition)) {
    return { ok: false, error: `Unknown disposition: ${disposition}` };
  }
  if (disposition === "booked") {
    return { ok: false, error: "Use the booking flow for Booked." };
  }

  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("lead_queue")
    .select("id, ghl_contact_id, status, claimed_by")
    .eq("id", leadQueueId)
    .single();

  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.claimed_by !== profile.id) {
    return { ok: false, error: "You did not claim this lead." };
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    disposition,
    updated_at: now,
  };

  let callbackAt: string | null = null;
  if (disposition === "dq") {
    update.status = "dead";
    update.completed_at = now;
    update.claim_expires_at = null;
  } else if (disposition === "callback") {
    const callbackDate = new Date(callbackAtRaw);
    if (!callbackAtRaw || isNaN(callbackDate.getTime())) {
      return { ok: false, error: "Pick a valid callback time." };
    }
    if (callbackDate.getTime() <= Date.now()) {
      return { ok: false, error: "Callback time must be in the future." };
    }
    callbackAt = callbackDate.toISOString();
    update.status = "scheduled_callback";
    update.callback_at = callbackAt;
    update.claim_expires_at = callbackAt;
  } else {
    update.status = "soft_claimed";
    update.claim_expires_at = getStandardClaimExpiryIso();
  }

  const { error: updErr } = await admin
    .from("lead_queue")
    .update(update)
    .eq("id", leadQueueId);

  if (updErr) {
    return { ok: false, error: `Failed to log disposition: ${updErr.message}` };
  }

  // Best-effort GHL writes from here down.
  try {
    await addContactTags(lead.ghl_contact_id, [`dispo:${disposition}`]);
  } catch {
    // ignore tag failure
  }
  if (notes) {
    try {
      await addContactNote(
        lead.ghl_contact_id,
        notes,
        profile.ghl_user_id || undefined,
      );
    } catch {
      // ignore note failure
    }
  }
  if (disposition === "callback" && callbackAt) {
    try {
      await createContactTask({
        contactId: lead.ghl_contact_id,
        title: `Callback: ${profile.full_name || "Student"}`,
        body: notes || "Callback requested.",
        dueDate: callbackAt,
        assignedTo: profile.ghl_user_id || undefined,
      });
    } catch {
      // ignore task failure
    }
  }

  revalidatePath("/dashboard/dial");
  return { ok: true };
}

/**
 * Book the lead into the GHL booking calendar. Creates the appointment
 * first; only marks the lead completed once GHL confirms it.
 */
export async function submitBooking(
  formData: FormData,
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const leadQueueId = formData.get("lead_queue_id") as string;
  const slotStart = formData.get("slot_start") as string;
  const slotEnd = formData.get("slot_end") as string;
  const notes = ((formData.get("notes") as string) ?? "").trim();

  if (!leadQueueId || !slotStart) {
    return { ok: false, error: "Lead and slot are required." };
  }

  const calendarId = process.env.GHL_BOOKING_CALENDAR_ID;
  if (!calendarId) {
    return { ok: false, error: "GHL_BOOKING_CALENDAR_ID is not configured." };
  }

  const admin = createAdminClient();

  const { data: lead } = await admin
    .from("lead_queue")
    .select("id, ghl_contact_id, status, claimed_by")
    .eq("id", leadQueueId)
    .single();
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.claimed_by !== profile.id) {
    return { ok: false, error: "You did not claim this lead." };
  }

  // Default to a 30-minute slot if no end provided.
  const startDate = new Date(slotStart);
  if (isNaN(startDate.getTime())) {
    return { ok: false, error: "Invalid slot time." };
  }
  const endDate = slotEnd
    ? new Date(slotEnd)
    : new Date(startDate.getTime() + 30 * 60 * 1000);

  // Contact name for the appointment title, best-effort.
  let leadName = "Lead";
  try {
    const contact = await getContact(lead.ghl_contact_id);
    const combined =
      `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
    leadName =
      combined || contact.name?.trim() || contact.email?.trim() || "Lead";
  } catch {
    // fall back to "Lead"
  }

  let appointmentId = "";
  try {
    const result = await createAppointment({
      calendarId,
      contactId: lead.ghl_contact_id,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      title: `${leadName} - Discovery Call`,
      assignedUserId: profile.ghl_user_id || undefined,
    });
    appointmentId = result.id;
  } catch (e) {
    const msg =
      e instanceof GHLError
        ? `GHL appointment failed: ${e.status} ${e.body.slice(0, 200)}`
        : e instanceof Error
          ? e.message
          : "Failed to create appointment.";
    return { ok: false, error: msg };
  }

  const completedAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from("lead_queue")
    .update({
      status: "completed",
      disposition: "booked",
      booked_appointment_id: appointmentId,
      booked_at: startDate.toISOString(),
      claim_expires_at: null,
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", leadQueueId);

  if (updErr) {
    return {
      ok: false,
      error: `Booked in GHL but failed to record: ${updErr.message}`,
    };
  }

  try {
    await addContactTags(lead.ghl_contact_id, ["dispo:booked"]);
  } catch {
    // ignore
  }
  if (notes) {
    try {
      await addContactNote(
        lead.ghl_contact_id,
        notes,
        profile.ghl_user_id || undefined,
      );
    } catch {
      // ignore
    }
  }

  revalidatePath("/dashboard/dial");
  return { ok: true };
}

/**
 * Fetch free slots from the booking calendar for a date range.
 */
export async function fetchFreeSlots(
  startDateIso: string,
  endDateIso: string,
  timezone?: string,
): Promise<ActionResult<{ slots: string[] }>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const calendarId = process.env.GHL_BOOKING_CALENDAR_ID;
  if (!calendarId) {
    return { ok: false, error: "GHL_BOOKING_CALENDAR_ID is not configured." };
  }

  try {
    const result = await getFreeSlots({
      calendarId,
      startDate: new Date(startDateIso).getTime(),
      endDate: new Date(endDateIso).getTime(),
      timezone,
    });
    // Response is keyed by "YYYY-MM-DD" but ALSO carries non-date keys
    // (e.g. "traceId"). Skip anything that isn't a date bucket with a
    // slots array.
    const allSlots: string[] = [];
    for (const [key, day] of Object.entries(result)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const slots = (day as { slots?: unknown } | null)?.slots;
      if (Array.isArray(slots)) {
        allSlots.push(...(slots as string[]));
      }
    }
    allSlots.sort();
    return { ok: true, data: { slots: allSlots } };
  } catch (e) {
    const msg =
      e instanceof GHLError
        ? `GHL free-slots failed: ${e.status} ${e.body.slice(0, 200)}`
        : e instanceof Error
          ? e.message
          : "Failed to fetch slots.";
    return { ok: false, error: msg };
  }
}

/**
 * Skip a lead. It re-enters the queue after 24h via
 * expire_skipped_claims(). Stamps claimed_by for attribution but NOT
 * claimed_at (a skip is not a dial). Touches nothing in GHL.
 */
export async function skipLead(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const leadQueueId = formData.get("lead_queue_id") as string;
  if (!leadQueueId) return { ok: false, error: "Lead id required." };

  const admin = createAdminClient();

  const { error } = await admin
    .from("lead_queue")
    .update({
      status: "skipped",
      claim_expires_at: getStandardClaimExpiryIso(),
      claimed_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadQueueId);

  if (error) {
    return { ok: false, error: `Skip failed: ${error.message}` };
  }

  await admin.from("lead_claim_events").insert({
    lead_queue_id: leadQueueId,
    user_id: profile.id,
    event_type: "skip",
  });

  revalidatePath("/dashboard/dial");
  return { ok: true };
}

/**
 * Toggle online status. Used by the online toggle button and by the
 * ActivityProvider's auto-idle path. Transitions append session_events
 * so online time bands stay auditable.
 */
export async function setOnlineStatus(
  online: boolean,
  source: "toggle" | "idle" = "toggle",
): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  await admin.from("session_activity").upsert(
    {
      user_id: profile.id,
      is_online: online,
      last_heartbeat_at: now,
    },
    { onConflict: "user_id" },
  );

  await admin.from("session_events").insert({
    user_id: profile.id,
    event: online ? "online" : "offline",
    source,
  });

  revalidatePath("/dashboard/dial");
  return { ok: true };
}
