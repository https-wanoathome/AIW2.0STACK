import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getContact } from "@/lib/ghl";
import { extractCountryCode } from "@/lib/phone";

/**
 * GHL "Contact Created" webhook.
 *
 * Configure in GHL:
 *   Workflow trigger: "Contact Created"
 *   Action: "Custom Webhook"
 *   URL: https://<your-domain>/api/webhooks/ghl
 *   Method: POST
 *   Headers: X-Webhook-Secret: <WEBHOOK_SECRET value>
 *   Raw Body (JSON): {"contact_id": "{{contact.id}}"}
 *
 * Verifies the shared secret, mirrors the raw request into
 * webhook_debug, then upserts the contact into lead_queue with
 * status 'queued'. Duplicate webhooks are no-ops (200).
 */
export async function POST(request: Request) {
  const presentedSecret = request.headers.get("x-webhook-secret");
  const expected = process.env.WEBHOOK_SECRET;
  const secretValid = !!expected && presentedSecret === expected;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const rawBody = await request.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // Not JSON. Mirrored below, rejected after.
  }

  const admin = createAdminClient();

  // Mirror every request, valid or not.
  try {
    await admin.from("webhook_debug").insert({
      route: "ghl",
      headers,
      body: payload ?? { raw: rawBody },
      note: `secret_valid=${secretValid}`,
    });
  } catch (e) {
    console.error("[webhooks/ghl] debug log failed", e);
  }

  if (!expected) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET not configured on server." },
      { status: 500 },
    );
  }

  if (!secretValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contactId =
    (payload.contact_id as string) ||
    (payload.contactId as string) ||
    (payload.id as string) ||
    ((payload.contact as Record<string, unknown>)?.id as string);

  if (!contactId) {
    return NextResponse.json(
      {
        error:
          "Missing contact id. Send `contact_id` or `id` in the webhook payload.",
        received: payload,
      },
      { status: 400 },
    );
  }

  // Best-effort contact snapshot. GHL failure never blocks queueing.
  let phoneCountryCode: string | null = null;
  let contactName: string | null = null;
  let contactPhone: string | null = null;
  try {
    const contact = await getContact(contactId);
    phoneCountryCode = extractCountryCode(contact?.phone);
    contactName =
      contact?.name ||
      [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
      null;
    contactPhone = contact?.phone ?? null;
  } catch {
    // ignore
  }

  const { data, error } = await admin
    .from("lead_queue")
    .upsert(
      {
        ghl_contact_id: contactId,
        status: "queued",
        source: "webhook",
        queued_at: new Date().toISOString(),
        phone_country_code: phoneCountryCode,
        contact_name: contactName,
        contact_phone: contactPhone,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ghl_contact_id", ignoreDuplicates: true },
    )
    .select("id, queued_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `Queue insert failed: ${error.message}`, contact_id: contactId },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    contact_id: contactId,
    queue_id: data?.id ?? "duplicate",
    queued_at: data?.queued_at ?? null,
  });
}

/**
 * GET for healthcheck.
 */
export async function GET() {
  if (!process.env.WEBHOOK_SECRET) {
    return NextResponse.json(
      { ok: false, error: "WEBHOOK_SECRET not configured." },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    endpoint: "webhooks/ghl",
    method_expected: "POST",
    auth: "X-Webhook-Secret header",
    body_expected: { contact_id: "string" },
  });
}
