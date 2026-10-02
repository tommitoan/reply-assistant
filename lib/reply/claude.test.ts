// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeClaudeError } from "./claude";

function apiError(status: number): Error {
  return Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "secret detail" } }, "secret detail", new Headers());
}

describe("describeClaudeError", () => {
  it("treats a user abort as a quiet cancel", () => {
    expect(describeClaudeError(new Anthropic.APIUserAbortError())).toEqual({
      message: "Cancelled.",
      retryable: false,
    });
  });

  it("marks rate limits and server errors as retryable", () => {
    expect(describeClaudeError(apiError(429)).retryable).toBe(true);
    expect(describeClaudeError(apiError(500)).retryable).toBe(true);
    expect(describeClaudeError(apiError(529)).retryable).toBe(true);
  });

  it("marks connection problems as retryable", () => {
    expect(describeClaudeError(new Anthropic.APIConnectionError({ message: "down" })).retryable).toBe(true);
  });

  it("does not retry authentication or bad-request failures", () => {
    expect(describeClaudeError(apiError(401))).toMatchObject({ retryable: false });
    expect(describeClaudeError(apiError(400))).toMatchObject({ retryable: false });
  });

  it("never exposes the raw error text", () => {
    for (const err of [apiError(400), apiError(500), new Error("secret detail")]) {
      expect(describeClaudeError(err).message).not.toContain("secret detail");
    }
  });

  it("gives a generic message for anything unrecognised", () => {
    expect(describeClaudeError("odd")).toEqual({
      message: "Something went wrong while writing the replies.",
      retryable: false,
    });
  });
});
