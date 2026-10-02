// Says what a pasted conversation did to the thread, so a wrong merge is
// noticed right away.
export default function ThreadNotice({ added, skipped }: { added: number; skipped: number }) {
  const message =
    added > 0
      ? `Đã thêm ${added} tin nhắn mới vào cuộc trò chuyện${
          skipped > 0 ? ` (${skipped} tin đã có sẵn)` : ""
        }.`
      : "Phần vừa dán không có gì mới: tất cả đã có trong cuộc trò chuyện.";
  return (
    <p role="status" className="text-xs text-stone-500 dark:text-stone-400">
      {message}
    </p>
  );
}
