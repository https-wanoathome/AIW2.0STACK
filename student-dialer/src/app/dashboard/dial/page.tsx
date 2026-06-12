import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getContact, GHLError } from "@/lib/ghl";
import { getRequestTimezone, getTodayStartIso } from "@/lib/timezone";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ActivityProvider } from "./_components/activity-provider";
import { SuccessToast } from "./_components/success-toast";
import { Delta } from "../_components/delta";
import { OnlineToggle } from "./_components/online-toggle";
import { DialButton } from "./_components/dial-button";
import { DispoForm } from "./_components/dispo-form";
import { SkipButton } from "./_components/skip-button";
import { LeadTimers } from "./_components/lead-timers";
import { SeenPinger } from "./_components/seen-pinger";
import {
  UpcomingCallbacks,
  type UpcomingCallback,
} from "./_components/upcoming-callbacks";
import { timeAgo } from "@/lib/duration";
import { runLazyExpiry } from "@/lib/expiry";
import type { Profile, LeadQueueRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dial" };

// Treat session_activity.last_heartbeat_at older than 30s as stale.
const ONLINE_THRESHOLD_MS = 30_000;

// Module-level helper so the Date.now() call stays out of the component
// render body (react-hooks/purity). This is a request-scoped server
// render, so computing "now" here is identical in behavior.
function isSessionOnline(
  session: { is_online: boolean; last_heartbeat_at: string | null } | null,
): boolean {
  return Boolean(
    session?.is_online &&
      session?.last_heartbeat_at &&
      Date.now() - new Date(session.last_heartbeat_at).getTime() <
        ONLINE_THRESHOLD_MS,
  );
}

export default async function DialPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login");

  const admin = createAdminClient();

  // Lazy expiry: flush expired soft claims and skips BEFORE we query
  // queue counts and the next lead.
  await runLazyExpiry();

  // 1. Am I currently calling a lead?
  const { data: activeLead } = await admin
    .from("lead_queue")
    .select("*")
    .eq("claimed_by", profile.id)
    .eq("status", "calling")
    .order("claimed_at", { ascending: true })
    .limit(1)
    .maybeSingle<LeadQueueRow>();

  // 2. Else, the newest queued lead (LIFO: fresh leads are hottest).
  let nextLead: LeadQueueRow | null = null;
  if (!activeLead) {
    const { data: queued } = await admin
      .from("lead_queue")
      .select("*")
      .eq("status", "queued")
      .order("queued_at", { ascending: false })
      .limit(1)
      .maybeSingle<LeadQueueRow>();
    nextLead = queued ?? null;
  }

  const currentLead = activeLead ?? nextLead;

  // GHL details for the current lead.
  let contactDetails: Awaited<ReturnType<typeof getContact>> | null = null;
  let contactError: string | null = null;

  if (currentLead) {
    try {
      contactDetails = await getContact(currentLead.ghl_contact_id);
    } catch (e) {
      contactError =
        e instanceof GHLError
          ? `GHL ${e.status}: ${e.body.slice(0, 200)}`
          : e instanceof Error
            ? e.message
            : "Failed to fetch contact.";
    }
  }

  const { count: queuedCount } = await admin
    .from("lead_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "queued");

  // Today's activity in the viewer's timezone.
  const timezone = await getRequestTimezone();
  const todayIso = getTodayStartIso(timezone);
  const yesterdayStartIso = new Date(
    new Date(todayIso).getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();

  // Dials = every claim + reclaim event today. Reclaims count too;
  // they represent real dialing effort.
  const [
    { count: dialsToday },
    { count: dialsYesterday },
    { count: bookedToday },
    { count: bookedYesterday },
  ] = await Promise.all([
    admin
      .from("lead_claim_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .in("event_type", ["claim", "reclaim"])
      .gte("created_at", todayIso),
    admin
      .from("lead_claim_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .in("event_type", ["claim", "reclaim"])
      .gte("created_at", yesterdayStartIso)
      .lt("created_at", todayIso),
    admin
      .from("lead_queue")
      .select("*", { count: "exact", head: true })
      .eq("claimed_by", profile.id)
      .eq("disposition", "booked")
      .gte("completed_at", todayIso),
    admin
      .from("lead_queue")
      .select("*", { count: "exact", head: true })
      .eq("claimed_by", profile.id)
      .eq("disposition", "booked")
      .gte("completed_at", yesterdayStartIso)
      .lt("completed_at", todayIso),
  ]);

  const dialTarget = profile.daily_dial_target;
  const dialAttempts = dialsToday ?? 0;
  const dialProgress =
    dialTarget > 0 ? Math.min(100, (dialAttempts / dialTarget) * 100) : 0;
  const targetHit = dialTarget > 0 && dialAttempts >= dialTarget;

  const firstName = (profile.full_name || "").trim().split(/\s+/)[0] || "there";

  // Upcoming callbacks owned by me, soonest first.
  const { data: callbackRows } = await admin
    .from("lead_queue")
    .select("id, ghl_contact_id, callback_at, contact_name, contact_phone")
    .eq("claimed_by", profile.id)
    .eq("status", "scheduled_callback")
    .order("callback_at", { ascending: true });

  const upcomingCallbacks: UpcomingCallback[] = await Promise.all(
    (callbackRows ?? [])
      .filter((cb) => cb.callback_at)
      .map(async (cb) => {
        const contact = await getContact(cb.ghl_contact_id).catch(() => null);
        const name = contact
          ? contact.firstName || contact.lastName
            ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()
            : contact.name || contact.email || "Unnamed lead"
          : cb.contact_name || cb.ghl_contact_id;
        return {
          id: cb.id,
          ghl_contact_id: cb.ghl_contact_id,
          callback_at: cb.callback_at as string,
          contact_name: name,
          contact_phone: contact?.phone ?? cb.contact_phone ?? null,
        };
      }),
  );

  // Session / online state.
  const { data: session } = await admin
    .from("session_activity")
    .select("is_online, last_heartbeat_at")
    .eq("user_id", profile.id)
    .maybeSingle<{ is_online: boolean; last_heartbeat_at: string | null }>();

  const isOnline = isSessionOnline(session);

  return (
    <ActivityProvider initialOnline={isOnline} hasActiveLead={!!activeLead}>
      <div className="max-w-5xl mx-auto">
        {/* Header: greeting + daily dial progress + online toggle. */}
        <div className="mb-10 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] animate-pulse" />
              Dial
            </div>
            <h1 className="font-display text-6xl md:text-7xl text-white mb-3">
              {targetHit ? "Smashed it" : `Welcome back, ${firstName}`}
              <span className="text-[var(--red)]">.</span>
            </h1>
            <div className="font-display text-2xl md:text-3xl text-[var(--silver)] mb-5">
              <span className="text-white">{dialAttempts}</span>
              <span className="mx-2 text-[var(--silver-muted)]">of</span>
              <span>{dialTarget}</span>
              <span className="ml-3 text-[var(--silver-muted)]">
                dials today
              </span>
            </div>
            <div className="h-2 bg-[var(--card-elevated)] rounded-full overflow-hidden max-w-2xl border border-[var(--border)]">
              <div
                className={`h-full bg-[var(--red)] rounded-full transition-[width] duration-500 ${
                  targetHit ? "animate-pulse" : ""
                }`}
                style={{ width: `${dialProgress}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <OnlineToggle />
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          <Stat label="In queue" value={queuedCount ?? 0} />
          <StatWithDelta
            label="Dials today"
            value={dialAttempts}
            current={dialAttempts}
            previous={dialsYesterday ?? 0}
          />
          <StatWithDelta
            label="Booked today"
            value={bookedToday ?? 0}
            current={bookedToday ?? 0}
            previous={bookedYesterday ?? 0}
          />
        </div>

        {/* Upcoming callbacks owned by me */}
        <UpcomingCallbacks callbacks={upcomingCallbacks} />

        {!currentLead && (
          <div className="text-center py-20 border border-[var(--border)] rounded bg-[var(--card)]">
            <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-3">
              Queue
            </div>
            <div className="text-lg text-white mb-2">No leads waiting</div>
            <div className="text-sm text-[var(--silver-muted)] max-w-md mx-auto">
              Nice work clearing the queue. New leads arrive via webhook from
              GHL, imports, and the 24h re-queue cycle.
            </div>
            <div className="text-sm text-[var(--silver-muted)] mt-3">
              Got a list ready?{" "}
              <Link
                href="/dashboard/import"
                className="text-[var(--silver)] hover:text-white transition-colors"
              >
                Import leads
              </Link>{" "}
              to refill the queue.
            </div>
          </div>
        )}

        {currentLead && (
          <div className="border border-[var(--border)] rounded bg-[var(--card)] overflow-hidden">
            {/* Card header */}
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)]">
                {activeLead ? "Calling now" : "Next lead"}
              </div>
              <LeadTimers
                queuedAt={currentLead.queued_at}
                firstVisibleAt={currentLead.first_visible_at}
              />
            </div>

            {/* Lead details */}
            <div className="px-6 py-6">
              {contactError && (
                <div className="text-xs text-[var(--red)] font-mono mb-4">
                  {contactError}
                </div>
              )}

              <div className="font-display text-5xl text-white mb-4">
                {contactDetails
                  ? contactDetails.firstName || contactDetails.lastName
                    ? `${contactDetails.firstName ?? ""} ${contactDetails.lastName ?? ""}`.trim()
                    : contactDetails.name || "Unnamed lead"
                  : currentLead.contact_name || currentLead.ghl_contact_id}
              </div>
              <div className="text-sm text-[var(--silver)] font-mono space-y-1">
                {(contactDetails?.phone || currentLead.contact_phone) && (
                  <div>
                    <span className="text-[var(--silver-muted)]">phone:</span>{" "}
                    {contactDetails?.phone ?? currentLead.contact_phone}
                  </div>
                )}
                {contactDetails?.email && (
                  <div>
                    <span className="text-[var(--silver-muted)]">email:</span>{" "}
                    {contactDetails.email}
                  </div>
                )}
                <div>
                  <span className="text-[var(--silver-muted)]">arrived:</span>{" "}
                  {timeAgo(currentLead.queued_at)}
                </div>
              </div>
            </div>

            {/* Action zone */}
            <div className="px-6 py-5 border-t border-[var(--border)] bg-[var(--card-elevated)]/40">
              {!activeLead && nextLead && (
                <div className="flex items-center justify-between">
                  <SkipButton leadQueueId={nextLead.id} />
                  <DialButton leadQueueId={nextLead.id} />
                </div>
              )}
              {activeLead && <DispoForm leadQueueId={activeLead.id} />}
            </div>
          </div>
        )}

        {/* Mark the lead as visible the first time we render it. */}
        {currentLead && (
          <SeenPinger
            leadQueueId={currentLead.id}
            alreadySeen={currentLead.first_visible_at !== null}
          />
        )}
      </div>
      <SuccessToast />
    </ActivityProvider>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-5 py-4 border border-[var(--border)] rounded bg-[var(--card)]">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
        {label}
      </div>
      <div className="font-display text-5xl text-white">{value}</div>
    </div>
  );
}

function StatWithDelta({
  label,
  value,
  current,
  previous,
}: {
  label: string;
  value: number | string;
  current: number;
  previous: number;
}) {
  return (
    <div className="px-5 py-4 border border-[var(--border)] rounded bg-[var(--card)]">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2">
        {label}
      </div>
      <div className="font-display text-5xl text-white">{value}</div>
      <div className="mt-2 min-h-[14px]">
        <Delta
          current={current}
          previous={previous}
          direction="up"
          label="vs yesterday"
        />
      </div>
    </div>
  );
}
