"use client";

import { useEffect, useState } from "react";
import type { LoadedOption } from "@/lib/reply/feedback-state";
import type { RecentGeneration } from "@/lib/reply/types";
import { relativeTime } from "./relativeTime";

const INPUT_PREVIEW_CHARS = 90;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > INPUT_PREVIEW_CHARS ? `${flat.slice(0, INPUT_PREVIEW_CHARS)}…` : flat;
}

// What the feedback store needs to know about earlier replies so they can be
// rated, edited or marked as used.
export function feedbackRowsOf(generations: RecentGeneration[]): LoadedOption[] {
  return generations.flatMap((generation) => [
    ...generation.options.map((option) => ({
      id: option.id,
      generationId: generation.id,
      rating: option.rating,
      editedText: option.editedText,
      chosen: option.chosen,
    })),
    // Developed versions answer the same turn as the reply they grew from.
    ...generation.developed.flatMap((group) =>
      group.options.map((option) => ({
        id: option.id,
        generationId: group.generationId,
        familyId: generation.id,
        rating: option.rating,
        editedText: option.editedText,
        chosen: option.chosen,
      })),
    ),
  ]);
}

// The earlier requests of the open conversation (or of Quick translate), as a
// short list in the side bar. Picking one hands it to the chat to show.
export default function RecentGenerations({
  scope,
  refreshKey,
  activeId,
  onOpen,
}: {
  // "none" for requests made outside any thread, or one thread's id.
  scope: string;
  // Changing this reloads the list (a new generation just finished).
  refreshKey: string | null;
  // The request being shown from the list, if any.
  activeId: string | null;
  onOpen: (generation: RecentGeneration) => void;
}) {
  const [generations, setGenerations] = useState<RecentGeneration[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reply/generations?limit=10&conversation=${scope}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { generations: RecentGeneration[] };
        if (cancelled) return;
        setGenerations(body.generations);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, refreshKey]);

  if (failed && generations === null) {
    return <p className="px-3 text-xs text-stone-400 dark:text-stone-500">Không tải được các bản trả lời gần đây.</p>;
  }
  if (!generations || generations.length === 0) return null;

  return (
    <section aria-label="Gần đây" className="space-y-1">
      <h2 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">Gần đây</h2>
      {generations.map((generation) => (
        <button
          key={generation.id}
          type="button"
          onClick={() => onOpen(generation)}
          aria-current={activeId === generation.id ? "true" : undefined}
          title={generation.inputText}
          className={`block w-full rounded-xl px-3 py-2 text-left transition ${
            activeId === generation.id
              ? "bg-stone-200/70 text-stone-900 dark:bg-stone-800 dark:text-stone-50"
              : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/70"
          }`}
        >
          <span className="line-clamp-2 text-[13px] font-medium">{preview(generation.inputText)}</span>
          <span className="mt-0.5 block text-[11px] opacity-70">
            {generation.context === "work" ? "💼" : "☕"} · {relativeTime(generation.createdAt)}
          </span>
        </button>
      ))}
    </section>
  );
}
