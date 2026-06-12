"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, BarChart3, Lightbulb, Upload, Menu, X } from "lucide-react";
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
 * Mobile-only hamburger trigger that opens a fullscreen overlay nav.
 * Shows on small screens where the desktop sidebar is hidden.
 */
export function MobileNav({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded border border-[var(--border)] text-[var(--silver)] hover:text-white hover:border-[var(--border-strong)] transition-colors"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/80 backdrop-blur lg:hidden">
          <div className="flex flex-col h-full w-full max-w-xs bg-[var(--card)] border-r border-[var(--border)] px-3 py-5">
            <div className="flex items-center justify-between px-3 mb-8">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="font-display text-xl text-white"
              >
                Student Dialer
                <span className="text-[var(--red)]">.</span>
              </Link>
              <button
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center h-8 w-8 rounded text-[var(--silver)] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

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
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors ${
                      active
                        ? "bg-[var(--card-elevated)] text-white"
                        : "text-[var(--silver)] hover:text-white hover:bg-[var(--card-elevated)]/60"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 px-3 py-3 rounded border border-[var(--border)] bg-[var(--background)]/40">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--silver-muted)] mb-1">
                Student
              </div>
              <div className="text-sm text-white truncate mb-3">
                {profile.full_name || "Student"}
              </div>
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
