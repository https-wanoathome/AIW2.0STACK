# Student Dialer

A lightweight dialing dashboard. You import leads, dial them through GoHighLevel, log every call, and watch your numbers. Four tabs: Dial, Stats, Insights, Import Leads.

How it fits together:

- **GoHighLevel (GHL)** holds your contacts, tags, notes, calls and appointments. You dial inside GHL.
- **Supabase** holds your login, your lead queue, your call logs and your stats.
- **Vercel** hosts the app for free.

Setup takes about 30 minutes. Do the steps in order.

---

## What you need before you start

1. A GHL sub-account (location) with the phone system enabled.
2. A free [Supabase](https://supabase.com) account.
3. A free [Vercel](https://vercel.com) account and a GitHub account.

---

## Step 1: Supabase

1. Create a new Supabase project. Pick any name and a strong database password.
2. Open **SQL Editor**, paste the entire contents of `supabase/migrations/0001_init.sql` from this repo, and click **Run**. It should finish without errors.
3. Create your login: go to **Authentication, then Users, then Add user**. Use your email and a password. Before saving, add user metadata: `{"full_name": "Your Name"}`. This name shows in the app and on callback tasks.
4. Collect three values from **Project Settings, then API**:
   - Project URL (this is `SUPABASE_URL`)
   - anon public key (`SUPABASE_ANON_KEY`)
   - service_role key (`SUPABASE_SERVICE_ROLE_KEY`). Keep this one secret.

## Step 2: GoHighLevel

1. **Private Integration token.** In your sub-account go to **Settings, then Private Integrations, then Create**. Give it these scopes: View Contacts, Edit Contacts, View Calendars, Edit Calendar Events, View Users. Copy the token (`GHL_PRIVATE_INTEGRATION_TOKEN`).
2. **Location ID.** It is in your browser URL when you are inside the sub-account: `.../v2/location/XXXXXXXX/...`. That XXXXXXXX is `GHL_LOCATION_ID`.
3. **Timezone.** Settings, then Business Profile. Note the timezone and write it in IANA form, for example `America/New_York` or `Africa/Johannesburg`. This is `GHL_LOCATION_TZ`. If this is wrong your call times will be logged wrong.
4. **Booking calendar.** Settings, then Calendars. Create or pick the calendar your booked appointments should land on, and copy its ID (`GHL_BOOKING_CALENDAR_ID`).
5. **Your GHL user ID.** Settings, then My Staff, click your user. The ID is in the URL. Keep it for Step 5.
6. **Webhook secret.** Make up a long random string (a password generator works). This is `WEBHOOK_SECRET`. You will use it again in Step 4.

## Step 3: Deploy to Vercel

1. Push this repo to your own GitHub account (or use the repo link your program gave you and click Fork).
2. In Vercel: **Add New Project**, import the repo.
3. Before deploying, add every variable from `.env.example` under **Environment Variables**, with the values you collected. All nine are required. None of them start with NEXT_PUBLIC and none are visible to the browser.
4. Deploy. Note your app URL, for example `https://your-dialer.vercel.app`.
5. Open the URL and log in with the email and password from Step 1. You should see the four tabs.

## Step 4: GHL webhooks (two workflows)

These tell the app about new contacts and finished calls.

**Workflow 1: new contacts feed the queue.**
1. In GHL: **Automation, then Create Workflow**, trigger **Contact Created**.
2. Add action **Custom Webhook**:
   - Method: POST
   - URL: `https://your-dialer.vercel.app/api/webhooks/ghl`
   - Header: `X-Webhook-Secret` = your `WEBHOOK_SECRET` value
   - Body (JSON): `{"contact_id": "{{contact.id}}"}`
3. Publish the workflow.

**Workflow 2: finished calls feed your stats.**
1. Create a second workflow, trigger **Call Status** (outbound call completed).
2. Add action **Custom Webhook**:
   - Method: POST
   - URL: `https://your-dialer.vercel.app/api/webhooks/ghl-call`
   - Header: `X-Webhook-Secret` = your `WEBHOOK_SECRET` value
   - Body (JSON):

```json
{
  "contact_id": "{{contact.id}}",
  "contact_name": "{{contact.name}}",
  "contact_phone": "{{contact.phone}}",
  "contact_email": "{{contact.email}}",
  "call_status": "{{phoneCall.callStatus}}",
  "call_duration_seconds": "{{phoneCall.duration}}",
  "call_direction": "{{phoneCall.direction}}",
  "call_from": "{{phoneCall.from}}",
  "call_to": "{{phoneCall.to}}",
  "call_started_at": "{{phoneCall.startTime}}",
  "call_ended_at": "{{phoneCall.endTime}}",
  "user_id": "{{phoneCall.user.id}}",
  "user_name": "{{phoneCall.user.name}}"
}
```

3. Publish. The field names on the left must stay exactly as shown; the app reads those keys.

Health check: opening `https://your-dialer.vercel.app/api/webhooks/ghl` in a browser should return a small JSON status.

## Step 5: Link your GHL user to your profile

This makes calls count toward your stats and assigns contacts to you when you dial. In the Supabase **SQL Editor**, run (with your values):

```sql
update profiles set ghl_user_id = 'YOUR-GHL-USER-ID' where full_name = 'Your Name';
```

Optional: change your daily dial target (default is 200):

```sql
update profiles set daily_dial_target = 100 where full_name = 'Your Name';
```

---

## Using the app

**Import Leads.** Paste or upload a CSV with a header row. Needs a name column (`name`, or `first_name` and `last_name`) and a `phone` or `email` column. Up to 500 rows per import. Each lead is created in GHL (tagged `source:scraped`) and added to your queue. Re-importing the same file adds no duplicates.

**Dial.** Toggle yourself online. The app shows one lead at a time, newest first. Click Dial: the lead opens in GHL in a new tab, you call from there. Come back and hit one disposition: No Answer, Voicemail, Gatekeeper, Not Interested, Callback, Wrong Number, DQ or Booked. Callback asks for a time and creates a GHL task. Booked shows free slots from your calendar and books the appointment. Every disposition tags the contact in GHL as `dispo:<value>`.

**Stats.** Your dials, connects (calls of 30 seconds or more), bookings and online time, per period, with deltas against the previous period.

**Insights.** Your connect rate, book rate, no-answer rate and DQ rate, the breakdown per disposition, a 14-day trend, and an hour-by-hour timeline of any day.

---

## Smoke test (do this once after setup)

1. Create a test contact in GHL by hand. Within a few seconds it should appear in your Dial tab queue. If not: check Workflow 1 and your `WEBHOOK_SECRET`.
2. Click Dial. GHL should open on that contact and the contact should be assigned to you.
3. Call the contact (your own number works), hang up, then pick a disposition. The contact in GHL should now carry the `dispo:` tag.
4. After a few minutes, check Stats: 1 dial, and the call should appear. If the call is missing: check Workflow 2 and that `profiles.ghl_user_id` is set (Step 5).
5. Import a 2-row CSV. Both leads should land in GHL and the queue. Import it again: 0 added, 2 duplicates.

## When something is off

- Webhook problems: every webhook request, good or bad, is logged in the `webhook_debug` table in Supabase. Look at the newest rows.
- Queue looks stale: the page updates when you act or reload. Reload first.
- Call times look shifted by some hours: your `GHL_LOCATION_TZ` does not match the GHL location timezone.
- Changed an env var in Vercel: redeploy, env changes only apply on deploy.
