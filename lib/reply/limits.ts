// Kept apart from the Zod schema so client code can use it without bundling Zod.
export const MAX_INPUT_CHARS = 4000;
// An edited reply is at most as long as what the writer could have typed.
export const MAX_EDIT_CHARS = 4000;
// A pasted conversation (Feature 2) can be long; a typed Vietnamese idea cannot.
export const MAX_PASTE_CHARS = 30000;
export const MAX_TITLE_CHARS = 120;
// The Vietnamese direction for developing a reply is a sentence or two.
export const MAX_INSTRUCTION_CHARS = 500;
// One note is a sentence or a short paragraph, not a diary page.
export const MAX_NOTE_CHARS = 1000;
export const MAX_NOTE_EN_CHARS = 1500;
// A pasted diary that is split into notes.
export const MAX_DIARY_CHARS = 12000;
// A personal collection stays small; the cap also bounds what a prompt can carry.
export const MAX_NOTES = 500;
export const MAX_PINNED_NOTES = 20;
export const MAX_NOTES_PER_BATCH = 40;
// Facts the app proposes from what the writer typed: a few per request, and a
// short waiting list, so the inbox never turns into a chore.
export const MAX_SUGGESTIONS_PER_REQUEST = 3;
export const MAX_WAITING_SUGGESTIONS = 20;
// Dismissed suggestions are remembered so they are not proposed again, but not forever.
export const MAX_REMEMBERED_DISMISSED = 300;
// Text shorter than this cannot state a fact worth a model call.
export const MIN_SUGGEST_CHARS = 15;
// How much of the writer's typed text is read for facts.
export const MAX_SUGGEST_INPUT_CHARS = 1500;
