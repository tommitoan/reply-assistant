import type { OptionFeedback } from "./types";

export interface FeedbackItem {
  generationId: string;
  // The request that started the turn this reply belongs to: its own request,
  // or for a developed version the request of the reply it grew from. Only one
  // reply per turn can be marked as used.
  familyId: string;
  // What the server last confirmed.
  saved: OptionFeedback;
  // What the screen shows: `saved` plus any change still being saved.
  shown: OptionFeedback;
  pending: boolean;
  error: string | null;
}

// Keyed by option id.
export type FeedbackState = Record<string, FeedbackItem>;

export interface LoadedOption extends OptionFeedback {
  id: string;
  generationId: string;
  // Defaults to the option's own request.
  familyId?: string;
}

export type FeedbackAction =
  | { type: "load"; options: LoadedOption[] }
  | { type: "optimistic"; id: string; patch: Partial<OptionFeedback> }
  | { type: "confirmed"; id: string; feedback: OptionFeedback }
  | { type: "failed"; id: string; error: string }
  | { type: "dismiss-error"; id: string };

export const EMPTY_FEEDBACK: OptionFeedback = { rating: null, editedText: null, chosen: false };

function siblingIds(state: FeedbackState, id: string): string[] {
  const familyId = state[id]?.familyId;
  return Object.keys(state).filter((other) => other !== id && state[other].familyId === familyId);
}

export function feedbackReducer(state: FeedbackState, action: FeedbackAction): FeedbackState {
  switch (action.type) {
    case "load": {
      const next = { ...state };
      for (const { id, generationId, familyId, ...feedback } of action.options) {
        // A save in flight wins over a stale copy from the server.
        if (next[id]?.pending) continue;
        next[id] = {
          generationId,
          familyId: familyId ?? generationId,
          saved: feedback,
          shown: feedback,
          pending: false,
          error: null,
        };
      }
      return next;
    }

    case "optimistic": {
      const item = state[action.id];
      if (!item || item.pending) return state;
      const next = {
        ...state,
        [action.id]: {
          ...item,
          shown: { ...item.shown, ...action.patch },
          pending: true,
          error: null,
        },
      };
      // Choosing this reply un-chooses the others from the same request.
      if (action.patch.chosen === true) {
        for (const other of siblingIds(state, action.id)) {
          next[other] = { ...next[other], shown: { ...next[other].shown, chosen: false } };
        }
      }
      return next;
    }

    case "confirmed": {
      const item = state[action.id];
      if (!item) return state;
      const next = {
        ...state,
        [action.id]: { ...item, saved: action.feedback, shown: action.feedback, pending: false, error: null },
      };
      if (action.feedback.chosen) {
        for (const other of siblingIds(state, action.id)) {
          const sibling = next[other];
          next[other] = {
            ...sibling,
            saved: { ...sibling.saved, chosen: false },
            shown: { ...sibling.shown, chosen: false },
          };
        }
      }
      return next;
    }

    case "failed": {
      const item = state[action.id];
      if (!item) return state;
      const next = {
        ...state,
        [action.id]: { ...item, shown: item.saved, pending: false, error: action.error },
      };
      // Bring back any sibling that was un-chosen optimistically.
      for (const other of siblingIds(state, action.id)) {
        const sibling = next[other];
        if (!sibling.pending) next[other] = { ...sibling, shown: { ...sibling.shown, chosen: sibling.saved.chosen } };
      }
      return next;
    }

    case "dismiss-error": {
      const item = state[action.id];
      return item ? { ...state, [action.id]: { ...item, error: null } } : state;
    }
  }
}
