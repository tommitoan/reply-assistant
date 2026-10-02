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
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Sign in
      </h1>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        Enter the passcode to continue.
      </p>
      <LoginForm next={safeNextPath(next)} configured={isAuthConfigured()} />
    </main>
  );
}
