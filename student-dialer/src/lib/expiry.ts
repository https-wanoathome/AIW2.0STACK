import { createAdminClient } from "@/lib/supabase/server";

/**
 * Run lazy expiry. Called at the top of the Dial tab page load so we
 * don't need a cron.
 *
 *  - expire_soft_claims(): soft_claimed and scheduled_callback rows
 *    past claim_expires_at go back to queued.
 *  - expire_skipped_claims(): skipped rows past expiry go back to
 *    queued with requeue_count bumped.
 */
export async function runLazyExpiry() {
  const admin = createAdminClient();
  try {
    await admin.rpc("expire_soft_claims");
  } catch {
    // Don't fail page render on expiry hiccup.
  }
  try {
    await admin.rpc("expire_skipped_claims");
  } catch {
    // ignore
  }
}

/**
 * Standard 24h soft-claim expiry.
 */
export function getStandardClaimExpiryIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
