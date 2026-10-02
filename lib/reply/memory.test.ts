import { describe, expect, it } from "vitest";
import { MEMORY_MAX_DISTANCE, MEMORY_MAX_EXAMPLES, selectMemories, type MemoryCandidate } from "./memory";

let counter = 0;
function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  counter += 1;
  return {
    optionId: `o${counter}`,
    generationId: `g${counter}`,
    input: `input ${counter}`,
    text: `model reply ${counter}`,
    editedText: null,
    chosen: false,
    rating: null,
    position: 0,
    distance: 0.2,
    ...overrides,
  };
}

describe("selectMemories", () => {
  it("returns nothing for no candidates", () => {
    expect(selectMemories([])).toEqual([]);
  });

  it("uses the user's edit instead of the model's text", () => {
    const [example] = selectMemories([candidate({ editedText: "My own words.", rating: "good" })]);
    expect(example.reply).toBe("My own words.");
    expect(example.kind).toBe("edited");
  });

  it("drops candidates that are too far away, keeping those exactly at the limit", () => {
    const near = candidate({ rating: "good", distance: MEMORY_MAX_DISTANCE });
    const far = candidate({ rating: "good", distance: MEMORY_MAX_DISTANCE + 0.01 });
    expect(selectMemories([near, far]).map((e) => e.optionId)).toEqual([near.optionId]);
  });

  it("ranks edited before used before liked, whatever the distance", () => {
    const good = candidate({ rating: "good", distance: 0.05 });
    const chosen = candidate({ chosen: true, distance: 0.1 });
    const edited = candidate({ editedText: "mine", distance: 0.3 });
    expect(selectMemories([good, chosen, edited]).map((e) => e.kind)).toEqual(["edited", "chosen", "good"]);
  });

  it("orders examples of the same kind by distance", () => {
    const far = candidate({ rating: "good", distance: 0.3 });
    const near = candidate({ rating: "good", distance: 0.1 });
    expect(selectMemories([far, near]).map((e) => e.optionId)).toEqual([near.optionId, far.optionId]);
  });

  it("keeps only the best option per earlier request", () => {
    const shared = { generationId: "same", input: "same input" };
    const liked = candidate({ ...shared, rating: "good" });
    const edited = candidate({ ...shared, editedText: "mine" });
    const used = candidate({ ...shared, chosen: true });
    const result = selectMemories([liked, used, edited]);
    expect(result).toHaveLength(1);
    expect(result[0].optionId).toBe(edited.optionId);
  });

  it("ignores replies marked bad, unless the user rewrote them", () => {
    const bad = candidate({ rating: "bad", chosen: true });
    const badButEdited = candidate({ rating: "bad", editedText: "fixed" });
    expect(selectMemories([bad, badButEdited]).map((e) => e.optionId)).toEqual([badButEdited.optionId]);
  });

  it("ignores replies with no signal at all", () => {
    expect(selectMemories([candidate()])).toEqual([]);
  });

  it("skips a reply that repeats one already chosen", () => {
    const first = candidate({ rating: "good", text: "Thanks, see you then.", distance: 0.1 });
    const copy = candidate({ rating: "good", text: "  thanks,   see you THEN. ", distance: 0.2 });
    expect(selectMemories([first, copy]).map((e) => e.optionId)).toEqual([first.optionId]);
  });

  it("returns at most the maximum number of examples", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ rating: "good", distance: i / 100 }));
    expect(selectMemories(many)).toHaveLength(MEMORY_MAX_EXAMPLES);
  });

  it("accepts different limits", () => {
    const two = [candidate({ rating: "good", distance: 0.1 }), candidate({ rating: "good", distance: 0.5 })];
    expect(selectMemories(two, { maxDistance: 0.6, maxExamples: 1 })).toHaveLength(1);
    expect(selectMemories(two, { maxDistance: 0.2 })).toHaveLength(1);
  });
});
