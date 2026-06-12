import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.20em] text-[var(--silver)] mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />
            Dialing Dashboard
          </div>
          <h1 className="font-display text-7xl text-white">
            Student Dialer<span className="text-[var(--red)]">.</span>
          </h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
