"use client";

import type { ReplySettings } from "@/lib/reply/settings";
import type { ReplyContext, ReplySpeed } from "@/lib/reply/types";

const CONTEXTS: Array<{ value: ReplyContext; label: string }> = [
  { value: "work", label: "💼 Work" },
  { value: "casual", label: "☕ Casual" },
];

const SPEEDS: Array<{ value: ReplySpeed; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "Picks the model for you" },
  { value: "fast", label: "⚡ Fast", hint: "Quickest answer" },
  { value: "smart", label: "🎯 Smart", hint: "Slower, more careful" },
];

const ACTIVE = "border-accent-300 bg-accent-100 text-accent-900 dark:border-accent-700 dark:bg-accent-900/50 dark:text-accent-100";
const IDLE =
  "border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-stone-600";

function Toggle({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      title={hint}
      className={`flex items-center gap-1.5 text-[13px] text-stone-500 dark:text-stone-400 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent-600 dark:accent-accent-500"
      />
      {label}
    </label>
  );
}

export default function ReplyControls({
  settings,
  onChange,
  disabled,
  showExplain,
}: {
  settings: ReplySettings;
  onChange: (patch: Partial<ReplySettings>) => void;
  disabled?: boolean;
  // Only a pasted message has something to explain.
  showExplain?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label="Context" className="flex gap-1.5">
        {CONTEXTS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={settings.context === option.value}
            onClick={() => onChange({ context: option.value })}
            className={`rounded-full border px-3 py-1 text-[13px] font-medium transition disabled:opacity-60 ${
              settings.context === option.value ? ACTIVE : IDLE
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Model speed" className="flex gap-1.5">
        {SPEEDS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            title={option.hint}
            aria-pressed={settings.speed === option.value}
            onClick={() => onChange({ speed: option.value })}
            className={`rounded-full border px-3 py-1 text-[13px] font-medium transition disabled:opacity-60 ${
              settings.speed === option.value ? ACTIVE : IDLE
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <Toggle
          label="Learn"
          checked={settings.learn}
          hint="Keep this turn so it can help future replies, and let the app suggest notes from what you type (one small extra model call)"
          onChange={(learn) => onChange({ learn })}
        />
        <Toggle
          label="Use memory"
          checked={settings.useMemory}
          hint="Reuse your past good and edited replies as examples"
          onChange={(useMemory) => onChange({ useMemory })}
        />
        <Toggle
          label="Use my notes"
          checked={settings.useNotes}
          hint="Use what you saved on the About me page: pinned notes, and notes that fit a pasted message"
          onChange={(useNotes) => onChange({ useNotes })}
        />
        {showExplain && (
          <Toggle
            label="Explain in Vietnamese"
            checked={settings.explain}
            hint="Translate their message and explain the tone (one extra small model call)"
            onChange={(explain) => onChange({ explain })}
          />
        )}
      </div>
    </div>
  );
}
