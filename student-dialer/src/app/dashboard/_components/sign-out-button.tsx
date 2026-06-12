import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        title="Sign out"
        className="p-2 text-[var(--silver-muted)] hover:text-[var(--red)] transition-colors"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );
}
