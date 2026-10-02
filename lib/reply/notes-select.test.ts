import { describe, expect, it } from "vitest";
import {
  EVENT_FADE_MAX,
  fadeFactor,
  labelNotes,
  NOTE_REF_CHARS,
  NOTES_QUERY_CHARS,
  NOTES_SIMILARITY_FLOOR,
  NOTES_TOP_K,
  noteWording,
  notesQueryText,
  pickSimilar,
  toNoteRef,
  usedNotes,
  type SimilarNote,
  type UsableNote,
} from "./notes-select";

const TODAY = new Date("2026-10-01T12:00:00Z");

const note = (id: string, over: Partial<UsableNote> = {}): UsableNote => ({
  id,
  text: `Vietnamese ${id}`,
  textEn: `English ${id}`,
  kind: "fact",
  happenedOn: null,
  pinned: false,
  ...over,
});
const similar = (id: string, similarity: number, over: Partial<SimilarNote> = {}): SimilarNote => ({
  ...note(id),
  similarity,
  ...over,
});

describe("noteWording", () => {
  it("is the English version, or the writer's own text without one", () => {
    expect(noteWording(note("a"))).toBe("English a");
    expect(noteWording(note("a", { textEn: null }))).toBe("Vietnamese a");
  });
});

describe("fadeFactor", () => {
  it("never fades a fact, or an event without a date", () => {
    expect(fadeFactor({ kind: "fact", happenedOn: "2020-01-01" }, TODAY)).toBe(1);
    expect(fadeFactor({ kind: "event", happenedOn: null }, TODAY)).toBe(1);
  });

  it("does not fade an event from today or one in the future", () => {
    expect(fadeFactor({ kind: "event", happenedOn: "2026-10-01" }, TODAY)).toBe(1);
    expect(fadeFactor({ kind: "event", happenedOn: "2026-12-25" }, TODAY)).toBe(1);
  });

  it("fades an event gently as it gets older, and stops after a year", () => {
    const half = fadeFactor({ kind: "event", happenedOn: "2026-04-01" }, TODAY);
    expect(half).toBeGreaterThan(1 - EVENT_FADE_MAX);
    expect(half).toBeLessThan(1);
    expect(fadeFactor({ kind: "event", happenedOn: "2025-10-01" }, TODAY)).toBeCloseTo(1 - EVENT_FADE_MAX, 5);
    expect(fadeFactor({ kind: "event", happenedOn: "2015-01-01" }, TODAY)).toBeCloseTo(1 - EVENT_FADE_MAX, 5);
  });

  it("keeps a recent event above an old one", () => {
    expect(fadeFactor({ kind: "event", happenedOn: "2026-09-20" }, TODAY)).toBeGreaterThan(
      fadeFactor({ kind: "event", happenedOn: "2025-01-01" }, TODAY),
    );
  });
});

describe("pickSimilar", () => {
  it("drops everything below the floor, however few remain", () => {
    expect(pickSimilar([similar("a", NOTES_SIMILARITY_FLOOR - 0.01), similar("b", 0.1)], TODAY)).toEqual([]);
    expect(pickSimilar([similar("a", NOTES_SIMILARITY_FLOOR)], TODAY).map((n) => n.id)).toEqual(["a"]);
  });

  it("returns the best first and no more than the limit", () => {
    const rows = Array.from({ length: 8 }, (_, i) => similar(`n${i}`, 0.5 + i / 100));
    const picked = pickSimilar(rows, TODAY);
    expect(picked).toHaveLength(NOTES_TOP_K);
    expect(picked[0].id).toBe("n7");
    expect(pickSimilar(rows, TODAY, 2)).toHaveLength(2);
  });

  it("lets a recent event beat an older one that matches slightly better", () => {
    const old = similar("old", 0.62, { kind: "event", happenedOn: "2025-01-01" });
    const recent = similar("recent", 0.58, { kind: "event", happenedOn: "2026-09-25" });
    expect(pickSimilar([old, recent], TODAY).map((n) => n.id)).toEqual(["recent", "old"]);
  });

  it("does not let fading push a note under the floor", () => {
    const old = similar("old", 0.41, { kind: "event", happenedOn: "2020-01-01" });
    expect(pickSimilar([old], TODAY).map((n) => n.id)).toEqual(["old"]);
  });

  it("orders ties the same way every time", () => {
    const rows = [similar("b", 0.5), similar("a", 0.5)];
    expect(pickSimilar(rows, TODAY).map((n) => n.id)).toEqual(["a", "b"]);
    expect(pickSimilar([...rows].reverse(), TODAY).map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("notesQueryText", () => {
  it("keeps a short message as it is and the newest part of a long chat", () => {
    expect(notesQueryText("  Hi there  ")).toBe("Hi there");
    const long = `${"old ".repeat(500)}NEWEST`;
    const query = notesQueryText(long);
    expect(query.length).toBeLessThanOrEqual(NOTES_QUERY_CHARS);
    expect(query.endsWith("NEWEST")).toBe(true);
  });
});

describe("toNoteRef", () => {
  it("shows the English version, flattened and cut", () => {
    expect(toNoteRef(note("a"))).toEqual({ id: "a", text: "English a", pinned: false });
    const long = toNoteRef(note("b", { textEn: `line one\n\n${"x".repeat(NOTE_REF_CHARS * 2)}`, pinned: true }));
    expect(long.text.length).toBeLessThanOrEqual(NOTE_REF_CHARS);
    expect(long.text.startsWith("line one x")).toBe(true);
    expect(long.text.endsWith("…")).toBe(true);
    expect(long.pinned).toBe(true);
  });
});

describe("labelNotes and usedNotes", () => {
  const pinned = [note("p1", { pinned: true }), note("p2", { pinned: true })];
  const offered = [note("o1"), note("o2")];
  const labelled = labelNotes(pinned, offered);

  it("numbers the pinned notes first, then the others, from 1", () => {
    expect(labelled.map((entry) => [entry.label, entry.note.id])).toEqual([[1, "p1"], [2, "p2"], [3, "o1"], [4, "o2"]]);
  });

  it("gives the pinned notes the same numbers whatever else is offered", () => {
    expect(labelNotes(pinned, []).map((entry) => entry.label)).toEqual([1, 2]);
    expect(labelNotes(pinned, [note("x")]).slice(0, 2).map((entry) => entry.note.id)).toEqual(["p1", "p2"]);
  });

  it("maps the numbers the model reported back to notes", () => {
    expect(usedNotes(labelled, [3, 1]).map((n) => n.id)).toEqual(["o1", "p1"]);
  });

  it("ignores a number that was never offered, counts a note once, and treats no report as none", () => {
    expect(usedNotes(labelled, [9, 2, 2, 0, -1]).map((n) => n.id)).toEqual(["p2"]);
    expect(usedNotes(labelled, [])).toEqual([]);
    expect(usedNotes(labelled, null)).toEqual([]);
  });
});
