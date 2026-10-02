import type { Metadata } from "next";
import StyleProfilePanel from "@/components/reply/StyleProfilePanel";

export const metadata: Metadata = { title: "Style profile — Reply Assistant" };

export default function StyleProfilePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 font-serif text-3xl tracking-tight text-stone-900 dark:text-stone-100">Style profile</h1>
      <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
        A short list of voice rules the assistant learns from the replies you edit and rate. Build one, read it, and switch it on
        if it sounds like you.
      </p>
      <section aria-label="How it works" className="mb-6 space-y-1 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
        <h2 className="font-semibold text-stone-800 dark:text-stone-100">How it works</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>What it is:</strong> a few lines about your wording (short sentences, contractions, how direct you are). When one
            is switched on, its rules go in front of every request, whatever you write.
          </li>
          <li>
            <strong>Where the rules come from:</strong> replies you edited, liked or disliked, and replies you asked to develop. It
            never reads the messages other people sent you, and it does not learn from requests made with Learn off.
          </li>
          <li>
            <strong>How to use it:</strong> build a version (one model call, at least 5 edited or rated replies), read every rule,
            reword or delete the ones that do not sound like you, then switch it on. A new version is always off until you do. You
            can switch it off at any time.
          </li>
        </ul>
      </section>
      <StyleProfilePanel />
    </main>
  );
}
