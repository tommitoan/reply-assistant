import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps same-origin paths, including query strings", () => {
    expect(safeNextPath("/about")).toBe("/about");
    expect(safeNextPath("/study?category=go")).toBe("/study?category=go");
  });

  it.each([
    ["absolute URL", "https://evil.example/x"],
    ["protocol-relative URL", "//evil.example/x"],
    ["backslash trick", "/\\evil.example"],
    ["relative path", "reply"],
    ["control character", "/a\nb"],
    ["login page itself", "/login"],
    ["login page with query", "/login?next=/x"],
    ["not a string", 42],
    ["missing", undefined],
  ])("falls back to home for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});
