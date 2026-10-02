import type { Metadata } from "next";
import Link from "next/link";
import NotesPanel from "@/components/reply/NotesPanel";

export const metadata: Metadata = { title: "About me — Reply Assistant" };

export default function AboutMePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-4 text-sm">
        <Link href="/reply" className="text-stone-500 hover:underline dark:text-stone-400">
          ← Reply Assistant
        </Link>
      </nav>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">🧑 About me</h1>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        Short notes about your own life: your job, your habits, what happened lately. Each note gets an English version so it can
        be matched to English messages, and replies to a pasted message use the notes that fit. When you type an idea, the app
        may also suggest notes from it; they wait below until you add them. Mark a note 🔒 private and it stays in this app and
        is never sent to an AI model.
      </p>
      <NotesPanel />
    </main>
  );
}
