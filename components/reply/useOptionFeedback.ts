"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  feedbackReducer,
  type FeedbackState,
  type LoadedOption,
} from "@/lib/reply/feedback-state";
import type { OptionFeedback, StoredOption } from "@/lib/reply/types";

export interface OptionFeedbackStore {
  items: FeedbackState;
  load: (options: LoadedOption[]) => void;
  // Resolves true once the server has confirmed the change.
  save: (id: string, patch: Partial<OptionFeedback>) => Promise<boolean>;
  dismissError: (id: string) => void;
}

async function failureMessage(res: Response): Promise<string> {
  if (res.status === 401) return "Your session expired. Reload the page to sign in again.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; use the generic message.
  }
  return "Could not save that. Try again.";
}

// Keeps ratings, edits and "used" marks for the options on screen. A change
// shows immediately and is rolled back if the server does not accept it.
export function useOptionFeedback(
  onSaved?: (id: string, patch: Partial<OptionFeedback>) => void,
): OptionFeedbackStore {
  const [items, dispatch] = useReducer(feedbackReducer, {} as FeedbackState);
  const inFlight = useRef(new Set<string>());
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const load = useCallback((options: LoadedOption[]) => dispatch({ type: "load", options }), []);
  const dismissError = useCallback((id: string) => dispatch({ type: "dismiss-error", id }), []);

  const save = useCallback(async (id: string, patch: Partial<OptionFeedback>): Promise<boolean> => {
    // One save per option at a time, so replies cannot arrive out of order.
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    dispatch({ type: "optimistic", id, patch });
    try {
      const res = await fetch(`/api/reply/options/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        dispatch({ type: "failed", id, error: await failureMessage(res) });
        return false;
      }
      const { option } = (await res.json()) as { option: StoredOption };
      dispatch({
        type: "confirmed",
        id,
        feedback: { rating: option.rating, editedText: option.editedText, chosen: option.chosen },
      });
      onSavedRef.current?.(id, patch);
      return true;
    } catch {
      dispatch({ type: "failed", id, error: "Could not save that. Check the connection and try again." });
      return false;
    } finally {
      inFlight.current.delete(id);
    }
  }, []);

  return { items, load, save, dismissError };
}
