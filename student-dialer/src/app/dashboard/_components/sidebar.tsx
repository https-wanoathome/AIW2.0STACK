"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, BarChart3, Lightbulb, Upload } from "lucide-react";
import { SignOutButton } from "./sign-out-button";
import type { Profile } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard/dial", label: "Dial", icon: Phone },
  { href: "/dashboard/stats", label: "Stats", icon: BarChart3 },
  { href: "/dashboard/insights", label: "Insights", icon: Lightbulb },
  { href: "/dashboard/import", label: "Import Leads", icon: Upload },
];

/**
 * Left rail navigation for the dashboard. Persistent across all routes,
 * shows the brand mark at the top, nav items in the middle, and user
 * identity + sign-out at the bottom.
 *
 * Inspired by the Esseles dashboard reference: icon + label items with
 * a lifted background on the active row.
 */
export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden lg:flex w-60 flex-col border-r border-[var(--border)] bg-[var(--card)] px-3 py-5">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-3 py-1 mb-8 group"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] animate-pulse shrink-0" />
        <span className="font-display text-xl text-white group-hover:text-[var(--silver)] transition-colors leading-none">
          Student Dialer
          <span className="text-[var(--red)]">.</span>
        </span>
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            pathname.startsWith(`${item.href}/`) ||
            pathname.startsWith(`${item.href}?`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors ${
                active
                  ? "bg-[var(--card-elevated)] text-white"
                  : "text-[var(--silver)] hover:text-white hover:bg-[var(--card-elevated)]/60"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User card pinned at the bottom */}
      <div className="mt-4 px-3 py-3 rounded border border-[var(--border)] bg-[var(--background)]/40">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)] mb-1">
          Student
        </div>
        <div className="text-sm text-white truncate mb-3">
          {profile.full_name || "Student"}
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
