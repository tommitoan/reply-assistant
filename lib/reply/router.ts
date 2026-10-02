import type { ModelTier, ReplyMode, ReplySpeed } from "./types";

export interface RouteInput {
  mode: ReplyMode;
  speed: ReplySpeed;
  // The "better" regenerate button asks for quality explicitly.
  better?: boolean;
  // Present when the request runs inside a conversation thread; the size is
  // that of the whole thread, since a long one needs the careful model even
  // though only its newest part is sent word for word.
  thread?: { transcriptChars: number };
  // Feature 2 paste size, used when no thread transcript is available yet.
  paste?: { messageCount: number; chars: number };
  // The request carries notes about the writer. The fast model tends to invent
  // experiences when a message asks about the writer's life, so these go to the
  // careful one.
  notesOffered?: boolean;
}

export interface RouteModels {
  fast: string;
  smart: string;
}

export interface Route {
  tier: ModelTier;
  model: string;
}

// A thread above this is too much context for the fast model.
export const THREAD_FAST_MAX_CHARS = 6000;
export const PASTE_FAST_MAX_MESSAGES = 4;
export const PASTE_FAST_MAX_CHARS = 1500;

// Starting thresholds; tune them from the stats page once there is real data.
function autoTier(input: RouteInput): ModelTier {
  if (input.mode === "en_reply") {
    if (input.notesOffered) return "smart";
    const paste = input.paste;
    if (!paste) return "smart";
    return paste.messageCount <= PASTE_FAST_MAX_MESSAGES && paste.chars < PASTE_FAST_MAX_CHARS
      ? "fast"
      : "smart";
  }
  if (input.thread) {
    return input.thread.transcriptChars < THREAD_FAST_MAX_CHARS ? "fast" : "smart";
  }
  return "fast";
}

export function routeRequest(input: RouteInput, models: RouteModels): Route {
  let tier: ModelTier;
  if (input.better) tier = "smart";
  else if (input.speed === "fast") tier = "fast";
  else if (input.speed === "smart") tier = "smart";
  else tier = autoTier(input);
  return { tier, model: models[tier] };
}
