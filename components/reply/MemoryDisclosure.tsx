import type { MemoryRef, MemoryStatus } from "@/lib/reply/types";

const NOTE = "text-xs text-stone-400 dark:text-stone-500";

// Says what memory did for one request, so a surprising reply can be traced
// back to the earlier replies it was shaped by.
export default function MemoryDisclosure({
  status,
  memories,
}: {
  status: MemoryStatus;
  memories: MemoryRef[];
}) {
  switch (status) {
    case "off":
      return null;
    case "unavailable":
      return <p className={NOTE}>Server này chưa bật trí nhớ nên lần này không dùng trí nhớ.</p>;
    case "skipped":
      return <p className={NOTE}>Lần này đã bỏ qua trí nhớ, các bản nháp được viết mà không dùng nó.</p>;
    case "none":
      return <p className={NOTE}>Chưa có bản nháp nào tương tự trước đó nên trí nhớ không bổ sung gì.</p>;
    case "used":
      return (
        <details className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-800">
          <summary className="cursor-pointer text-stone-600 dark:text-stone-300">
            Đã dùng {memories.length} mục trí nhớ
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-500 dark:text-stone-400">
            {memories.map((memory) => (
              <li key={memory.id}>{memory.input}</li>
            ))}
          </ul>
        </details>
      );
  }
}
