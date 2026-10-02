import type { Metadata } from "next";
import Link from "next/link";
import AboutLink from "@/components/reply/AboutLink";
import ReplyWorkspace from "@/components/reply/ReplyWorkspace";

export const metadata: Metadata = { title: "Reply Assistant" };

export default function ReplyPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        💬 Reply Assistant
      </h1>
      <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
        Type what you want to say in Vietnamese, or paste an English chat and get replies in your own voice. Copy the one you like.
      </p>
      <nav aria-label="Reply tools" className="mb-6 flex flex-wrap gap-4 text-sm">
        <Link href="/reply/style" className="text-stone-600 hover:underline dark:text-stone-300">
          🎨 Style profile
        </Link>
        <AboutLink className="text-stone-600 hover:underline dark:text-stone-300" />
        <Link href="/reply/stats" className="text-stone-600 hover:underline dark:text-stone-300">
          📊 Stats
        </Link>
        <Link href="/reply/usage" className="text-stone-600 hover:underline dark:text-stone-300">
          💰 Usage
        </Link>
        <a href="/api/reply/export" download className="text-stone-600 hover:underline dark:text-stone-300">
          ⬇ Export examples
        </a>
      </nav>
      <ReplyWorkspace />
    </main>
  );
}
