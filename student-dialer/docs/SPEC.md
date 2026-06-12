# Student Dialer: Build Contract

Single-role lightweight dialer for AIW students. Cherry-picked from the reference
repo at `../reference/diallerdashboard` (READ-ONLY: never modify anything in it).
One student per deployment: own Supabase project, own Vercel deploy, own GHL
sub-account. GHL is the system of record for contacts, tags, notes, calls and
appointments. Supabase holds the user, the lead queue, claim events, call logs,
presence and import batches.

## Stack and hard rules

- Next.js 16.2.6, App Router, server components and server actions. React 19.2.4.
- Tailwind CSS 4, dark-only design system from the reference `globals.css`.
- Supabase via `@supabase/ssr` SERVER-SIDE ONLY. There is NO browser Supabase
  client file. Do not create `src/lib/supabase/client.ts`. No realtime.
- No env var may be prefixed `NEXT_PUBLIC_`. Everything is server-side.
- No chart libraries (hand-rolled SVG only), no state libraries, no UI kits.
  Allowed deps are exactly what is in `package.json`.
- Server actions return `{ ok: true, data } | { ok: false, error }`.
- Every dashboard page exports `const dynamic = "force-dynamic"`.
- All DB writes go through `createAdminClient()` (service role). RLS only
  grants self-scoped SELECTs (plus self ALL on `session_activity`).
- Webhooks are idempotent, self-verify via `X-Webhook-Secret` against
  `WEBHOOK_SECRET`, and mirror every raw request into `webhook_debug`.
- Branding: app name is "Student Dialer". No "Time to Lead", no AIW operator
  strings. Appointment title: `${leadName} - Discovery Call`.
- Match the reference repo's code style. The reference code is known to work
  against this exact Next.js version; when unsure about a Next 16 pattern,
  copy the reference pattern rather than inventing one.

## Env vars (server-side only)

SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
GHL_PRIVATE_INTEGRATION_TOKEN, GHL_LOCATION_ID, GHL_LOCATION_TZ,
GHL_APP_BASE_URL (default https://app.gohighlevel.com),
GHL_BOOKING_CALENDAR_ID, WEBHOOK_SECRET.

## Routes / file tree (target)

- `/` -> redirect to `/dashboard` (or `/login` when signed out)
- `/login` -> email/password sign-in (no signup UI)
- `/dashboard` -> redirect to `/dashboard/dial`
- `/dashboard/dial` -> Dial tab
- `/dashboard/stats` -> Stats tab
- `/dashboard/insights` -> Insights tab
- `/dashboard/import` -> Import Leads tab
- `/api/heartbeat` (POST), `/api/leads/[id]/seen` (POST)
- `/api/webhooks/ghl` (POST, contact created)
- `/api/webhooks/ghl-call` (POST, outbound call completed)
- `/auth/signout` (POST)

Shared shell: `src/app/dashboard/layout.tsx` + `_components/` sidebar (4 static
tabs: Dial, Stats, Insights, Import Leads), topbar with GHL contact search,
mobile nav, sign-out button. No role gating anywhere.

## Types contract (`src/lib/types.ts`)

```ts
export type LeadStatus =
  | "queued" | "calling" | "soft_claimed" | "scheduled_callback"
  | "skipped" | "completed" | "dead";

export const DISPOSITIONS = [
  "no_answer", "voicemail", "gatekeeper", "not_interested",
  "callback", "wrong_number", "dq", "booked",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type ClaimEventType = "claim" | "reclaim" | "skip" | "release";
export type LeadSource = "webhook" | "import";
```

Plus row types: `Profile` (id, full_name, ghl_user_id, daily_dial_target,
is_active, created_at), `LeadQueueRow`, `CallLogRow`, `ImportBatchRow` matching
the schema below. Display labels for dispositions live next to `DISPOSITIONS`.

## Disposition behavior (server action `submitDisposition`)

Every disposition writes GHL tag `dispo:<value>` (best-effort) and an optional
note via POST /contacts/{id}/notes (best-effort; GHL failures never roll back
the queue update).

- `dq` -> status `dead`, `completed_at` stamped.
- `booked` -> handled by the booking flow: free-slots on
  `GHL_BOOKING_CALENDAR_ID`, create appointment, then status `completed`,
  `booked_appointment_id` + `booked_at` stamped.
- `callback` -> status `scheduled_callback`, `callback_at` = chosen time,
  `claim_expires_at` = chosen time, GHL task "Callback: <student name>".
- everything else (`no_answer`, `voicemail`, `gatekeeper`, `not_interested`,
  `wrong_number`) -> status `soft_claimed`, `claim_expires_at` = now + 24h.

Skip (separate action): status `skipped`, `claim_expires_at` = now + 24h,
logs a `skip` claim event, stamps `claimed_by` but NOT `claimed_at`, touches
nothing in GHL.

## Queue selection (Dial tab)

On page load run lazy expiry (`expire_soft_claims()`, `expire_skipped_claims()`
RPCs), then: active lead = my row with status `calling` (oldest `claimed_at`);
else next lead = newest `queued` row (`queued_at DESC LIMIT 1`). No region
tabs, no `reserved_for_user_id`. Claiming: validate status is `queued`, or
`soft_claimed`/`scheduled_callback` with `claimed_by` = me; set status
`calling`, stamp `claimed_at`, compute `time_to_lead_seconds` only when coming
from `queued`, clear `claim_expires_at`, backfill `first_visible_at` if null;
assign contact in GHL (PUT /contacts/{id} {assignedTo}); roll back to previous
status if the GHL call throws; insert `lead_claim_events` row (`claim` when
from `queued`, else `reclaim`); return the GHL contact URL
(`${GHL_APP_BASE_URL}/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`)
for the client to `window.open`.

## Schema (single file `supabase/migrations/0001_init.sql`)

Written fresh; the reference migrations have drifted and are NOT copied.

- `profiles`: id uuid PK refs auth.users on delete cascade, full_name text,
  ghl_user_id text, daily_dial_target int not null default 200, is_active bool
  not null default true, created_at timestamptz default now(). Trigger
  `on_auth_user_created` -> `handle_new_user()` (SECURITY DEFINER) creates the
  row from `raw_user_meta_data->>'full_name'`.
- `lead_queue`: id uuid PK default gen_random_uuid(), ghl_contact_id text NOT
  NULL UNIQUE, status text NOT NULL default 'queued' CHECK (the 7 LeadStatus
  values), source text NOT NULL default 'webhook' CHECK ('webhook','import'),
  queued_at timestamptz NOT NULL default now(), first_visible_at timestamptz,
  claimed_by uuid refs profiles, claimed_at timestamptz, claim_expires_at
  timestamptz, callback_at timestamptz, completed_at timestamptz, disposition
  text, time_to_lead_seconds int, requeue_count int NOT NULL default 0,
  booked_appointment_id text, booked_at timestamptz,
  phone_country_code text, contact_name text, contact_phone text, payload
  jsonb, created_at/updated_at timestamptz default now(). Indexes on (status,
  queued_at desc), (claimed_by, status), (callback_at).
- `lead_claim_events`: id bigint PK generated always as identity,
  lead_queue_id uuid refs lead_queue, user_id uuid refs profiles, event_type
  text CHECK ('claim','reclaim','skip','release'), created_at timestamptz
  default now(). Index on (user_id, created_at desc).
- `call_logs`: id bigint identity PK, ghl_contact_id text NOT NULL,
  lead_queue_id uuid refs lead_queue, user_id uuid refs profiles, ghl_user_id
  text, call_status text, call_duration_seconds int, direction text,
  started_at timestamptz NOT NULL, ended_at timestamptz, received_at
  timestamptz default now(), raw jsonb, CONSTRAINT
  call_logs_contact_started_unique UNIQUE (ghl_contact_id, started_at).
- `session_activity`: user_id uuid PK refs profiles, is_online bool default
  false, last_heartbeat_at timestamptz, online_seconds_today int default 0,
  today_date date default current_date.
- `session_online_daily`: user_id uuid refs profiles, day date,
  online_seconds int default 0, PK (user_id, day).
- `session_events`: id bigint identity PK, user_id uuid refs profiles, event
  text CHECK ('online','offline'), source text CHECK
  ('toggle','idle','heartbeat-resume'), created_at timestamptz default now().
- `webhook_debug`: id bigint identity PK, route text, headers jsonb, body
  jsonb, note text, created_at timestamptz default now().
- `import_batches`: id uuid PK default gen_random_uuid(), user_id uuid refs
  profiles, filename text, total_rows int, added int, duplicates int, failed
  int, created_at timestamptz default now().
- Functions: `expire_soft_claims()` requeues `soft_claimed` and
  `scheduled_callback` rows whose `claim_expires_at` < now() (status ->
  'queued', clear claimed_by/claimed_at/claim_expires_at/callback_at);
  `expire_skipped_claims()` requeues `skipped` rows past expiry with
  `requeue_count = requeue_count + 1`.
- RLS enabled on every table. Self-scoped SELECT for authenticated users
  (`auth.uid() = user_id` where applicable; `lead_queue` and `webhook_debug`
  SELECT for any authenticated user since this is a single-student deploy).
  `session_activity` gets self ALL. No other write policies: writes use the
  service role.

## GHL surface (`src/lib/ghl.ts`)

Base `https://services.leadconnectorhq.com`, headers
`Authorization: Bearer ${GHL_PRIVATE_INTEGRATION_TOKEN}`,
`Version: 2021-07-28`. Keep the reference client's semaphore (8 permits),
retry/backoff on 429/503, 60s contact cache. Functions: `getContact`,
`searchContacts` (POST /contacts/search), `addContactTags`
(POST /contacts/{id}/tags), `addContactNote` (POST /contacts/{id}/notes),
`createContactTask` (POST /contacts/{id}/tasks), `assignContactToUser`
(PUT /contacts/{id}), `getFreeSlots`
(GET /calendars/{calendarId}/free-slots), `createAppointment`
(POST /calendars/events/appointments), `getGHLContactURL` (env-driven domain),
and NET-NEW `upsertContact` (POST /contacts/upsert with locationId in body,
returns the contact with its id). Drop everything Typeform and autobook.

## Webhooks

- POST `/api/webhooks/ghl`: body `{"contact_id": "{{contact.id}}"}` from a GHL
  "Contact Created" workflow. Best-effort `getContact` for the phone country
  code and name, then upsert `lead_queue` (onConflict `ghl_contact_id`,
  ignoreDuplicates: true) with status 'queued', source 'webhook'. 401 on bad
  secret. Always 200 on duplicates.
- POST `/api/webhooks/ghl-call`: GHL "Outbound Call Completed" workflow. Parse
  offset-less local timestamps using `GHL_LOCATION_TZ` env (NOT hardcoded).
  Map `user_id` -> profiles via `profiles.ghl_user_id`. Link the most recent
  `lead_queue` row for the contact. Upsert `call_logs` onConflict
  `ghl_contact_id,started_at` (ignoreDuplicates: false), `started_at` falls
  back to `received_at`. Return 200 (not 4xx) for missing contact_id so GHL
  does not retry; 403 on bad secret.

## Presence

ActivityProvider posts `/api/heartbeat` every 15s while online; idle timeout
30s (30 min cap while a lead is in status `calling`); heartbeat increments
`session_activity.online_seconds_today` by 15 and mirrors into
`session_online_daily`; transitions append `session_events`. Online toggle in
the Dial tab header; Dial button disabled while offline. SeenPinger posts
`/api/leads/[id]/seen` once per lead to stamp `first_visible_at`.

## Stats definitions (shared by Stats and Insights tabs)

- Dials = `lead_claim_events` rows with event_type IN ('claim','reclaim') for
  me in period (by `created_at`).
- Connects = `call_logs` rows for me in period where call_duration_seconds >= 30.
- Bookings = `lead_queue` rows with `booked_appointment_id IS NOT NULL` and
  `completed_at` in period.
- Online time = `session_online_daily` (+ today from `session_activity`).
- Periods: 24h, 48h, 3d, 7d, 14d, 1m, 3m, all. Delta vs the previous window
  of the same length. Use the `pagedFetch` pattern (1000-row pages) for any
  unbounded query.
- Rates (Insights): connect rate = connects/dials, book rate = bookings/dials,
  no-answer rate = no_answer dispos/dispos, dq rate = dq dispos/dispos.
