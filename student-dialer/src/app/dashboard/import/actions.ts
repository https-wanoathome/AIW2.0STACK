"use server";

import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { upsertContact } from "@/lib/ghl";
import { extractCountryCode } from "@/lib/phone";
import { revalidatePath } from "next/cache";
import type { Profile } from "@/lib/types";
import type { ImportCounts, ImportPreview, ImportRow } from "./types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const MAX_ROWS = 500;
const CHUNK_SIZE = 5;
const CHUNK_DELAY_MS = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const importRowSchema = z
  .object({
    name: z.string().trim().min(1, "missing name"),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  })
  .refine((r) => r.phone !== null || r.email !== null, {
    message: "needs a phone or an email",
  });

async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return profile;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// CSV parsing helpers (hand-rolled, no deps)
// ============================================================

/** Split one CSV/TSV line, honoring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHeader(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

const NAME_HEADERS = ["name", "full name", "fullname", "contact name", "lead name"];
const FIRST_HEADERS = ["first name", "firstname", "first"];
const LAST_HEADERS = ["last name", "lastname", "last", "surname"];
const PHONE_HEADERS = [
  "phone",
  "phone number",
  "mobile",
  "mobile number",
  "cell",
  "cell phone",
  "telephone",
  "number",
  "contact number",
];
const EMAIL_HEADERS = ["email", "e mail", "email address"];

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(h));
}

/**
 * Normalize a raw phone string to something GHL can dedupe on.
 * Strips formatting, assumes US for bare 10/11-digit numbers.
 */
function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned.replace(/\D/g, "").length < 7) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

// ============================================================
// parseImport: raw CSV text -> validated preview (no writes)
// ============================================================

export async function parseImport(
  rawText: string,
): Promise<ActionResult<ImportPreview>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const text = (rawText ?? "").trim();
  if (!text) {
    return { ok: false, error: "Paste CSV text or choose a file first." };
  }

  const lines = text.split(/\r\n|\n|\r/);
  const headerLine = lines[0];
  const delim = headerLine.includes("\t") ? "\t" : ",";
  const headers = splitLine(headerLine, delim).map(normalizeHeader);

  const nameCol = findColumn(headers, NAME_HEADERS);
  const firstCol = findColumn(headers, FIRST_HEADERS);
  const lastCol = findColumn(headers, LAST_HEADERS);
  const phoneCol = findColumn(headers, PHONE_HEADERS);
  const emailCol = findColumn(headers, EMAIL_HEADERS);

  if (nameCol === -1 && firstCol === -1 && lastCol === -1) {
    return {
      ok: false,
      error:
        "No name column found. The first row must be a header with a name column (or first_name and last_name).",
    };
  }
  if (phoneCol === -1 && emailCol === -1) {
    return {
      ok: false,
      error: "No phone or email column found in the header row.",
    };
  }

  const dataLines: Array<{ line: number; text: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) dataLines.push({ line: i + 1, text: lines[i] });
  }
  if (dataLines.length === 0) {
    return { ok: false, error: "No data rows found below the header." };
  }
  if (dataLines.length > MAX_ROWS) {
    return {
      ok: false,
      error: `Too many rows (${dataLines.length}). Max ${MAX_ROWS} per import. Split the file and run it in parts.`,
    };
  }

  const rows: ImportRow[] = [];
  const errors: ImportPreview["errors"] = [];

  for (const { line, text: lineText } of dataLines) {
    const cells = splitLine(lineText, delim);
    const get = (idx: number) =>
      idx >= 0 && idx < cells.length ? cells[idx].trim() : "";

    const firstName = firstCol >= 0 ? get(firstCol) : "";
    const lastName = lastCol >= 0 ? get(lastCol) : "";
    let name = nameCol >= 0 ? get(nameCol) : "";
    if (!name) name = [firstName, lastName].filter(Boolean).join(" ");

    const phone = phoneCol >= 0 ? normalizePhone(get(phoneCol)) : null;

    let email: string | null = null;
    const rawEmail = emailCol >= 0 ? get(emailCol).toLowerCase() : "";
    if (rawEmail) {
      if (EMAIL_RE.test(rawEmail)) {
        email = rawEmail;
      } else if (!phone) {
        errors.push({ line, message: `invalid email "${rawEmail}" and no usable phone` });
        continue;
      }
      // Invalid email with a valid phone: drop the email, keep the row.
    }

    const candidate: ImportRow = {
      name,
      firstName: firstName || null,
      lastName: lastName || null,
      phone,
      email,
    };

    const parsed = importRowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        line,
        message: parsed.error.issues[0]?.message ?? "invalid row",
      });
      continue;
    }
    rows.push(parsed.data);
  }

  return { ok: true, data: { rows, errors } };
}

// ============================================================
// runImport: upsert contacts in GHL, queue them, log the batch
// ============================================================

export async function runImport(
  rows: ImportRow[],
  filename: string | null,
): Promise<ActionResult<ImportCounts>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const parsed = z.array(importRowSchema).min(1).max(MAX_ROWS).safeParse(rows);
  if (!parsed.success) {
    return { ok: false, error: "No valid rows to import." };
  }
  const items = parsed.data;

  const admin = createAdminClient();
  let added = 0;
  let duplicates = 0;
  let failed = 0;

  // Small chunks: the ghl.ts semaphore caps concurrency, the delay
  // keeps us well under GHL's ~100 requests per 10s.
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (row) => {
        let contactId: string | null = null;
        try {
          const contact = await upsertContact({
            ...(row.firstName ? { firstName: row.firstName } : {}),
            ...(row.lastName ? { lastName: row.lastName } : {}),
            ...(!row.firstName && !row.lastName ? { name: row.name } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.email ? { email: row.email } : {}),
            tags: ["source:scraped"],
          });
          contactId = contact?.id ?? null;
        } catch {
          // GHL failure: count the row as failed, never abort the batch.
        }
        if (!contactId) {
          failed += 1;
          return;
        }

        // upsertContact does not say whether the contact was new, so
        // duplicates are counted from the queue insert: ignoreDuplicates
        // returns the row only when it was actually inserted.
        const { data: inserted, error: insErr } = await admin
          .from("lead_queue")
          .upsert(
            {
              ghl_contact_id: contactId,
              status: "queued",
              source: "import",
              contact_name: row.name,
              contact_phone: row.phone,
              phone_country_code: extractCountryCode(row.phone),
              payload: row as unknown as Record<string, unknown>,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ghl_contact_id", ignoreDuplicates: true },
          )
          .select("id");

        if (insErr) {
          failed += 1;
        } else if (inserted && inserted.length > 0) {
          added += 1;
        } else {
          duplicates += 1;
        }
      }),
    );
    if (i + CHUNK_SIZE < items.length) await sleep(CHUNK_DELAY_MS);
  }

  const { error: batchErr } = await admin.from("import_batches").insert({
    user_id: profile.id,
    filename: filename?.trim() || null,
    total_rows: items.length,
    added,
    duplicates,
    failed,
  });
  if (batchErr) {
    console.error("[import] failed to log import batch:", batchErr.message);
  }

  revalidatePath("/dashboard/import");
  return { ok: true, data: { total: items.length, added, duplicates, failed } };
}
