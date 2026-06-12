/**
 * GoHighLevel API client.
 *
 * Wraps GHL's HTTP API. Write functions should only be called from
 * server actions or webhook handlers where the caller has been
 * authenticated and the operation has been approved.
 *
 * Reference: https://highlevel.stoplight.io/
 */

const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
const GHL_APP_BASE_URL =
  process.env.GHL_APP_BASE_URL || "https://app.gohighlevel.com";
const GHL_VERSION = "2021-07-28";

if (!GHL_LOCATION_ID) {
  console.warn("[ghl] GHL_LOCATION_ID not set. API calls will fail.");
}
if (!GHL_TOKEN) {
  console.warn(
    "[ghl] GHL_PRIVATE_INTEGRATION_TOKEN not set. API calls will fail.",
  );
}

export class GHLError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message?: string,
  ) {
    super(message ?? `GHL API ${status}: ${body.slice(0, 200)}`);
    this.name = "GHLError";
  }
}

type FetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

// ============================================================
// Concurrency limit (semaphore)
// ============================================================
// GHL allows ~100 requests per 10 seconds per location. Cap our
// in-flight requests so a single page load can't burst past that.

const MAX_CONCURRENT_GHL_REQUESTS = 8;

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = permits;
  }
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

// Module-level so it persists across requests within the same
// Vercel function instance.
const ghlSemaphore = new Semaphore(MAX_CONCURRENT_GHL_REQUESTS);

// ============================================================
// Retry on 429 with exponential backoff
// ============================================================

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ghlFetch<T = unknown>(
  path: string,
  init: FetchInit = {},
): Promise<T> {
  const url = `${GHL_API_BASE_URL}${path}`;

  await ghlSemaphore.acquire();
  try {
    let lastResponse: Response | null = null;
    let lastErrorText = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      lastResponse = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${GHL_TOKEN}`,
          Version: GHL_VERSION,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
        cache: "no-store",
      });

      // Success path
      if (lastResponse.ok) {
        const text = await lastResponse.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      // Retry path: 429 (rate limited) or 503 (transient)
      if (
        (lastResponse.status === 429 || lastResponse.status === 503) &&
        attempt < MAX_RETRIES
      ) {
        const retryAfterHeader = lastResponse.headers.get("retry-after");
        let waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        if (retryAfterHeader) {
          const retryAfterSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfterSec)) waitMs = retryAfterSec * 1000;
        }
        await sleep(waitMs);
        continue;
      }

      // Non-retriable error - capture body and break.
      lastErrorText = await lastResponse.text();
      break;
    }

    throw new GHLError(
      lastResponse?.status ?? 0,
      lastErrorText || `Failed after ${MAX_RETRIES + 1} attempts`,
    );
  } finally {
    ghlSemaphore.release();
  }
}

// ============================================================
// Contact cache (60s TTL, in-memory per function instance)
// ============================================================

const CONTACT_CACHE_TTL_MS = 60_000;
const contactCache = new Map<
  string,
  { data: GHLContact; expiresAt: number }
>();

// ============================================================
// Types
// ============================================================

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
  dateAdded?: string;
  dateUpdated?: string;
  assignedTo?: string;
  locationId?: string;
}

// ============================================================
// Read operations (safe to call anywhere)
// ============================================================

export async function getContact(contactId: string): Promise<GHLContact> {
  // Cache hit?
  const cached = contactCache.get(contactId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const data = await ghlFetch<{ contact: GHLContact }>(
    `/contacts/${contactId}`,
  );

  contactCache.set(contactId, {
    data: data.contact,
    expiresAt: Date.now() + CONTACT_CACHE_TTL_MS,
  });

  // Prune cache opportunistically if it grows large.
  if (contactCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of contactCache) {
      if (v.expiresAt < now) contactCache.delete(k);
    }
  }

  return data.contact;
}

/**
 * Invalidate cached contact entries. Call this after a write that
 * changes contact fields (e.g., after we tag/assign a contact).
 */
export function invalidateContactCache(contactId: string): void {
  contactCache.delete(contactId);
}

export async function searchContacts(params: {
  /**
   * Free-form fuzzy search string (matches name / email / phone / etc).
   * If provided, `filters` is ignored: GHL's API treats `query` as the
   * primary search term.
   */
  query?: string;
  filters?: Array<{ field: string; operator: string; value: unknown }>;
  pageLimit?: number;
  page?: number;
}): Promise<{ contacts: GHLContact[]; total: number }> {
  const body: Record<string, unknown> = {
    locationId: GHL_LOCATION_ID,
    pageLimit: params.pageLimit ?? 100,
    page: params.page ?? 1,
  };
  if (params.query && params.query.trim()) {
    body.query = params.query.trim();
  } else if (params.filters && params.filters.length > 0) {
    body.filters = params.filters;
  } else {
    body.filters = [];
  }
  const data = await ghlFetch<{ contacts: GHLContact[]; total: number }>(
    "/contacts/search",
    { method: "POST", body: JSON.stringify(body) },
  );
  return { contacts: data.contacts ?? [], total: data.total ?? 0 };
}

// ============================================================
// URL helpers
// ============================================================

/**
 * Returns the full URL to the contact's detail page inside GHL.
 * Used by the dashboard's click-to-open flow.
 */
export function getGHLContactURL(contactId: string): string {
  return `${GHL_APP_BASE_URL}/v2/location/${GHL_LOCATION_ID}/contacts/detail/${contactId}`;
}

// ============================================================
// Write operations (gated: call only from approved code paths)
// ============================================================

/**
 * Upsert a contact in the location. GHL dedupes by phone/email:
 * if a contact with the same phone or email already exists, it is
 * updated and returned instead of creating a duplicate.
 *
 * WARNING: live write to GHL.
 */
export async function upsertContact(input: {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  tags?: string[];
}): Promise<GHLContact> {
  const data = await ghlFetch<{ contact: GHLContact; new?: boolean }>(
    "/contacts/upsert",
    {
      method: "POST",
      body: JSON.stringify({ locationId: GHL_LOCATION_ID, ...input }),
    },
  );
  if (data.contact?.id) invalidateContactCache(data.contact.id);
  return data.contact;
}

/**
 * Assign a contact to a specific GHL user. Used when the student
 * claims a lead.
 *
 * WARNING: live write to GHL.
 */
export async function assignContactToUser(
  contactId: string,
  ghlUserId: string,
): Promise<void> {
  await ghlFetch(`/contacts/${contactId}`, {
    method: "PUT",
    body: JSON.stringify({ assignedTo: ghlUserId }),
  });
}

/**
 * Add tags to a contact (e.g., 'dispo:no_answer').
 */
export async function addContactTags(
  contactId: string,
  tags: string[],
): Promise<void> {
  await ghlFetch(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

/**
 * Add a note to a contact. Used to record disposition + call notes.
 *
 * WARNING: live write to GHL.
 */
export async function addContactNote(
  contactId: string,
  body: string,
  userId?: string,
): Promise<void> {
  await ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body, userId }),
  });
}

/**
 * Create a task on a contact. Used for callback reminders.
 *
 * WARNING: live write to GHL.
 */
export async function createContactTask(params: {
  contactId: string;
  title: string;
  body?: string;
  dueDate: string; // ISO
  assignedTo?: string;
  completed?: boolean;
}): Promise<{ id: string }> {
  const result = await ghlFetch<{ task?: { id: string }; id?: string }>(
    `/contacts/${params.contactId}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({
        title: params.title,
        body: params.body ?? "",
        dueDate: params.dueDate,
        assignedTo: params.assignedTo,
        completed: params.completed ?? false,
      }),
    },
  );
  const id = result.task?.id ?? result.id ?? "";
  return { id };
}

