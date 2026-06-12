"use client";

import {
  useState,
  useEffect,
  useRef,
  useTransition,
  type KeyboardEvent,
} from "react";
import { Search, X, Loader2, ExternalLink } from "lucide-react";
import {
  searchContactsAction,
  type ContactSearchResult,
} from "../_actions/search-contacts";

/**
 * Top-bar contact search.
 *
 * - Debounced input (250ms): avoids hammering GHL on every keystroke.
 * - Minimum 2 chars before a search fires.
 * - Dropdown shows up to 8 matches: name + email + phone.
 * - Click a result -> opens the GHL contact in a new tab.
 * - Escape closes the dropdown; outside-click closes too.
 * - Up/Down arrows navigate, Enter opens the highlighted result.
 */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [isPending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query and run the server action. Queries under 2 chars
  // are cleared in handleChange (not here) so the effect never calls
  // setState synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchContactsAction(q);
        if (res.ok) {
          setResults(res.results);
          setErrorMsg(null);
          setOpen(true);
          setHighlight(0);
        } else {
          setResults([]);
          setErrorMsg(res.error);
          setOpen(true);
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Outside click + Escape close the dropdown.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[highlight];
      if (r) {
        window.open(r.ghl_url, "_blank", "noopener,noreferrer");
        setOpen(false);
        inputRef.current?.blur();
      }
    }
  }

  function handleChange(next: string) {
    setQuery(next);
    if (next.trim().length < 2) {
      setResults([]);
      setErrorMsg(null);
    }
  }

  function clear() {
    setQuery("");
    setResults([]);
    setErrorMsg(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--silver-muted)] pointer-events-none"
        strokeWidth={1.75}
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Search contacts..."
        className="w-full pl-9 pr-9 py-2 bg-[var(--card)] border border-[var(--border)] rounded text-sm text-white placeholder:text-[var(--silver-muted)] focus:outline-none focus:border-[var(--border-strong)]"
        autoComplete="off"
        spellCheck={false}
      />
      {(isPending || query) && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded text-[var(--silver-muted)] hover:text-white hover:bg-[var(--card-elevated)]"
          aria-label={isPending ? "Searching" : "Clear search"}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>
      )}

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-2 border border-[var(--border)] rounded bg-[var(--card)] shadow-2xl z-30 max-h-80 overflow-y-auto">
          {errorMsg && (
            <div className="px-3 py-2.5 text-xs text-[var(--red)] font-mono">
              {errorMsg}
            </div>
          )}
          {!errorMsg && results.length === 0 && !isPending && (
            <div className="px-3 py-3 text-xs text-[var(--silver-muted)]">
              No contacts matching &quot;{query}&quot;
            </div>
          )}
          {results.map((r, i) => (
            <a
              key={r.id}
              href={r.ghl_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              onMouseEnter={() => setHighlight(i)}
              className={`block px-3 py-2.5 border-b border-[var(--border)]/40 last:border-b-0 transition-colors ${
                i === highlight ? "bg-[var(--card-elevated)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{r.name}</div>
                  <div className="text-xs text-[var(--silver-muted)] font-mono mt-0.5 truncate">
                    {r.email ?? "no email"}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </div>
                </div>
                <ExternalLink
                  className="h-3.5 w-3.5 text-[var(--silver-muted)] shrink-0"
                  strokeWidth={1.75}
                />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
