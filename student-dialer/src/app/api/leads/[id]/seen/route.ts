import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * Mark a lead as first-visible. Stamps lead_queue.first_visible_at to
 * now if it's null. Idempotent for subsequent calls.
 *
 * Called from the Dial tab via SeenPinger the first time the lead card
 * renders.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Only set if not already set. Conditional update keeps it idempotent.
  const { data, error } = await admin
    .from("lead_queue")
    .update({ first_visible_at: now, updated_at: now })
    .eq("id", id)
    .is("first_visible_at", null)
    .select("first_visible_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    first_visible_at: data?.first_visible_at ?? null,
    was_already_seen: data === null,
  });
}
