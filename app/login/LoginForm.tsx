"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null };

export default function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, formAction, pending] = useActionState(login, INITIAL_STATE);
  const error = configured ? state.error : "Máy chủ này chưa được cấu hình đăng nhập.";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label
          htmlFor="passcode"
          className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          Mật khẩu
        </label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          disabled={!configured || pending}
          className="w-full rounded-xl border border-stone-300 bg-white p-3 text-[15px] text-stone-800 shadow-sm outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-200 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:focus:border-accent-500 dark:focus:ring-accent-900"
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
        className="w-full rounded-xl bg-accent-600 px-6 py-3 font-medium text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Đang kiểm tra…" : "Đăng nhập"}
      </button>
    </form>
  );
}
