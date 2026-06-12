import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DashboardHome() {
  // The dial tab is the home screen.
  redirect("/dashboard/dial");
}
