import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { formatDuration } from "@/lib/duration";
import {
  getRequestTimezone,
  getTodayStartIso,
  formatInTz,
} from "@/lib/timezone";
import {
  PERIODS,
  getPeriodStartIso,
  getPreviousPeriodBounds,
  periodLabel,
  comparisonLabel,
  type PeriodKey,
} from "../_components/period-tabs";
import { PeriodSelector } from "../_components/period-selector";
import { Delta } from "../_components/delta";
import { MetricLabel } from "../_components/metric-label";
import { LineChart } from "../_components/line-chart";
import { pagedFetch } from "./_lib/paged-fetch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats" };

const CONNECT_MIN_SECONDS = 30;
const CHART_MAX_DAYS = 366;

type DialEvent = {
  event_type: "claim" | "reclaim";
  created_at: string;
};

type DailyOnlineRow = {
  day: string;
  online_seconds: number | null;
};

// "YYYY-MM-DD" for an instant, in the viewer's timezone.
function dayKeyInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, daily_dial_target")
    .eq("id", user.id)
    .single<{ full_name: string | null; daily_dial_target: number }>();

  const sp = await searchParams;
  const period: PeriodKey = PERIODS.some((p) => p.key === sp.period)
    ? (sp.period as PeriodKey)
    : "7d";
  const startIso = getPeriodStartIso(period); // null = all time
  const prev = getPreviousPeriodBounds(period);
  const anchorIso = startIso ?? "1970-01-01T00:00:00.000Z";

  const timezone = await getRequestTimezone();
  const todayStartIso = getTodayStartIso(timezone);

  const admin = createAdminClient();

  // session_online_daily is keyed by UTC day. Fetch back to the previous
  // window's start so one pull covers both the current and prev sums.
  const curStartDate = anchorIso.slice(0, 10);
  const onlineFetchDate = prev ? prev.start.slice(0, 10) : curStartDate;

  const [
    dialEvents,
    dailyOnlineRows,
    { data: activity },
    { count: connectsCount },
    { count: bookingsCount },
    { count: todayDialsCount },
  ] = await Promise.all([
    // Dials = claim + reclaim events by me in the period.
    pagedFetch<DialEvent>((from, to) =>
      admin
        .from("lead_claim_events")
        .select("event_type, created_at")
        .eq("user_id", user.id)
        .in("event_type", ["claim", "reclaim"])
        .gte("created_at", anchorIso)
        .order("created_at", { ascending: true })
        .range(from, to)
        .returns<DialEvent[]>(),
    ),
    pagedFetch<DailyOnlineRow>((from, to) =>
      admin
        .from("session_online_daily")
        .select("day, online_seconds")
        .eq("user_id", user.id)
        .gte("day", onlineFetchDate)
        .range(from, to)
        .returns<DailyOnlineRow[]>(),
    ),
    admin
      .from("session_activity")
      .select("online_seconds_today, today_date")
      .eq("user_id", user.id)
      .maybeSingle<{ online_seconds_today: number; today_date: string }>(),
    // Connects = calls of 30s or more, anchored on started_at (real call time).
    admin
      .from("call_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("call_duration_seconds", CONNECT_MIN_SECONDS)
      .gte("started_at", anchorIso),
    // Bookings = real GHL appointments created, completed in the period.
    admin
      .from("lead_queue")
      .select("*", { count: "exact", head: true })
      .eq("claimed_by", user.id)
      .not("booked_appointment_id", "is", null)
      .gte("completed_at", anchorIso),
    // Today's dials for the daily target bar (today in the viewer's TZ,
    // independent of the selected period).
    admin
      .from("lead_claim_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("event_type", ["claim", "reclaim"])
      .gte("created_at", todayStartIso),
  ]);

  const dials = dialEvents.length;
  const connects = connectsCount ?? 0;
  const bookings = bookingsCount ?? 0;
  const dialsToday = todayDialsCount ?? 0;

  // Online seconds: daily archive, with today's row overlaid from the live
  // session counter so a lagging mirror can't undercount and a fresh mirror
  // can't double count.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const onlineByDay = new Map<string, number>();
  for (const r of dailyOnlineRows) {
    onlineByDay.set(r.day, r.online_seconds ?? 0);
  }
  if (activity && activity.today_date === todayUtc) {
    onlineByDay.set(
      todayUtc,
      Math.max(onlineByDay.get(todayUtc) ?? 0, activity.online_seconds_today ?? 0),
    );
  }
  let onlineSeconds = 0;
  let prevOnlineSeconds = 0;
  for (const [day, secs] of onlineByDay) {
    if (day >= curStartDate) onlineSeconds += secs;
    else if (prev && day >= prev.start.slice(0, 10)) prevOnlineSeconds += secs;
  }

  // Previous-window comparison counts (skipped for period=all).
  let prevDials: number | null = null;
  let prevConnects: number | null = null;
  let prevBookings: number | null = null;
  if (prev) {
    const [{ count: dC }, { count: cC }, { count: bC }] = await Promise.all([
      admin
        .from("lead_claim_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("event_type", ["claim", "reclaim"])
        .gte("created_at", prev.start)
        .lt("created_at", prev.end),
      admin
        .from("call_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("call_duration_seconds", CONNECT_MIN_SECONDS)
        .gte("started_at", prev.start)
        .lt("started_at", prev.end),
      admin
        .from("lead_queue")
        .select("*", { count: "exact", head: true })
        .eq("claimed_by", user.id)
        .not("booked_appointment_id", "is", null)
        .gte("completed_at", prev.start)
        .lt("completed_at", prev.end),
    ]);
    prevDials = dC ?? 0;
    prevConnects = cC ?? 0;
    prevBookings = bC ?? 0;
  }

  // Dials-per-day chart, bucketed by calendar day in the viewer's TZ.
  const todayKey = dayKeyInTz(new Date().toISOString(), timezone);
  let chartStartKey: string;
  if (startIso) {
    chartStartKey = dayKeyInTz(startIso, timezone);
  } else {
    chartStartKey =
      dialEvents.length > 0
        ? dayKeyInTz(dialEvents[0].created_at, timezone)
        : todayKey;
  }
  const dialsByDay = new Map<string, number>();
  for (const e of dialEvents) {
    const k = dayKeyInTz(e.created_at, timezone);
    dialsByDay.set(k, (dialsByDay.get(k) ?? 0) + 1);
  }
  const chartDays: string[] = [];
  for (
    let d = chartStartKey;
    d <= todayKey && chartDays.length < CHART_MAX_DAYS;
    d = addDays(d, 1)
  ) {
    chartDays.push(d);
  }
  const chartLabels = chartDays.map((d) =>
    formatInTz(new Date(`${d}T12:00:00.000Z`), timezone, {
      month: "short",
      day: "2-digit",
    }),
  );
  const chartValues = chartDays.map((d) => dialsByDay.get(d) ?? 0);

  // Daily target progress.
  const target = Math.max(1, profile?.daily_dial_target ?? 200);
  const targetPct = Math.min(100, Math.round((dialsToday / target) * 100));
  const remaining = Math.max(0, target - dialsToday);
  const onlineToday =
    activity && activity.today_date === todayUtc
      ? activity.online_seconds_today ?? 0
      : 0;

  const vsLabel = comparisonLabel(period);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] animate-pulse" />
          Personal scoreboard
        </div>
        <h1 className="font-display text-6xl md:text-7xl text-white">
          Stats<span className="text-[var(--red)]">.</span>
        </h1>
        <div className="text-xs text-[var(--silver-muted)] mt-3 font-mono">
          {profile?.full_name ? `${profile.full_name} · ` : ""}
          {formatInTz(new Date(), timezone, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          })}{" "}
          · refresh page for latest
        </div>
      </div>

      {/* Period filter */}
      <div>
        <div className="text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-2">
          Time window
        </div>
        <PeriodSelector current={period} />
      </div>

      {/* Headline metrics */}
      <div>
        <SectionLabel>Activity · last {periodLabel(period)}</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label={
              <MetricLabel
                label="Dials"
                help="Total claim and reclaim events you logged in this window. Every dial attempt counts."
              />
            }
            value={dials}
            delta={
              <Delta
                current={dials}
                previous={prevDials}
                direction="up"
                label={vsLabel}
              />
            }
          />
          <StatCard
            label={
              <MetricLabel
                label="Connects"
                help="Calls that lasted 30 seconds or more, from the telephony log."
              />
            }
            value={connects}
            delta={
              <Delta
                current={connects}
                previous={prevConnects}
                direction="up"
                label={vsLabel}
              />
            }
          />
          <StatCard
            label={
              <MetricLabel
                label="Bookings"
                help="Leads where a GHL appointment was actually created and the dispo landed in this window."
              />
            }
            value={bookings}
            delta={
              <Delta
                current={bookings}
                previous={prevBookings}
                direction="up"
                label={vsLabel}
              />
            }
          />
          <StatCard
            label={
              <MetricLabel
                label="Online time"
                help="Total time clocked online in this window, from your heartbeat sessions."
              />
            }
            value={formatDuration(onlineSeconds)}
            delta={
              <Delta
                current={onlineSeconds}
                previous={prev ? prevOnlineSeconds : null}
                direction="up"
                label={vsLabel}
              />
            }
          />
        </div>
      </div>

      {/* Daily target */}
      <div>
        <SectionLabel>
          <MetricLabel
            label="Daily target · today"
            help="Dials logged since midnight (your local time) against your daily dial target."
          />
        </SectionLabel>
        <div className="border border-[var(--border)] rounded bg-[var(--card)] px-5 py-4">
          <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
            <div>
              <span className="font-display text-5xl text-white">
                {dialsToday}
              </span>
              <span className="font-display text-2xl text-[var(--silver-muted)]">
                {" "}
                / {target}
              </span>
              <span className="ml-3 text-[10px] uppercase tracking-[0.20em] text-[var(--silver-muted)]">
                dials
              </span>
            </div>
            <div className="text-xs text-[var(--silver-muted)] font-mono text-right">
              <div>
                {remaining > 0 ? `${remaining} dials to go` : "Target hit"}
              </div>
              <div>{formatDuration(onlineToday)} online today</div>
            </div>
          </div>
          <div className="h-2 rounded overflow-hidden bg-[var(--border)]">
            <div
              className={`h-full transition-[width] ${
                targetPct >= 100 ? "bg-green-500" : "bg-[var(--red)]"
              }`}
              style={{ width: `${targetPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Dials per day */}
      <div>
        <SectionLabel>
          Dials per day · last {periodLabel(period)}
        </SectionLabel>
        <div className="border border-[var(--border)] rounded bg-[var(--card)] p-4">
          <LineChart
            dates={chartLabels}
            series={[{ label: "Dials", color: "var(--red)", values: chartValues }]}
          />
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

function StatCard({
  label,
  value,
  delta,
}: {
  label: React.ReactNode;
  value: number | string;
  delta?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 border border-[var(--border)] rounded bg-[var(--card)]">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2 truncate">
        {label}
      </div>
      <div className="font-display text-4xl text-white">{value}</div>
      <div className="min-h-[14px] mt-2">{delta}</div>
    </div>
  );
}
