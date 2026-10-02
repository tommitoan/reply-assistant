import { describe, expect, it } from "vitest";
import {
  EMPTY_FEEDBACK,
  feedbackReducer,
  type FeedbackAction,
  type FeedbackState,
  type LoadedOption,
} from "./feedback-state";

function loaded(id: string, generationId = "g1", overrides: Partial<LoadedOption> = {}): LoadedOption {
  return { id, generationId, ...EMPTY_FEEDBACK, ...overrides };
}

function run(actions: FeedbackAction[], start: FeedbackState = {}): FeedbackState {
  return actions.reduce(feedbackReducer, start);
}

describe("feedbackReducer", () => {
  it("loads options with nothing pending", () => {
    const state = run([{ type: "load", options: [loaded("a", "g1", { rating: "good" })] }]);
    expect(state.a).toEqual({
      generationId: "g1",
      familyId: "g1",
      saved: { rating: "good", editedText: null, chosen: false },
      shown: { rating: "good", editedText: null, chosen: false },
      pending: false,
      error: null,
    });
  });

  it("shows a change straight away and marks it pending", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { rating: "bad" } },
    ]);
    expect(state.a.shown.rating).toBe("bad");
    expect(state.a.saved.rating).toBeNull();
    expect(state.a.pending).toBe(true);
  });

  it("keeps the server's version once a change is confirmed", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { editedText: "My words." } },
      { type: "confirmed", id: "a", feedback: { rating: null, editedText: "My words.", chosen: false } },
    ]);
    expect(state.a.saved.editedText).toBe("My words.");
    expect(state.a.shown.editedText).toBe("My words.");
    expect(state.a.pending).toBe(false);
  });

  it("rolls back to the last saved state and reports the error when a save fails", () => {
    const state = run([
      { type: "load", options: [loaded("a", "g1", { rating: "good" })] },
      { type: "optimistic", id: "a", patch: { rating: "bad", editedText: "x" } },
      { type: "failed", id: "a", error: "Could not save that." },
    ]);
    expect(state.a.shown).toEqual({ rating: "good", editedText: null, chosen: false });
    expect(state.a.pending).toBe(false);
    expect(state.a.error).toBe("Could not save that.");
  });

  it("clears an earlier error when the next change starts", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { rating: "good" } },
      { type: "failed", id: "a", error: "boom" },
      { type: "optimistic", id: "a", patch: { rating: "good" } },
    ]);
    expect(state.a.error).toBeNull();
  });

  it("ignores a second change while one is still being saved", () => {
    const first = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { rating: "good" } },
    ]);
    const second = feedbackReducer(first, { type: "optimistic", id: "a", patch: { rating: "bad" } });
    expect(second).toBe(first);
  });

  it("ignores changes for an option it does not know", () => {
    const state: FeedbackState = {};
    expect(feedbackReducer(state, { type: "optimistic", id: "nope", patch: { chosen: true } })).toBe(state);
    expect(feedbackReducer(state, { type: "failed", id: "nope", error: "x" })).toBe(state);
    expect(
      feedbackReducer(state, { type: "confirmed", id: "nope", feedback: EMPTY_FEEDBACK }),
    ).toBe(state);
  });

  describe("choosing one reply per request", () => {
    const twoOptions: FeedbackAction = { type: "load", options: [loaded("a"), loaded("b"), loaded("c", "g2")] };

    it("un-chooses the others from the same request straight away", () => {
      const state = run([
        { type: "load", options: [loaded("a", "g1", { chosen: true }), loaded("b"), loaded("c", "g2", { chosen: true })] },
        { type: "optimistic", id: "b", patch: { chosen: true } },
      ]);
      expect(state.b.shown.chosen).toBe(true);
      expect(state.a.shown.chosen).toBe(false);
      // A different request is not affected.
      expect(state.c.shown.chosen).toBe(true);
    });

    it("keeps the others un-chosen once the server confirms", () => {
      const state = run([
        { type: "load", options: [loaded("a", "g1", { chosen: true }), loaded("b")] },
        { type: "optimistic", id: "b", patch: { chosen: true } },
        { type: "confirmed", id: "b", feedback: { rating: null, editedText: null, chosen: true } },
      ]);
      expect(state.a.saved.chosen).toBe(false);
      expect(state.a.shown.chosen).toBe(false);
      expect(state.b.saved.chosen).toBe(true);
    });

    it("puts the previous choice back when the save fails", () => {
      const state = run([
        { type: "load", options: [loaded("a", "g1", { chosen: true }), loaded("b")] },
        { type: "optimistic", id: "b", patch: { chosen: true } },
        { type: "failed", id: "b", error: "x" },
      ]);
      expect(state.a.shown.chosen).toBe(true);
      expect(state.b.shown.chosen).toBe(false);
    });

    it("does not touch siblings when a rating changes", () => {
      const state = run([
        twoOptions,
        { type: "optimistic", id: "a", patch: { rating: "good" } },
      ]);
      expect(state.b.shown).toEqual(EMPTY_FEEDBACK);
    });
  });

  describe("choosing one reply per turn, across developed versions", () => {
    // a, b: the original request g1. d1, d2: two developed versions of it (g2).
    // e: developed again (g3). x: an unrelated request.
    const load: FeedbackAction = {
      type: "load",
      options: [
        loaded("a", "g1", { chosen: true }),
        loaded("b", "g1"),
        loaded("d1", "g2", { familyId: "g1" }),
        loaded("d2", "g2", { familyId: "g1" }),
        loaded("e", "g3", { familyId: "g1" }),
        loaded("x", "g9", { chosen: true }),
      ],
    };

    it("defaults the turn to the option's own request", () => {
      expect(run([load]).a.familyId).toBe("g1");
      expect(run([load]).d1.familyId).toBe("g1");
    });

    it("choosing a developed version un-chooses its original straight away", () => {
      const state = run([load, { type: "optimistic", id: "d1", patch: { chosen: true } }]);
      expect(state.d1.shown.chosen).toBe(true);
      expect(state.a.shown.chosen).toBe(false);
      expect(state.x.shown.chosen).toBe(true);
    });

    it("choosing an original un-chooses a developed version of it", () => {
      const state = run([
        { type: "load", options: [loaded("a", "g1"), loaded("d1", "g2", { familyId: "g1", chosen: true })] },
        { type: "optimistic", id: "a", patch: { chosen: true } },
        { type: "confirmed", id: "a", feedback: { rating: null, editedText: null, chosen: true } },
      ]);
      expect(state.d1.saved.chosen).toBe(false);
      expect(state.d1.shown.chosen).toBe(false);
    });

    it("choosing one developed version un-chooses another developed run of the same reply", () => {
      const state = run([
        { type: "load", options: [loaded("d1", "g2", { familyId: "g1", chosen: true }), loaded("e", "g3", { familyId: "g1" })] },
        { type: "optimistic", id: "e", patch: { chosen: true } },
      ]);
      expect(state.d1.shown.chosen).toBe(false);
    });

    it("puts the original's mark back when the save of a developed choice fails", () => {
      const state = run([load, { type: "optimistic", id: "d1", patch: { chosen: true } }, { type: "failed", id: "d1", error: "x" }]);
      expect(state.a.shown.chosen).toBe(true);
      expect(state.d1.shown.chosen).toBe(false);
    });
  });

  it("does not overwrite a save in flight when the list is reloaded", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { rating: "good" } },
      { type: "load", options: [loaded("a")] },
    ]);
    expect(state.a.shown.rating).toBe("good");
    expect(state.a.pending).toBe(true);
  });

  it("replaces an idle item with the server's copy on reload", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "load", options: [loaded("a", "g1", { chosen: true })] },
    ]);
    expect(state.a.shown.chosen).toBe(true);
  });

  it("dismisses an error without changing anything else", () => {
    const state = run([
      { type: "load", options: [loaded("a")] },
      { type: "optimistic", id: "a", patch: { rating: "good" } },
      { type: "failed", id: "a", error: "boom" },
      { type: "dismiss-error", id: "a" },
    ]);
    expect(state.a.error).toBeNull();
    expect(state.a.shown).toEqual(EMPTY_FEEDBACK);
  });
});
