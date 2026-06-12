"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

type FormState = { error: string | null };

const initialState: FormState = { error: null };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    signIn,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label
          htmlFor="email"
          className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          className="w-full px-3 py-2.5 bg-[var(--card)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none transition-colors"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs uppercase tracking-[0.16em] text-[var(--silver)] mb-2"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full px-3 py-2.5 bg-[var(--card)] border border-[var(--border)] rounded text-white text-sm focus:border-[var(--border-strong)] focus:outline-none transition-colors"
        />
      </div>

      {state.error && (
        <p className="text-sm text-[var(--red)] py-2 border-l-2 border-[var(--red)] pl-3 bg-[var(--red)]/5">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
