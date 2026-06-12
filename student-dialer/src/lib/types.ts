/**
 * Shared TypeScript types for the student dialer.
 */

export type LeadStatus =
  | "queued"
  | "calling"
  | "soft_claimed"
  | "scheduled_callback"
  | "skipped"
  | "completed"
  | "dead";

export const DISPOSITIONS = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "not_interested",
  "callback",
  "wrong_number",
  "dq",
  "booked",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  no_answer: "No Answer",
  voicemail: "Voicemail",
  gatekeeper: "Gatekeeper",
  not_interested: "Not Interested",
  callback: "Callback",
  wrong_number: "Wrong Number",
  dq: "DQ",
  booked: "Booked",
};

export type ClaimEventType = "claim" | "reclaim" | "skip" | "release";

export type LeadSource = "webhook" | "import";

export interface Profile {
  id: string;
  full_name: string | null;
  ghl_user_id: string | null;
  daily_dial_target: number;
  is_active: boolean;
  created_at: string;
}

export interface LeadQueueRow {
  id: string;
  ghl_contact_id: string;
  status: LeadStatus;
  source: LeadSource;
  queued_at: string;
  first_visible_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  callback_at: string | null;
  completed_at: string | null;
  disposition: Disposition | null;
  time_to_lead_seconds: number | null;
  requeue_count: number;
  booked_appointment_id: string | null;
  booked_at: string | null;
  phone_country_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CallLogRow {
  id: number;
  ghl_contact_id: string;
  lead_queue_id: string | null;
  user_id: string | null;
  ghl_user_id: string | null;
  call_status: string | null;
  call_duration_seconds: number | null;
  direction: string | null;
  started_at: string;
  ended_at: string | null;
  received_at: string;
  raw: Record<string, unknown> | null;
}

export interface ImportBatchRow {
  id: string;
  user_id: string | null;
  filename: string | null;
  total_rows: number | null;
  added: number | null;
  duplicates: number | null;
  failed: number | null;
  created_at: string;
}

export interface SessionActivityRow {
  user_id: string;
  is_online: boolean;
  last_heartbeat_at: string | null;
  online_seconds_today: number;
  today_date: string;
}
