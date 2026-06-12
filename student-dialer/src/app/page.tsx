import { redirect } from "next/navigation";

export default function Home() {
  // Root redirects to /dashboard. The middleware will bounce to /login
  // if there's no active session.
  redirect("/dashboard");
}
