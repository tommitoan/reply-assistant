import type { Metadata } from "next";
import Link from "next/link";
import UsageView from "@/components/reply/UsageView";
import { getDb } from "@/lib/reply/db";
import { toUsageView } from "@/lib/reply/usage-report";
import { createUsageRepo } from "@/lib/reply/usage-repo";

export const metadata: Metadata = { title: "Reply usage — Reply Assistant" };
// The figures change with every request.
export const dynamic = "force-dynamic";

export default async function ReplyUsagePage() {
  const now = new Date();
  let usage;
  try {
    usage = toUsageView(await createUsageRepo(getDb()).load(now), now);
  } catch (err) {
    console.error("[/reply/usage]", err);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-4 text-sm">
        <Link href="/reply" className="text-stone-500 hover:underline dark:text-stone-400">
          ← Reply Assistant
        </Link>
      </nav>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">💰 Reply usage</h1>
      {usage ? (
        <UsageView usage={usage} />
      ) : (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not load the usage. Check the database connection and try again.
        </p>
      )}
    </main>
  );
}
