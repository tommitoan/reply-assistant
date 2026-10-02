import { describe, expect, it } from "vitest";
import { utcDayStart } from "./repo";

describe("utcDayStart", () => {
  it("returns midnight UTC of the same day", () => {
    expect(utcDayStart(new Date("2026-10-01T17:45:12.345Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("is stable at the boundaries", () => {
    expect(utcDayStart(new Date("2026-10-01T00:00:00.000Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(utcDayStart(new Date("2026-10-01T23:59:59.999Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("follows UTC rather than the local time zone at month and year ends", () => {
    expect(utcDayStart(new Date("2026-12-31T23:30:00.000Z")).toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(utcDayStart(new Date("2027-01-01T00:30:00.000Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
