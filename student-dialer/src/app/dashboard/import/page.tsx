import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { timeAgo } from "@/lib/duration";
import type { ImportBatchRow } from "@/lib/types";
import { ImportForm } from "./_components/import-form";

export const dynamic = "force-dynamic";
// Large CSV imports run as a server action in this segment; give the
// Vercel function the longer window.
export const maxDuration = 300;

export const metadata = { title: "Import Leads" };

export default async function ImportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: batches } = await admin
    .from("import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<ImportBatchRow[]>();

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-4xl text-white">
          Import Leads<span className="text-[var(--red)]">.</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--silver)]">
          Paste or upload a CSV with a header row: name (or first_name and
          last_name), phone, email. Every row needs a name plus a phone or an
          email.
        </p>
      </div>

      <ImportForm />

      {/* Recent import history */}
      <div className="rounded border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)] mb-3">
          Recent Imports
        </div>
        {!batches || batches.length === 0 ? (
          <div className="text-sm text-[var(--silver-muted)]">
            No imports yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead className="text-[10px] uppercase tracking-[0.20em] text-[var(--silver-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-3 py-2.5 text-left">When</th>
                  <th className="px-3 py-2.5 text-left">File</th>
                  <th className="px-3 py-2.5 text-right">Rows</th>
                  <th className="px-3 py-2.5 text-right">Added</th>
                  <th className="px-3 py-2.5 text-right">Duplicates</th>
                  <th className="px-3 py-2.5 text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2 text-[var(--silver)] whitespace-nowrap">
                      {timeAgo(b.created_at)}
                    </td>
                    <td className="px-3 py-2 text-white truncate max-w-[200px]">
                      {b.filename ?? "pasted text"}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--silver)]">
                      {b.total_rows ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right text-white">
                      {b.added ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--silver)]">
                      {b.duplicates ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--silver)]">
                      {b.failed ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
