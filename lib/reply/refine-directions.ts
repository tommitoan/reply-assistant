import type { RefinePreset } from "./types";

// What each quick button asks the model to do. The writer's own Vietnamese
// direction, when given, is added after it.
export const PRESET_DIRECTIONS: Record<RefinePreset, string> = {
  longer: "Make it longer: add a little more context or warmth, with no new facts.",
  ask_back: "Keep the reply and add one short question back to the other person that follows from the conversation.",
  personal_detail: "Add the personal detail the writer gives below, in a natural way, and nothing else about their life.",
  casual: "Make it more casual and relaxed, with the same meaning.",
};

const PRESET_LABELS: Record<RefinePreset, string> = {
  longer: "longer",
  ask_back: "ask back",
  personal_detail: "personal detail",
  casual: "casual",
};

// How a direction begins when it was developed with a saved note's detail.
export const PERSONAL_DETAIL_TAG = `[${PRESET_LABELS.personal_detail}]`;

// How a direction is kept with the request it produced, for the style profile
// and the export: "[longer] thêm là mình cũng mới dọn nhà". Never empty.
export function storedDirection(preset: RefinePreset | undefined, instruction: string | undefined): string {
  const typed = instruction?.trim() ?? "";
  const tag = preset ? `[${PRESET_LABELS[preset]}]` : "";
  return [tag, typed].filter(Boolean).join(" ");
}
