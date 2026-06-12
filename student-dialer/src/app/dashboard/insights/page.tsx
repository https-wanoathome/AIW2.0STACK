import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  type Disposition,
} from "@/lib/types";
import {
  getPeriodStartIso,
  getPreviousPeriodBounds,
  comparisonLabel,
  periodLabel,
  PERIODS,
  type PeriodKey,
} from "../_components/period-tabs";
import { PeriodSelector } from "../_components/period-selector";
import { Delta } from "../_components/delta";
import { MetricLabel } from "../_components/metric-label";
import { LineChart, type LineSeries } from "../_components/line-chart";
import { getRequestTimezone, formatInTz } from "@/lib/timezone";
import { formatDuration } from "@/lib/duration";
import { pagedFetch } from "./_lib/paged-fetch";
import {
  dayBoundariesUtc,
  localDateKey,
  shiftDate,
  todayInTz,
} from "./_lib/day";
import {
  DayTimeline,
  type TimelineBand,
  type TimelineCallBand,
} from "./_components/day-timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const TREND_DAYS = 14;

type Admin = ReturnType<typeof createAdminClient>;

function pctLabel(num: number, denom: number): string {
  if (!denom) return "0%";
  return `${Math.round((num / denom) * 100)}%`;
}

function ratePct(num: number, denom: number): number {
  return denom > 0 ? (100 * num) / denom : 0;
}

/**
 * Dials = claim + reclaim events for me in the window (by created_at).
 */
