// What the other person's message means, in Vietnamese: a translation and a note
// on tone. Shown above the reply options; `text` is null while it is on its way.
export default function ExplainBox({ text }: { text: string | null }) {
  return (
    <section
      aria-label="Họ đang nói gì"
      className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950"
    >
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">
        Họ đang nói gì
      </h2>
      {text ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-sky-950 dark:text-sky-100">{text}</p>
      ) : (
        <p className="text-sm text-sky-700 dark:text-sky-300">Đang dịch tin nhắn của họ…</p>
      )}
    </section>
  );
}
