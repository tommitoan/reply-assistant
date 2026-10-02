"use client";

import { useId, useRef, useState } from "react";
import { EMPTY_FEEDBACK } from "@/lib/reply/feedback-state";
import { MAX_INSTRUCTION_CHARS } from "@/lib/reply/limits";
import { storedDirection } from "@/lib/reply/refine-directions";
import {
  REFINE_PRESETS,
  type DevelopedGroup,
  type NoteRef,
  type RefinePreset,
  type ReplyOptionView,
  type ReplySpeed,
} from "@/lib/reply/types";
import ReplyOptionCard, { ACTIVE_BUTTON, SMALL_BUTTON } from "./ReplyOptionCard";
import { actionsFor } from "./optionActions";
import type { OptionFeedbackStore } from "./useOptionFeedback";
import { useReplyStream } from "./useReplyStream";

const PRESET_LABELS: Record<RefinePreset, string> = {
  longer: "Longer",
  ask_back: "Ask something back",
  personal_detail: "Add a personal detail",
  casual: "More casual",
};

const DEVELOPED_LABELS = { long: "Developed", alt: "Developed · another way" } as const;

const developedLabel = (variant: string): string =>
  variant === "alt" ? DEVELOPED_LABELS.alt : DEVELOPED_LABELS.long;

export interface DevelopSettings {
  speed: ReplySpeed;
  learn: boolean;
}