/**
 * Fetch free slots for a calendar in a date range.
 */
export async function getFreeSlots(params: {
  calendarId: string;
  startDate: number; // epoch ms
  endDate: number; // epoch ms
  timezone?: string;
}): Promise<Record<string, { slots: string[] }>> {
  const qs = new URLSearchParams({
    startDate: String(params.startDate),
    endDate: String(params.endDate),
  });
  if (params.timezone) qs.set("timezone", params.timezone);
  return ghlFetch(`/calendars/${params.calendarId}/free-slots?${qs}`);
}

/**
 * Create an appointment in a GHL calendar.
 */
export async function createAppointment(params: {
  calendarId: string;
  contactId: string;
  startTime: string; // ISO
  endTime: string; // ISO
  title?: string;
  assignedUserId?: string;
  appointmentStatus?: string;
}): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    calendarId: params.calendarId,
    locationId: GHL_LOCATION_ID,
    contactId: params.contactId,
    startTime: params.startTime,
    endTime: params.endTime,
    title: params.title ?? "Discovery Call",
    appointmentStatus: params.appointmentStatus ?? "confirmed",
  };
  if (params.assignedUserId) body.assignedUserId = params.assignedUserId;
  const result = await ghlFetch<{ id?: string; appointment?: { id: string } }>(
    `/calendars/events/appointments`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return { id: result.id ?? result.appointment?.id ?? "" };
}

export { GHL_LOCATION_ID, GHL_API_BASE_URL };
