import { describe, expect, it } from "vitest";
import { createLineSplitter, encodeEvent } from "./ndjson";

describe("createLineSplitter", () => {
  it("returns complete lines and holds the unfinished tail", () => {
    const splitter = createLineSplitter();
    expect(splitter.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(splitter.push(':2}\n')).toEqual(['{"b":2}']);
  });

  it("handles a line split across many tiny chunks", () => {
    const splitter = createLineSplitter();
    const lines = ['{"t":"delta","text":"héllo"}', '{"t":"done"}'].join("\n") + "\n";
    const out: string[] = [];
    for (const char of lines) out.push(...splitter.push(char));
    expect(out).toEqual(['{"t":"delta","text":"héllo"}', '{"t":"done"}']);
  });

  it("drops blank lines and strips carriage returns", () => {
    const splitter = createLineSplitter();
    expect(splitter.push("a\r\n\r\n\nb\n")).toEqual(["a", "b"]);
  });

  it("flushes a last line that has no newline", () => {
    const splitter = createLineSplitter();
    splitter.push("first\nsecond");
    expect(splitter.flush()).toEqual(["second"]);
    expect(splitter.flush()).toEqual([]);
  });
});

describe("encodeEvent", () => {
  it("writes one JSON object per line", () => {
    const encoded = encodeEvent({ t: "delta", text: "line one\nline two" });
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded.trimEnd().includes("\n")).toBe(false);
    expect(JSON.parse(encoded)).toEqual({ t: "delta", text: "line one\nline two" });
  });
});
