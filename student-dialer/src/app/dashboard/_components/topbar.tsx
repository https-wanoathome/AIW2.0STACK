import { SearchBox } from "./search-box";

/**
 * Top bar above the main content. Holds the global contact search.
 * Utility actions can be added on the right later (Export, Invite,
 * etc), keeping it minimal for now.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="px-6 h-14 flex items-center gap-4">
        <SearchBox />
      </div>
    </header>
  );
}
