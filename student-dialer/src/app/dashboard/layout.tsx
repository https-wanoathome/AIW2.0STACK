import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "./_components/sidebar";
import { TopBar } from "./_components/topbar";
import { MobileNav } from "./_components/mobile-nav";
import type { Profile } from "@/lib/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) {
    // Trigger should have created this. If missing, sign out and recover.
    await supabase.auth.signOut();
    redirect("/login?error=missing-profile");
  }

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar: fixed-position, hidden under lg breakpoint */}
      <Sidebar profile={profile} />

      {/* Main column. lg:ml-60 offsets the fixed sidebar's width on
          desktop so content doesn't slide under it. */}
      <div className="flex-1 flex flex-col lg:ml-60 min-w-0">
        {/* Mobile-only header strip with hamburger trigger + brand */}
        <div className="lg:hidden sticky top-0 z-10 flex items-center gap-3 px-6 h-14 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
          <MobileNav profile={profile} />
          <div className="font-display text-lg text-white">
            Student Dialer<span className="text-[var(--red)]">.</span>
          </div>
        </div>

        {/* Desktop top bar: search + utility actions */}
        <TopBar />

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