async function countDials(
  admin: Admin,
  userId: string,
  gteIso: string,
  ltIso?: string,
): Promise<number> {
  let q = admin
    .from("lead_claim_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("event_type", ["claim", "reclaim"])
    .gte("created_at", gteIso);
  if (ltIso) q = q.lt("created_at", ltIso);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Connects = my call_logs with duration >= 30s, anchored on started_at
 * (the real call time, not the lagging webhook arrival).
 */
async function countConnects(
  admin: Admin,
  userId: string,
  gteIso: string,
  ltIso?: string,
): Promise<number> {
  let q = admin
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("call_duration_seconds", 30)
    .gte("started_at", gteIso);
  if (ltIso) q = q.lt("started_at", ltIso);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Bookings = my lead_queue rows with an appointment id, by completed_at.
 */
async function countBookings(
  admin: Admin,
  userId: string,
  gteIso: string,
  ltIso?: string,
): Promise<number> {
  let q = admin
    .from("lead_queue")
    .select("id", { count: "exact", head: true })
    .eq("claimed_by", userId)
    .not("booked_appointment_id", "is", null)
    .gte("completed_at", gteIso);
  if (ltIso) q = q.lt("completed_at", ltIso);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Dispo rows are timed by updated_at: non-terminal dispositions
 * (no_answer, voicemail, etc) never stamp completed_at, and every
 * lead_queue write sets updated_at explicitly.
 */
async function countDispos(
  admin: Admin,
  userId: string,
  gteIso: string,
  ltIso?: string,
  disposition?: Disposition,
): Promise<number> {
  let q = admin
    .from("lead_queue")
    .select("id", { count: "exact", head: true })
    .eq("claimed_by", userId)
    .gte("updated_at", gteIso);
  if (ltIso) q = q.lt("updated_at", ltIso);
  q = disposition
    ? q.eq("disposition", disposition)
    : q.not("disposition", "is", null);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Pair each 'online' session event with the next 'offline'. An open band
 * with no closing offline yet is capped at last heartbeat + 30s so a
 * crashed tab does not inflate online time to "now". Bands are clamped
 * to the selected day. Module-level helper so the Date.now() calls stay
 * out of the component render body (react-hooks/purity); this is a
 * request-scoped server render, so behavior is identical.
 */
function buildOnlineBands(
  sessionEvents: { event: "online" | "offline"; created_at: string }[],
  lastHeartbeatMs: number | null,
  dayStartMs: number,
  dayEndMs: number,
): TimelineBand[] {
  const sessions: TimelineBand[] = [];
  let openStartMs: number | null = null;
  for (const e of sessionEvents) {
    const ms = new Date(e.created_at).getTime();
    if (e.event === "online") {
      if (openStartMs == null) openStartMs = ms;
    } else if (openStartMs != null) {
      sessions.push({ startMs: openStartMs, endMs: ms });
      openStartMs = null;
    }
  }
  if (openStartMs != null) {
    const capMs =
      lastHeartbeatMs != null ? lastHeartbeatMs + 30_000 : Date.now();
    sessions.push({
      startMs: openStartMs,
      endMs: Math.min(capMs, Date.now(), dayEndMs),
    });
  }
  return sessions
    .map((s) => ({
      startMs: Math.max(s.startMs, dayStartMs),
      endMs: Math.min(s.endMs, dayEndMs),
    }))
    .filter((s) => s.endMs > s.startMs);
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const timezone = await getRequestTimezone();

  const sp = await searchParams;
  const validKeys = PERIODS.map((p) => p.key);
  const period: PeriodKey = validKeys.includes(sp.period as PeriodKey)
    ? (sp.period as PeriodKey)
    : "24h";
  const startIso = getPeriodStartIso(period) ?? EPOCH_ISO;
  const prev = getPreviousPeriodBounds(period);

  const todayDate = todayInTz(timezone);
  const dateParam =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  const selectedDate = dateParam ?? todayDate;

  // ----------------------------------------------------------
  // Rate cards: current period + previous window for deltas
  // ----------------------------------------------------------
  const [
    dials,
    connects,
    bookings,
    dispoRows,
    dialsPrev,
    connectsPrev,
    bookingsPrev,
    dispoTotalPrev,
    noAnswerPrev,
    dqPrev,
  ] = await Promise.all([
    countDials(admin, user.id, startIso),
    countConnects(admin, user.id, startIso),
    countBookings(admin, user.id, startIso),
    pagedFetch<{ disposition: Disposition }>((from, to) =>
      admin
        .from("lead_queue")
        .select("disposition")
        .eq("claimed_by", user.id)
        .not("disposition", "is", null)
        .gte("updated_at", startIso)
        .range(from, to)
        .returns<{ disposition: Disposition }[]>(),
    ),
    prev ? countDials(admin, user.id, prev.start, prev.end) : null,
    prev ? countConnects(admin, user.id, prev.start, prev.end) : null,
    prev ? countBookings(admin, user.id, prev.start, prev.end) : null,
    prev ? countDispos(admin, user.id, prev.start, prev.end) : null,
    prev
      ? countDispos(admin, user.id, prev.start, prev.end, "no_answer")
      : null,
    prev ? countDispos(admin, user.id, prev.start, prev.end, "dq") : null,
  ]);

  const dispoTotal = dispoRows.length;
  const dispoCounts = new Map<Disposition, number>();
  for (const r of dispoRows) {
    dispoCounts.set(r.disposition, (dispoCounts.get(r.disposition) ?? 0) + 1);
  }
  const noAnswer = dispoCounts.get("no_answer") ?? 0;
  const dq = dispoCounts.get("dq") ?? 0;

  const connectRate = ratePct(connects, dials);
  const bookRate = ratePct(bookings, dials);
  const noAnswerRate = ratePct(noAnswer, dispoTotal);
  const dqRate = ratePct(dq, dispoTotal);

  const connectRatePrev = prev
    ? ratePct(connectsPrev ?? 0, dialsPrev ?? 0)
    : null;
  const bookRatePrev = prev ? ratePct(bookingsPrev ?? 0, dialsPrev ?? 0) : null;
  const noAnswerRatePrev = prev
    ? ratePct(noAnswerPrev ?? 0, dispoTotalPrev ?? 0)
    : null;
  const dqRatePrev = prev ? ratePct(dqPrev ?? 0, dispoTotalPrev ?? 0) : null;

  const vsLabel = comparisonLabel(period);

  // ----------------------------------------------------------
  // 14-day daily trend: dials / connects / bookings
  // ----------------------------------------------------------
  const trendDates: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    trendDates.push(shiftDate(todayDate, -i));
  }
  const trendStartIso = new Date(
    dayBoundariesUtc(trendDates[0], timezone).startMs,
  ).toISOString();

  const [trendDialRows, trendConnectRows, trendBookingRows] =
    await Promise.all([
      pagedFetch<{ created_at: string }>((from, to) =>
        admin
          .from("lead_claim_events")
          .select("created_at")
          .eq("user_id", user.id)
          .in("event_type", ["claim", "reclaim"])
          .gte("created_at", trendStartIso)
          .order("created_at", { ascending: true })
          .range(from, to)
          .returns<{ created_at: string }[]>(),
      ),
      pagedFetch<{ started_at: string }>((from, to) =>
        admin
          .from("call_logs")
          .select("started_at")
          .eq("user_id", user.id)
          .gte("call_duration_seconds", 30)
          .gte("started_at", trendStartIso)
          .order("started_at", { ascending: true })
          .range(from, to)
          .returns<{ started_at: string }[]>(),
      ),
      pagedFetch<{ completed_at: string }>((from, to) =>
        admin
          .from("lead_queue")
          .select("completed_at")
          .eq("claimed_by", user.id)
          .not("booked_appointment_id", "is", null)
          .gte("completed_at", trendStartIso)
          .order("completed_at", { ascending: true })
          .range(from, to)
          .returns<{ completed_at: string }[]>(),
      ),
    ]);

  const bucket = (keys: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const dialsByDay = bucket(
    trendDialRows.map((r) => localDateKey(r.created_at, timezone)),
  );
  const connectsByDay = bucket(
    trendConnectRows.map((r) => localDateKey(r.started_at, timezone)),
  );
  const bookingsByDay = bucket(
    trendBookingRows.map((r) => localDateKey(r.completed_at, timezone)),
  );

  const chartDates = trendDates.map((d) =>
    formatInTz(new Date(`${d}T12:00:00.000Z`), timezone, {
      month: "short",
      day: "2-digit",
    }),
  );
  const trendSeries: LineSeries[] = [
    {
      label: "Dials",
      color: "rgba(255,255,255,0.65)",
      values: trendDates.map((d) => dialsByDay.get(d) ?? 0),
    },
    {
      label: "Connects",
      color: "rgb(96, 165, 250)",
      values: trendDates.map((d) => connectsByDay.get(d) ?? 0),
    },
    {
      label: "Bookings",
      color: "rgb(239, 68, 68)",
      values: trendDates.map((d) => bookingsByDay.get(d) ?? 0),
    },
  ];

  // ----------------------------------------------------------
  // Day timeline for the selected day
  // ----------------------------------------------------------
  const { startMs: dayStartMs, endMs: dayEndMs } = dayBoundariesUtc(
    selectedDate,
    timezone,
  );
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayEndMs).toISOString();
  // 12h padding so a session spanning midnight is not lost.
  const padStartIso = new Date(dayStartMs - 12 * 3600_000).toISOString();
  const padEndIso = new Date(dayEndMs + 12 * 3600_000).toISOString();

  const [sessionEvents, dayCallLogs, liveSessionRes, dayDials] =
    await Promise.all([
      pagedFetch<{ event: "online" | "offline"; created_at: string }>(
        (from, to) =>
          admin
            .from("session_events")
            .select("event, created_at")
            .eq("user_id", user.id)
            .gte("created_at", padStartIso)
            .lt("created_at", padEndIso)
            .order("created_at", { ascending: true })
            .range(from, to)
            .returns<{ event: "online" | "offline"; created_at: string }[]>(),
      ),
      pagedFetch<{
        started_at: string;
        ended_at: string | null;
        call_duration_seconds: number | null;
        call_status: string | null;
      }>((from, to) =>
        admin
          .from("call_logs")
          .select("started_at, ended_at, call_duration_seconds, call_status")
          .eq("user_id", user.id)
          .gte("started_at", dayStartIso)
          .lt("started_at", dayEndIso)
          .order("started_at", { ascending: true })
          .range(from, to)
          .returns<
            {
              started_at: string;
              ended_at: string | null;
              call_duration_seconds: number | null;
              call_status: string | null;
            }[]
          >(),
      ),
      admin
        .from("session_activity")
        .select("is_online, last_heartbeat_at")
        .eq("user_id", user.id)
        .maybeSingle<{
          is_online: boolean;
          last_heartbeat_at: string | null;
        }>(),
      countDials(admin, user.id, dayStartIso, dayEndIso),
    ]);

  const lastHeartbeatMs = liveSessionRes.data?.last_heartbeat_at
    ? new Date(liveSessionRes.data.last_heartbeat_at).getTime()
    : null;

  const onlineBands: TimelineBand[] = buildOnlineBands(
    sessionEvents,
    lastHeartbeatMs,
    dayStartMs,
    dayEndMs,
  );

  // Call bands anchored on started_at; end at ended_at when present,
  // else started_at + duration.
  const callBands: TimelineCallBand[] = dayCallLogs
    .filter((c) => (c.call_duration_seconds ?? 0) > 0)
    .map((c) => {
      const startMs = new Date(c.started_at).getTime();
      const endMs = c.ended_at
        ? new Date(c.ended_at).getTime()
        : startMs + (c.call_duration_seconds ?? 0) * 1000;
      return {
        startMs: Math.max(startMs, dayStartMs),
        endMs: Math.min(endMs, dayEndMs),
        label: `${formatInTz(c.started_at, timezone, {
          hour: "2-digit",
          minute: "2-digit",
        })} · ${c.call_status ?? "call"} · ${formatDuration(
          c.call_duration_seconds,
        )}`,
      };
    })
    .filter((b) => b.endMs > b.startMs);

  const dayCalls = dayCallLogs.length;
  const dayConnects = dayCallLogs.filter(
    (c) => (c.call_duration_seconds ?? 0) >= 30,
  ).length;
  const dayOnlineSeconds = onlineBands.reduce(
    (s, b) => s + (b.endMs - b.startMs) / 1000,
    0,
  );

  const prevDate = shiftDate(selectedDate, -1);
  const nextDate = shiftDate(selectedDate, 1);

  function dateLink(d: string) {
    return `/dashboard/insights?period=${period}&date=${d}`;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="font-display text-4xl text-white">
          Insights<span className="text-[var(--red)]">.</span>
        </h1>
        <div className="text-sm text-[var(--silver-muted)] mt-3">
          Deeper analytics on your rates, dispositions and daily rhythm.
        </div>
      </div>

      {/* Time window */}
      <div>
        <SectionLabel>Time window</SectionLabel>
        <PeriodSelector
          current={period}
          basePath="/dashboard/insights"
          extraParams={{ date: dateParam }}
        />
      </div>

      {/* Rate cards */}
      <div>
        <SectionLabel>Rates · last {periodLabel(period)}</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <RateCard
            label="Connect rate"
            help="Connects (calls of 30 seconds or longer) divided by dials in the period."
            value={pctLabel(connects, dials)}
            percent={connectRate}
            delta={
              <Delta
                current={connectRate}
                previous={connectRatePrev}
                direction="up"
                label={vsLabel}
              />
            }
          />
          <RateCard
            label="Book rate"
            help="Bookings divided by dials in the period."
            value={pctLabel(bookings, dials)}
            percent={bookRate}
            delta={
              <Delta
                current={bookRate}
                previous={bookRatePrev}
                direction="up"
                label={vsLabel}
              />
            }
          />
          <RateCard
            label="No-answer rate"
            help="No Answer dispositions divided by all dispositions logged in the period."
            value={pctLabel(noAnswer, dispoTotal)}
            percent={noAnswerRate}
            delta={
              <Delta
                current={noAnswerRate}
                previous={noAnswerRatePrev}
                direction="down"
                label={vsLabel}
              />
            }
          />
          <RateCard
            label="DQ rate"
            help="DQ dispositions divided by all dispositions logged in the period."
            value={pctLabel(dq, dispoTotal)}
            percent={dqRate}
            delta={
              <Delta
                current={dqRate}
                previous={dqRatePrev}
                direction="down"
                label={vsLabel}
              />
            }
          />
        </div>
      </div>

      {/* Disposition breakdown */}
      <div>
        <SectionLabel>
          Disposition breakdown · last {periodLabel(period)} ({dispoTotal}{" "}
          logged)
        </SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DISPOSITIONS.map((d) => {
            const count = dispoCounts.get(d) ?? 0;
            const percent = dispoTotal > 0 ? (count / dispoTotal) * 100 : 0;
            return (
              <div
                key={d}
                className="px-4 py-3 border border-[var(--border)] rounded bg-[var(--card)] flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--silver)] truncate">
                    {DISPOSITION_LABELS[d]}
                  </div>
                  <div className="mt-2 h-1 bg-[var(--border)] rounded overflow-hidden">
                    <div
                      className="h-full bg-[var(--red)] transition-all"
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-base text-white">{count}</div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)]">
                    {percent.toFixed(0)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 14-day daily trend */}
      <div>
        <SectionLabel>Daily trend (last {TREND_DAYS} days)</SectionLabel>
        <div className="border border-[var(--border)] rounded bg-[var(--card)] p-4">
          <LineChart series={trendSeries} dates={chartDates} height={220} />
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs uppercase tracking-[0.16em] text-[var(--silver-muted)]">
            {trendSeries.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-2">
                <span
                  className="inline-block w-4 h-1 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Day timeline */}
      <div>
        <SectionLabel>Day timeline</SectionLabel>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Link
            href={dateLink(prevDate)}
            className="inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--border)] text-[var(--silver)] hover:border-[var(--border-strong)]"
          >
            <ChevronLeft className="h-3 w-3" />
          </Link>
          <div className="px-5 py-2 border border-[var(--border)] rounded bg-[var(--card)] font-display text-xl text-white min-w-[200px] text-center">
            {formatInTz(new Date(`${selectedDate}T12:00:00.000Z`), timezone, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "2-digit",
            })}
            {selectedDate === todayDate && (
              <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-[var(--red)] font-sans">
                today
              </span>
            )}
          </div>
          <Link
            href={dateLink(nextDate)}
            className={`inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--border)] text-[var(--silver)] hover:border-[var(--border-strong)] ${
              selectedDate >= todayDate ? "opacity-30 pointer-events-none" : ""
            }`}
          >
            <ChevronRight className="h-3 w-3" />
          </Link>
          {selectedDate !== todayDate && (
            <Link
              href={dateLink(todayDate)}
              className="text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)] hover:text-[var(--silver)] ml-2"
            >
              Jump to today
            </Link>
          )}
          <div className="ml-auto flex items-baseline gap-x-5 gap-y-1 flex-wrap">
            <DaySummaryStat value={String(dayDials)} unit="dials" />
            <DaySummaryStat value={String(dayCalls)} unit="calls" />
            <DaySummaryStat value={String(dayConnects)} unit="connects" />
            <DaySummaryStat
              value={formatDuration(dayOnlineSeconds)}
              unit="online"
            />
          </div>
        </div>

        <DayTimeline
          dayStartMs={dayStartMs}
          onlineBands={onlineBands}
          callBands={callBands}
        />

        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--silver-muted)] mt-3">
          All times shown in {timezone}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-3">
      {children}
    </div>
  );
}

/**
 * Rate card: headline percentage, period-over-period delta pill, and
 * a proportional bar so magnitude scans visually.
 */
function RateCard({
  label,
  help,
  value,
  percent,
  delta,
}: {
  label: string;
  help: string;
  value: string;
  percent: number;
  delta?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="px-5 py-4 border border-[var(--border)] rounded bg-[var(--card)]">
      <MetricLabel
        label={label}
        help={help}
        className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2"
      />
      <div className="font-display text-4xl text-white mb-2">{value}</div>
      {delta && <div className="mb-3 min-h-[22px]">{delta}</div>}
      <div className="h-1 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--silver)] rounded-full transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function DaySummaryStat({ value, unit }: { value: string; unit: string }) {
  return (
    <span>
      <span className="font-display text-2xl text-white">{value}</span>
      <span className="ml-1.5 text-[10px] uppercase tracking-[0.20em] text-[var(--silver-muted)]">
        {unit}
      </span>
    </span>
  );
}
