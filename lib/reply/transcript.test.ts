import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  formatMessage,
  planSummary,
  TRANSCRIPT_MAX_MESSAGE_CHARS,
  type TranscriptMessage,
} from "./transcript";

function msg(seq: number, text: string, author: TranscriptMessage["author"] = "them"): TranscriptMessage {
  return { seq, author, text };
}

describe("formatMessage", () => {
  it("labels each author", () => {
    expect(formatMessage(msg(1, "hi", "them"))).toBe("Them: hi");
    expect(formatMessage(msg(2, "hello", "me"))).toBe("Me: hello");
    expect(formatMessage(msg(3, "hm", "unknown"))).toBe("Unknown: hm");
  });

  it("indents the lines after the first so message boundaries stay clear", () => {
    expect(formatMessage(msg(1, "line one\nline two\nline three"))).toBe("Them: line one\n  line two\n  line three");
  });

  it("clips a very long message", () => {
    const formatted = formatMessage(msg(1, "x".repeat(TRANSCRIPT_MAX_MESSAGE_CHARS + 500)));
    expect(formatted.endsWith(" […]")).toBe(true);
    expect(formatted.length).toBeLessThan(TRANSCRIPT_MAX_MESSAGE_CHARS + 20);
  });
});

describe("buildTranscript", () => {
  it("returns an empty transcript for an empty thread", () => {
    expect(buildTranscript([])).toEqual({ text: "", count: 0, chars: 0, firstSeq: null });
  });

  it("includes a short thread whole, oldest first", () => {
    const result = buildTranscript([msg(2, "second", "me"), msg(1, "first")]);
    expect(result.text).toBe("Them: first\nMe: second");
    expect(result).toMatchObject({ count: 2, firstSeq: 1 });
    expect(result.chars).toBe(result.text.length);
  });

  it("keeps only the newest messages when there are too many", () => {
    const thread = Array.from({ length: 30 }, (_, i) => msg(i + 1, `m${i + 1}`));
    const result = buildTranscript(thread, { maxMessages: 20 });
    expect(result.count).toBe(20);
    expect(result.firstSeq).toBe(11);
    expect(result.text.startsWith("Them: m11")).toBe(true);
    expect(result.text.endsWith("Them: m30")).toBe(true);
  });

  it("keeps only the newest messages when the text gets too long", () => {
    const thread = Array.from({ length: 10 }, (_, i) => msg(i + 1, "y".repeat(100)));
    const result = buildTranscript(thread, { maxChars: 450 });
    expect(result.chars).toBeLessThanOrEqual(450);
    expect(result.count).toBeLessThan(10);
    expect(result.firstSeq).toBe(11 - result.count);
  });

  it("always includes the newest message, even when it alone is over the limit", () => {
    const result = buildTranscript([msg(1, "old"), msg(2, "z".repeat(900))], { maxChars: 100, maxMessageChars: 900 });
    expect(result.count).toBe(1);
    expect(result.firstSeq).toBe(2);
  });

  it("stays inside the default window for a long thread", () => {
    const thread = Array.from({ length: 200 }, (_, i) => msg(i + 1, `message number ${i + 1} `.repeat(20)));
    const result = buildTranscript(thread);
    expect(result.count).toBeLessThanOrEqual(20);
    expect(result.chars).toBeLessThanOrEqual(6000);
    expect(result.firstSeq).toBeGreaterThan(1);
  });

  it("handles gaps in the sequence numbers", () => {
    const result = buildTranscript([msg(1, "a"), msg(5, "b"), msg(9, "c")]);
    expect(result.firstSeq).toBe(1);
    expect(result.count).toBe(3);
  });
});

describe("planSummary", () => {
  const thread = Array.from({ length: 10 }, (_, i) => msg(i + 1, `m${i + 1}`));

  it("needs no summary while everything is inside the window", () => {
    expect(planSummary(thread, 1, null)).toBeNull();
    expect(planSummary([], null, null)).toBeNull();
  });

  it("asks for a summary of the messages that dropped out of the window", () => {
    const plan = planSummary(thread, 6, null);
    expect(plan?.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(plan?.uptoSeq).toBe(5);
  });

  it("only asks for what the existing summary does not cover", () => {
    const plan = planSummary(thread, 8, 5);
    expect(plan?.messages.map((m) => m.seq)).toEqual([6, 7]);
    expect(plan?.uptoSeq).toBe(7);
  });

  it("asks for nothing when the summary is already up to date", () => {
    expect(planSummary(thread, 6, 5)).toBeNull();
    expect(planSummary(thread, 6, 9)).toBeNull();
  });
});
