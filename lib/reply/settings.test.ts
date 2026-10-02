import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("returns the defaults for missing or empty storage", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips valid settings", () => {
    const stored = { context: "casual", speed: "smart", learn: false, useMemory: true, useNotes: false, explain: false };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it("has the writer's notes on by default, and keeps the choice of a setting saved before notes existed", () => {
    expect(DEFAULT_SETTINGS.useNotes).toBe(true);
    // Settings written by an older version have no such field.
    expect(parseSettings(JSON.stringify({ context: "casual", learn: false })).useNotes).toBe(true);
    expect(parseSettings(JSON.stringify({ useNotes: false })).useNotes).toBe(false);
    expect(parseSettings(JSON.stringify({ useNotes: "no" })).useNotes).toBe(true);
  });

  it("falls back to the defaults for corrupt JSON or a non-object", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("repairs each bad field on its own", () => {
    const parsed = parseSettings(JSON.stringify({ context: "elsewhere", speed: "turbo", learn: "no", useMemory: 3 }));
    expect(parsed).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ speed: "fast", learn: false }))).toEqual({
      ...DEFAULT_SETTINGS,
      speed: "fast",
      learn: false,
    });
  });
});
