"use client";

import { useEffect, useState } from "react";
import type { RecentGeneration } from "@/lib/reply/types";
import { shortModelName } from "@/lib/reply/format";
import DevelopableOption, { type DevelopSettings } from "./DevelopableOption";
import ReplyOptionCard from "./ReplyOptionCard";
import { actionsFor } from "./optionActions";
import type { OptionFeedbackStore } from "./useOptionFeedback";

const INPUT_PREVIEW_CHARS = 80;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > INPUT_PREVIEW_CHARS ? `${flat.slice(0, INPUT_PREVIEW_CHARS)}…` : flat;
}

// Earlier replies, so they can be rated, edited or marked as used after the
// page was closed or the next request started.
export default function RecentGenerations({
  scope,
  refreshKey,
  excludeId,
  store,
  develop,
}: {
  // "none" for requests made outside any thread, or one thread's id.
  scope: string;
  // Changing this reloads the list (a new generation just finished).
  refreshKey: string | null;
  // The generation already shown above, so it is not listed twice.
  excludeId: string | null;
  store: OptionFeedbackStore;
  // When given, each reply gets a Develop button that uses these settings.
  develop?: DevelopSettings;
}) {
  const [generations, setGenerations] = useState<RecentGeneration[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { load } = store;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reply/generations?limit=10&conversation=${scope}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { generations: RecentGeneration[] };
        if (cancelled) return;
        setGenerations(body.generations);
        setFailed(false);
        load(
          body.generations.flatMap((generation) => [
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
          ]),
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, refreshKey, load]);

  const visible = (generations ?? []).filter((generation) => generation.id !== excludeId);

  if (failed && generations === null) {
    return <p className="text-xs text-stone-400 dark:text-stone-500">Could not load recent replies.</p>;
  }
  if (visible.length === 0) return null;

  return (
    <section aria-label="Recent replies" className="space-y-2">
      <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Recent replies</h2>
      {visible.map((generation) => (
        <details
          key={generation.id}
          className="rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-800"
        >
          <summary className="cursor-pointer p-3 text-sm text-stone-600 dark:text-stone-300">
            <span className="font-medium">{preview(generation.inputText)}</span>
            <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
              {generation.context} · {shortModelName(generation.model)} ·{" "}
              {new Date(generation.createdAt).toLocaleString()}
            </span>
          </summary>
          <div className="space-y-3 p-3 pt-0">
            {generation.options.map((option) =>
              develop ? (
                <DevelopableOption
                  key={option.id}
                  option={{ id: option.id, generationId: generation.id, variant: option.variant, text: option.text }}
                  store={store}
                  settings={develop}
                  developed={generation.developed.filter((group) => group.ofOptionId === option.id)}
                />
              ) : (
                <ReplyOptionCard
                  key={option.id}
                  variant={option.variant}
                  text={option.text}
                  actions={actionsFor(store, option.id)}
                />
              ),
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
