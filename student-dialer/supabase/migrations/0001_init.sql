-- ============================================================
-- Student Dialer: full schema
-- ============================================================
-- Run this once in your Supabase SQL Editor on a brand-new project.
-- Supabase Dashboard -> SQL Editor -> New Query -> paste -> Run.
--
-- All writes go through the service role (server actions and
-- webhook handlers). RLS only grants reads to the signed-in
-- student, plus full access to their own session_activity row.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
-- One row per auth user, auto-created on signup.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  ghl_user_id text,
  daily_dial_target int not null default 200,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- lead_queue
-- ------------------------------------------------------------
-- One row per GHL contact in the dial queue. updated_at is set by
-- application code on every write (no trigger, matching the reference).
create table public.lead_queue (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'calling', 'soft_claimed', 'scheduled_callback', 'skipped', 'completed', 'dead')),
  source text not null default 'webhook'
    check (source in ('webhook', 'import')),

  -- timing
  queued_at timestamptz not null default now(),
  first_visible_at timestamptz,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  callback_at timestamptz,
  completed_at timestamptz,

  -- ownership and outcome
  claimed_by uuid references public.profiles(id) on delete set null,
  disposition text,
  time_to_lead_seconds int,
  requeue_count int not null default 0,
  booked_appointment_id text,
  booked_at timestamptz,

  -- contact snapshot
  phone_country_code text,
  contact_name text,
  contact_phone text,
  payload jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index lead_queue_status_queued_idx
  on public.lead_queue (status, queued_at desc);

create index lead_queue_claimed_by_status_idx
  on public.lead_queue (claimed_by, status);

create index lead_queue_callback_at_idx
  on public.lead_queue (callback_at);

-- ------------------------------------------------------------
-- lead_claim_events
-- ------------------------------------------------------------
-- One row per claim/reclaim/skip/release. Dials are counted from here.
create table public.lead_claim_events (
  id bigint primary key generated always as identity,
  lead_queue_id uuid references public.lead_queue(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  event_type text check (event_type in ('claim', 'reclaim', 'skip', 'release')),
  created_at timestamptz default now()
);

create index lead_claim_events_user_created_idx
  on public.lead_claim_events (user_id, created_at desc);

-- ------------------------------------------------------------
-- call_logs
-- ------------------------------------------------------------
-- One row per outbound call from the GHL call webhook.
-- The unique must be a real table constraint, not a partial index,
-- or PostgREST upsert onConflict fails with 42P10.
create table public.call_logs (
  id bigint primary key generated always as identity,
  ghl_contact_id text not null,
  lead_queue_id uuid references public.lead_queue(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  ghl_user_id text,
  call_status text,
  call_duration_seconds int,
  direction text,
  started_at timestamptz not null,
  ended_at timestamptz,
  received_at timestamptz default now(),
  raw jsonb,
  constraint call_logs_contact_started_unique unique (ghl_contact_id, started_at)
);

-- ------------------------------------------------------------
-- session_activity
-- ------------------------------------------------------------
-- Live presence state, one row per user, updated by heartbeats.
create table public.session_activity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean default false,
  last_heartbeat_at timestamptz,
  online_seconds_today int default 0,
  today_date date default current_date
);

-- ------------------------------------------------------------
-- session_online_daily
-- ------------------------------------------------------------
-- Archived online seconds per day, mirrored from session_activity.
create table public.session_online_daily (
  user_id uuid references public.profiles(id) on delete cascade,
  day date,
  online_seconds int default 0,
  primary key (user_id, day)
);

-- ------------------------------------------------------------
-- session_events
-- ------------------------------------------------------------
-- Discrete online/offline transitions for debugging presence.
create table public.session_events (
  id bigint primary key generated always as identity,
  user_id uuid references public.profiles(id) on delete cascade,
  event text check (event in ('online', 'offline')),
  source text check (source in ('toggle', 'idle', 'heartbeat-resume')),
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- webhook_debug
-- ------------------------------------------------------------
-- Raw mirror of every webhook request for troubleshooting.
create table public.webhook_debug (
  id bigint primary key generated always as identity,
  route text,
  headers jsonb,
  body jsonb,
  note text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- import_batches
-- ------------------------------------------------------------
-- One row per CSV import run from the Import Leads tab.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  filename text,
  total_rows int,
  added int,
  duplicates int,
  failed int,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- expiry functions
-- ------------------------------------------------------------
-- Called lazily on Dial tab page load instead of a cron.

-- Soft claims and scheduled callbacks go back to the queue once
-- claim_expires_at passes.
create or replace function public.expire_soft_claims()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lead_queue
  set
    status = 'queued',
    claimed_by = null,
    claimed_at = null,
    claim_expires_at = null,
    callback_at = null
  where status in ('soft_claimed', 'scheduled_callback')
    and claim_expires_at is not null
    and claim_expires_at < now();
end;
$$;

-- Skipped leads re-enter the queue after their 24h cooldown.
create or replace function public.expire_skipped_claims()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lead_queue
  set
    status = 'queued',
    claimed_by = null,
    claimed_at = null,
    claim_expires_at = null,
    requeue_count = requeue_count + 1
  where status = 'skipped'
    and claim_expires_at is not null
    and claim_expires_at < now();
end;
$$;

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
-- Reads only. All writes use the service role, which bypasses RLS.
alter table public.profiles enable row level security;
alter table public.lead_queue enable row level security;
alter table public.lead_claim_events enable row level security;
alter table public.call_logs enable row level security;
alter table public.session_activity enable row level security;
alter table public.session_online_daily enable row level security;
alter table public.session_events enable row level security;
alter table public.webhook_debug enable row level security;
alter table public.import_batches enable row level security;

create policy "profiles_self_select"
  on public.profiles for select
  using (auth.uid() = id);

-- Single-student deploy: any signed-in user can read the queue.
create policy "lead_queue_authenticated_select"
  on public.lead_queue for select
  to authenticated
  using (true);

create policy "lead_claim_events_self_select"
  on public.lead_claim_events for select
  using (auth.uid() = user_id);

create policy "call_logs_self_select"
  on public.call_logs for select
  using (auth.uid() = user_id);

create policy "session_activity_self_all"
  on public.session_activity for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "session_online_daily_self_select"
  on public.session_online_daily for select
  using (auth.uid() = user_id);

create policy "session_events_self_select"
  on public.session_events for select
  using (auth.uid() = user_id);

create policy "webhook_debug_authenticated_select"
  on public.webhook_debug for select
  to authenticated
  using (true);

create policy "import_batches_authenticated_select"
  on public.import_batches for select
  to authenticated
  using (true);
