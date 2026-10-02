import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/next-path";
import { isAuthConfigured } from "@/lib/reply/env";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — Reply Assistant" };

// Reads env at request time so the "not configured" notice reflects the
// running server, not the build.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <p aria-hidden="true" className="text-center text-4xl text-accent-600 dark:text-accent-500">
        ✻
      </p>
      <h1 className="mt-3 text-center font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-50">Reply Assistant</h1>
      <p className="mb-8 mt-2 text-center text-sm text-stone-500 dark:text-stone-400">Enter the passcode to continue.</p>
      <LoginForm next={safeNextPath(next)} configured={isAuthConfigured()} />
    </main>
  );
}