// One option with a Develop button. The panel under it asks for a direction;
// the two developed versions appear below the option and the option itself
// stays as it was.
export default function DevelopableOption({
  option,
  store,
  settings,
  developed = [],
  suggestions = [],
}: {
  option: ReplyOptionView & { generationId: string };
  store: OptionFeedbackStore;
  settings: DevelopSettings;
  // Developed versions saved earlier (from a reload or the recent list).
  developed?: DevelopedGroup[];
  // Notes of the writer's that fit a typed idea. One click adds one to this reply.
  suggestions?: NoteRef[];
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [preset, setPreset] = useState<RefinePreset | null>(null);
  // Versions made in this session; the saved ones come in as `developed`.
  const [runs, setRuns] = useState<DevelopedGroup[]>([]);
  const direction = useRef("");
  // Notes already added to this reply from the suggestions.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const fieldId = useId();
  const { load } = store;

  const { state, start, cancel } = useReplyStream({
    onDone: (event, generationId) => {
      // They belong to the same turn as the option they grew from, so choosing
      // one of them un-chooses the others.
      load(
        event.options.map((created) => ({
          id: created.id,
          generationId,
          familyId: option.generationId,
          ...EMPTY_FEEDBACK,
        })),
      );
      setRuns((current) => [
        ...current,
        {
          generationId,
          ofOptionId: option.id,
          instruction: direction.current,
          createdAt: new Date().toISOString(),
          options: event.options.map((created) => ({
            ...created,
            generationId,
            ...EMPTY_FEEDBACK,
          })),
        },
      ]);
      setInstruction("");
      setPreset(null);
    },
  });

  const streaming = state.status === "streaming";
  const trimmed = instruction.trim();
  const needsDetail = preset === "personal_detail" && trimmed.length === 0;
  const canSubmit = !streaming && (trimmed.length > 0 || preset !== null) && !needsDetail;

  function submit() {
    if (!canSubmit) return;
    direction.current = storedDirection(preset ?? undefined, trimmed || undefined);
    void start({
      refine: {
        optionId: option.id,
        ...(trimmed ? { instruction: trimmed } : {}),
        ...(preset ? { preset } : {}),
      },
      speed: settings.speed,
      learn: settings.learn,
    });
  }

  // Develops the reply with a saved note: the detail is the note's, never invented.
  function addNote(note: NoteRef) {
    if (streaming) return;
    direction.current = storedDirection("personal_detail", note.text);
    setAdded((current) => new Set(current).add(note.id));
    void start({
      refine: { optionId: option.id, noteId: note.id },
      speed: settings.speed,
      learn: settings.learn,
    });
  }

  // Saved groups and this session's, without showing one twice after a reload.
  const seen = new Set<string>();
  const groups = [...developed, ...runs].filter((group) => {
    if (seen.has(group.generationId)) return false;
    seen.add(group.generationId);
    return true;
  });

  return (
    <div className="space-y-2">
      <ReplyOptionCard
        variant={option.variant}
        text={option.text}
        actions={actionsFor(store, option.id)}
        extraAction={
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Develop this reply"
            className={`${SMALL_BUTTON} ${open ? ACTIVE_BUTTON : ""}`}
          >
            🌱 Phát triển
          </button>
        }
      />

      {suggestions.length > 0 && (
        <div role="group" aria-label="Notes you could add" className="flex flex-wrap items-center gap-2 pl-1">
          <span className="text-xs text-stone-500 dark:text-stone-400">💡 Add:</span>
          {suggestions.map((note) => (
            <button
              key={note.id}
              type="button"
              disabled={streaming}
              aria-label={`Add this note: ${note.text}`}
              title={note.text}
              onClick={() => addNote(note)}
              className={`${SMALL_BUTTON} max-w-full truncate ${added.has(note.id) ? "opacity-60" : ""}`}
            >
              {added.has(note.id) ? "✓ " : ""}
              {note.text}
            </button>
          ))}
        </div>
      )}

      {open && (
        <section
          aria-label="Develop this reply"
          className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900"
        >
          <div>
            <label htmlFor={fieldId} className="sr-only">
              How to develop this reply, in Vietnamese
            </label>
            <textarea
              id={fieldId}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              maxLength={MAX_INSTRUCTION_CHARS}
              rows={2}
              placeholder="Phát triển theo hướng nào? Ví dụ: thêm là mình cũng mới dọn nhà, hỏi họ ở tầng mấy"
              className="w-full resize-y rounded-lg border border-stone-300 bg-white p-3 text-[15px] leading-relaxed text-stone-800 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:focus:ring-accent-900"
            />
          </div>

          <div role="group" aria-label="Quick directions" className="flex flex-wrap gap-2">
            {REFINE_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={streaming}
                aria-pressed={preset === value}
                onClick={() => setPreset((current) => (current === value ? null : value))}
                className={`${SMALL_BUTTON} ${preset === value ? ACTIVE_BUTTON : ""}`}
              >
                {PRESET_LABELS[value]}
              </button>
            ))}
          </div>

          {needsDetail && (
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Write the detail to add, in the box above. It is never invented for you.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={`${SMALL_BUTTON} ${ACTIVE_BUTTON}`}
            >
              {streaming ? "Developing…" : "Develop"}
            </button>
            {streaming && (
              <button type="button" onClick={cancel} className={SMALL_BUTTON}>
                Stop
              </button>
            )}
          </div>

          {state.error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            >
              {state.error.message}
            </p>
          )}
        </section>
      )}

      {(groups.length > 0 || streaming) && (
        <div className="space-y-3 border-l-2 border-stone-200 pl-3 dark:border-stone-700">
          {groups.map((group) => (
            <div key={group.generationId} className="space-y-2">
              {group.instruction && (
                <p className="text-xs text-stone-500 dark:text-stone-400">🌱 {group.instruction}</p>
              )}
              {group.options.map((created) => (
                <ReplyOptionCard
                  key={created.id}
                  variant={created.variant}
                  text={created.text}
                  label={developedLabel(created.variant)}
                  actions={actionsFor(store, created.id)}
                />
              ))}
            </div>
          ))}
          {streaming &&
            state.options.map((draft, index) => (
              <ReplyOptionCard
                key={`draft-${index}`}
                variant={draft.variant}
                text={draft.text}
                label={developedLabel(draft.variant)}
                streaming={index === state.options.length - 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}
