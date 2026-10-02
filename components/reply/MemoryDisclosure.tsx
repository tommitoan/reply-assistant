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
      return <p className={NOTE}>Memory is not set up on this server, so this request used none.</p>;
    case "skipped":
      return <p className={NOTE}>Memory was skipped for this request. Your replies were written without it.</p>;
    case "none":
      return <p className={NOTE}>No similar earlier replies yet, so memory added nothing.</p>;
    case "used":
      return (
        <details className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-800">
          <summary className="cursor-pointer text-stone-600 dark:text-stone-300">
            Used {memories.length} {memories.length === 1 ? "memory" : "memories"}
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
