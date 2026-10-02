import type { NoteKind, NoteScope } from "@/lib/reply/types";

export const BUTTON =
  "rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-700";
export const SMALL =
  "rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700";
export const PRIMARY =
  "rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300";
export const CARD = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-800";
export const FIELD =
  "w-full rounded-lg border border-stone-300 bg-white p-2.5 text-[15px] leading-relaxed text-stone-800 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:ring-stone-700";
export const SELECT =
  "rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200";
export const ERROR =
  "rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400";

export const SCOPE_LABELS: Record<NoteScope, string> = { both: "Work and casual", work: "Work only", casual: "Casual only" };
export const KIND_LABELS: Record<NoteKind, string> = { fact: "Fact (stays true)", event: "Event (happened once)" };

export const PRIVATE_HINT = "Private: stays in this app and is never sent to an AI model, so it is never used in a reply.";
