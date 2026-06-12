"use server";

import { createClient } from "@/lib/supabase/server";
import {
  searchContacts as ghlSearchContacts,
  getGHLContactURL,
  GHLError,
} from "@/lib/ghl";

export type ContactSearchResult = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  ghl_url: string;
};

export type SearchActionResult =
  | { ok: true; results: ContactSearchResult[] }
  | { ok: false; error: string };

/**
 * Top-bar contact search. Fuzzy-matches the query against the GHL
 * contacts pool and returns up to 8 results so the dropdown stays
 * compact. Click-through opens the GHL contact in a new tab.
 *
 * Auth-gated: any signed-in user can search (they need it to look up
 * leads they're working).
 */
export async function searchContactsAction(
  query: string,
): Promise<SearchActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const q = query.trim();
  // Require at least 2 chars to keep GHL requests + render churn low.
  if (q.length < 2) return { ok: true, results: [] };

  try {
    const data = await ghlSearchContacts({ query: q, pageLimit: 8 });
    const results: ContactSearchResult[] = (data.contacts ?? [])
      // The GHL API marks soft-deleted contacts via the `deleted` flag,
      // not exposed on our typed shape. Cast for the filter.
      .filter((c) => !(c as unknown as { deleted?: boolean }).deleted)
      .map((c) => {
        const combined = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
        const name = combined || c.name?.trim() || c.email || "Unnamed";
        return {
          id: c.id,
          name,
          email: c.email ?? null,
          phone: c.phone ?? null,
          ghl_url: getGHLContactURL(c.id),
        };
      });
    return { ok: true, results };
  } catch (e) {
    const message =
      e instanceof GHLError
        ? `GHL ${e.status}: ${e.body.slice(0, 120)}`
        : e instanceof Error
          ? e.message
          : "Search failed.";
    return { ok: false, error: message };
  }
}
