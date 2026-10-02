"use client";

import { useState } from "react";
import type { ReplySettings } from "@/lib/reply/settings";
import type { ReplyContext, ReplySpeed } from "@/lib/reply/types";

const CONTEXTS: Array<{ value: ReplyContext; label: string }> = [
  { value: "work", label: "💼 Công việc" },
  { value: "casual", label: "☕ Thân mật" },
];

const SPEEDS: Array<{ value: ReplySpeed; label: string; hint: string }> = [
  { value: "auto", label: "Tự động", hint: "Tự chọn mô hình giúp bạn" },
  { value: "fast", label: "⚡ Nhanh", hint: "Trả lời nhanh nhất" },
  { value: "smart", label: "🎯 Kỹ lưỡng", hint: "Chậm hơn nhưng cẩn thận hơn" },
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
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div role="group" aria-label="Ngữ cảnh" className="flex gap-1.5">
          {CONTEXTS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={settings.context === option.value}
              onClick={() => onChange({ context: option.value })}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition disabled:opacity-60 ${
                settings.context === option.value ? ACTIVE : IDLE
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Tốc độ mô hình" className="flex gap-1.5">
          {SPEEDS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              title={option.hint}
              aria-pressed={settings.speed === option.value}
              onClick={() => onChange({ speed: option.value })}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition disabled:opacity-60 ${
                settings.speed === option.value ? ACTIVE : IDLE
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((open) => !open)}
          className="whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] text-stone-500 transition hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700"
        >
          ⚙ Tùy chọn {optionsOpen ? "▴" : "▾"}
        </button>
      </div>

      {/* Closed, the switches stay in the page but are hidden from view and from assistive tech. */}
      <div className={optionsOpen ? "flex flex-wrap gap-x-4 gap-y-1.5" : "hidden"}>
        <Toggle
          label="Ghi nhớ để học"
          checked={settings.learn}
          hint="Lưu lượt này để giúp các bản trả lời sau, và cho phép app gợi ý ghi chú từ những gì bạn gõ (thêm một lần gọi mô hình nhỏ)"
          onChange={(learn) => onChange({ learn })}
        />
        <Toggle
          label="Dùng trí nhớ"
          checked={settings.useMemory}
          hint="Dùng lại những bản trả lời bạn từng thích hoặc đã sửa làm ví dụ"
          onChange={(useMemory) => onChange({ useMemory })}
        />
        <Toggle
          label="Dùng ghi chú của tôi"
          checked={settings.useNotes}
          hint="Dùng những gì bạn lưu ở trang Về tôi: ghi chú đã ghim và ghi chú hợp với tin nhắn đã dán"
          onChange={(useNotes) => onChange({ useNotes })}
        />
        {showExplain && (
          <Toggle
            label="Giải thích bằng tiếng Việt"
            checked={settings.explain}
            hint="Dịch tin nhắn của họ và giải thích giọng điệu (thêm một lần gọi mô hình nhỏ)"
            onChange={(explain) => onChange({ explain })}
          />
        )}
      </div>
    </div>
  );
}
