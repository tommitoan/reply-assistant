import { describe, expect, it } from "vitest";
import { notesExportFilename, toNotesExport } from "./notes-export";
import type { NoteRecord } from "./types";

const NOW = new Date("2026-10-02T09:30:00Z");

const note = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: "n1",
  text: "Mình làm backend.",
  textEn: "I work on backends.",
  kind: "fact",
  happenedOn: null,
  scope: "both",
  private: false,
  pinned: false,
  status: "active",
  source: "manual",
  indexed: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("toNotesExport", () => {
  it("lists the notes with their fields, oldest first, and without ids or any embedding", () => {
    const out = toNotesExport(
      [
        note({ id: "b", text: "second", createdAt: "2026-10-01T10:00:00.000Z", pinned: true, kind: "event", happenedOn: "2026-09-14" }),
        note({ id: "a", text: "first", createdAt: "2026-10-01T09:00:00.000Z", source: "imported" }),
      ],
      0,
      NOW,
    );
    expect(out.exportedAt).toBe("2026-10-02T09:30:00.000Z");
    expect(out.notes.map((n) => n.text)).toEqual(["first", "second"]);
    expect(out.notes[1]).toEqual({
      text: "second",
      textEn: "I work on backends.",
      kind: "event",
      happenedOn: "2026-09-14",
      scope: "both",
      pinned: true,
      archived: false,
      source: "manual",
      createdAt: "2026-10-01T10:00:00.000Z",
    });
    expect(JSON.stringify(out)).not.toMatch(/embedding|"id"|updatedAt|indexed/);
  });

  it("never includes a private note, even if one is handed in, and says how many were left out", () => {
    const out = toNotesExport([note({ text: "SECRET", private: true }), note({ text: "public" })], 3, NOW);
    expect(out.notes.map((n) => n.text)).toEqual(["public"]);
    expect(out.privateOmitted).toBe(3);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("keeps archived notes (marked) but not suggestions or dismissed ones", () => {
    const out = toNotesExport(
      [
        note({ text: "kept" }),
        note({ text: "old", status: "archived" }),
        note({ text: "waiting", status: "suggested" }),
        note({ text: "refused", status: "dismissed" }),
      ],
      0,
      NOW,
    );
    expect(out.notes.map((n) => [n.text, n.archived])).toEqual([
      ["kept", false],
      ["old", true],
    ]);
  });

  it("gives an empty list for no notes", () => {
    expect(toNotesExport([], 0, NOW).notes).toEqual([]);
  });
});

describe("notesExportFilename", () => {
  it("carries the date", () => {
    expect(notesExportFilename(NOW)).toBe("notes-export-20261002.json");
  });
});
