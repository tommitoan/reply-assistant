"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null };

export default function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, formAction, pending] = useActionState(login, INITIAL_STATE);
  const error = configured ? state.error : "Login is not configured on this server.";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label
          htmlFor="passcode"
          className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          Passcode
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          disabled={!configured || pending}
          className="w-full rounded-xl border border-stone-300 bg-white p-3 text-[15px] text-stone-800 shadow-sm outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-200 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:focus:border-stone-500 dark:focus:ring-stone-700"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!configured || pending}
        className="w-full rounded-xl bg-stone-900 px-6 py-3 font-medium text-white shadow-sm transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
