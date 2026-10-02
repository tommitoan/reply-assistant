import type { Metadata } from "next";
import UsageView from "@/components/reply/UsageView";
import { getDb } from "@/lib/reply/db";
import { toUsageView } from "@/lib/reply/usage-report";
import { createUsageRepo } from "@/lib/reply/usage-repo";

export const metadata: Metadata = { title: "Chi phí — Reply Assistant" };
// The figures change with every request.
export const dynamic = "force-dynamic";

export default async function ReplyUsagePage() {
  const now = new Date();
  let usage;
  try {
    usage = toUsageView(await createUsageRepo(getDb()).load(now), now);
  } catch (err) {
    console.error("[/usage]", err);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-100">Chi phí</h1>
      {usage ? (
        <UsageView usage={usage} />
      ) : (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Không tải được số liệu chi phí. Kiểm tra kết nối cơ sở dữ liệu rồi thử lại.
        </p>
      )}
    </main>
  );
}
