import { describe, expect, it } from "vitest";
import { toVectorLiteral } from "./memory-repo";

describe("toVectorLiteral", () => {
  it("writes the text form pgvector reads", () => {
    expect(toVectorLiteral([0.1, -0.25, 3])).toBe("[0.1,-0.25,3]");
  });

  it("handles a single value and an empty vector", () => {
    expect(toVectorLiteral([1])).toBe("[1]");
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("keeps small and large magnitudes in a form pgvector accepts", () => {
    expect(toVectorLiteral([1e-7, 123456.789])).toBe("[1e-7,123456.789]");
  });
});
