// Says what a pasted conversation did to the thread, so a wrong merge is
// noticed right away.
export default function ThreadNotice({ added, skipped }: { added: number; skipped: number }) {
  const message =
    added > 0
      ? `Added ${added} new ${added === 1 ? "message" : "messages"} to the conversation${
          skipped > 0 ? ` (${skipped} already there)` : ""
        }.`
      : "Nothing new in that paste: it is already in the conversation.";
  return (
    <p role="status" className="text-xs text-stone-500 dark:text-stone-400">
      {message}
    </p>
  );
}
