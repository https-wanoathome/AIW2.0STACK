"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, ListChecks, RotateCcw } from "lucide-react";
import { parseImport, runImport } from "../actions";
import type { ImportCounts, ImportPreview } from "../types";

const PREVIEW_DISPLAY_LIMIT = 50;

/**
 * Client side of the import flow: paste or upload CSV text, preview
 * the parsed rows, then confirm to push them into the queue.
 */
export function ImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rawText, setRawText] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isParsing, startParse] = useTransition();
  const [isImporting, startImport] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(typeof reader.result === "string" ? reader.result : "");
      setFilename(file.name);
      setPreview(null);
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleParse() {
    setError(null);
    setResult(null);
    startParse(async () => {
      const res = await parseImport(rawText);
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        return;
      }
      setPreview(res.data);
    });
  }

  function handleImport() {
    if (!preview || preview.rows.length === 0) return;
    setError(null);
    startImport(async () => {
      const res = await runImport(preview.rows, filename);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      setPreview(null);
      setRawText("");
      setFilename(null);
      router.refresh();
    });
  }

  function handleReset() {
    setRawText("");
    setFilename(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      {/* Input card */}
      <div className="rounded border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)]">
            CSV Input
          </div>
          {filename && (
            <div className="text-xs font-mono text-[var(--silver)] truncate">
              {filename}
            </div>
          )}
        </div>

        <textarea
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            setPreview(null);
            setResult(null);
            setError(null);
          }}
          placeholder={"name,phone,email\nJane Smith,(555) 201-7788,jane@example.com"}
          rows={8}
          spellCheck={false}
          className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-mono text-white placeholder:text-[var(--silver-muted)] focus:border-[var(--border-strong)] resize-y"
        />

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded border border-[var(--border-strong)] text-sm text-[var(--silver)] hover:text-white hover:bg-[var(--card-elevated)] transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload .csv
          </button>
          <button
            type="button"
            onClick={handleParse}
            disabled={isParsing || !rawText.trim()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ListChecks className="h-4 w-4" />
            {isParsing ? "Parsing..." : "Preview"}
          </button>
        </div>

        {error && (
          <div className="text-xs text-[var(--red)] font-mono">{error}</div>
        )}
      </div>

      {/* Result banner */}
      {result && (
        <div className="rounded border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)] mb-2">
            Import Complete
          </div>
          <div className="text-sm text-white font-mono">
            {result.added} added to queue, {result.duplicates} duplicate
            {result.duplicates === 1 ? "" : "s"} skipped, {result.failed} failed
            (of {result.total} rows).
          </div>
        </div>
      )}

      {/* Preview card */}
      {preview && (
        <div className="rounded border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)]">
              Preview: {preview.rows.length} valid row
              {preview.rows.length === 1 ? "" : "s"}
              {preview.errors.length > 0 &&
                `, ${preview.errors.length} with problems`}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--border-strong)] text-xs text-[var(--silver)] hover:text-white hover:bg-[var(--card-elevated)] transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Start over
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting || preview.rows.length === 0}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isImporting
                  ? "Importing..."
                  : `Add ${preview.rows.length} to Queue`}
              </button>
            </div>
          </div>

          {isImporting && (
            <div className="text-xs text-[var(--silver)] font-mono">
              Pushing rows to GHL and the queue. Large batches take a minute.
              Keep this tab open.
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="rounded border border-[var(--border)] bg-[var(--background)]/40 p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--red)]">
                Skipped rows
              </div>
              {preview.errors.map((err) => (
                <div
                  key={`${err.line}-${err.message}`}
                  className="text-xs font-mono text-[var(--silver)]"
                >
                  Line {err.line}: {err.message}
                </div>
              ))}
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead className="text-[10px] uppercase tracking-[0.20em] text-[var(--silver-muted)] border-b border-[var(--border)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Name</th>
                    <th className="px-3 py-2.5 text-left">Phone</th>
                    <th className="px-3 py-2.5 text-left">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, PREVIEW_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={i} className="border-b border-[var(--border)]">
                      <td className="px-3 py-2 text-white">{row.name}</td>
                      <td className="px-3 py-2 text-[var(--silver)]">
                        {row.phone ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-[var(--silver)]">
                        {row.email ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > PREVIEW_DISPLAY_LIMIT && (
                <div className="px-3 py-2 text-xs text-[var(--silver-muted)] font-mono">
                  and {preview.rows.length - PREVIEW_DISPLAY_LIMIT} more rows
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
