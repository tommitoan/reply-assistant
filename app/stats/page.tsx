import type { Metadata } from "next";
import StatsView from "@/components/reply/StatsView";
import { getDb } from "@/lib/reply/db";
import { toStatsView } from "@/lib/reply/stats";
import { createStatsRepo } from "@/lib/reply/stats-repo";

export const metadata: Metadata = { title: "Thống kê — Reply Assistant" };
// The figures change with every request.
export const dynamic = "force-dynamic";

export default async function ReplyStatsPage() {
  let stats;
  try {
    stats = toStatsView(await createStatsRepo(getDb()).load());
  } catch (err) {
    console.error("[/stats]", err);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-100">Thống kê</h1>
        <a
          href="/api/reply/export"
          download
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          ⬇ Xuất ví dụ (JSONL)
        </a>
      </div>
      {stats ? (
        <StatsView stats={stats} />
      ) : (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Không tải được thống kê. Kiểm tra kết nối cơ sở dữ liệu rồi thử lại.
        </p>
      )}
    </main>
  );
}
