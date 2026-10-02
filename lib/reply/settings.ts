import type { ReplyContext, ReplySpeed } from "./types";

export const SETTINGS_KEY = "reply.settings.v1";

export interface ReplySettings {
  context: ReplyContext;
  speed: ReplySpeed;
  learn: boolean;
  useMemory: boolean;
  // Use the writer's notes (About me) in replies and as suggestions.
  useNotes: boolean;
  // For a pasted message: also explain it in Vietnamese.
  explain: boolean;
}

export const DEFAULT_SETTINGS: ReplySettings = {
  context: "work",
  speed: "auto",
  learn: true,
  useMemory: false,
  useNotes: true,
  explain: true,
};

// Tolerant of anything that might be in storage: missing, hand-edited or
// written by an older version. Each field falls back on its own.
export function parseSettings(raw: string | null | undefined): ReplySettings {
  if (!raw) return DEFAULT_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_SETTINGS;
  const stored = value as Record<string, unknown>;
  return {
    context: stored.context === "casual" ? "casual" : "work",
    speed: stored.speed === "fast" || stored.speed === "smart" ? stored.speed : "auto",
    learn: typeof stored.learn === "boolean" ? stored.learn : DEFAULT_SETTINGS.learn,
    useMemory: typeof stored.useMemory === "boolean" ? stored.useMemory : DEFAULT_SETTINGS.useMemory,
    useNotes: typeof stored.useNotes === "boolean" ? stored.useNotes : DEFAULT_SETTINGS.useNotes,
    explain: typeof stored.explain === "boolean" ? stored.explain : DEFAULT_SETTINGS.explain,
  };
}
