import { describe, expect, it } from "vitest";
import { createOptionParser, parseOptions } from "./stream-parser";

const FULL = `@@short
Sounds good, see you then.

@@medium
Sounds good. I can make it at 3pm.

@@long
Thanks for letting me know. I can make it at 3pm, and I'll bring the notes.

@@alt
Works for me. Let's meet at 3pm.`;

describe("parseOptions", () => {
  it("parses the four variants in order", () => {
    const { options, usedFallback } = parseOptions(FULL);
    expect(usedFallback).toBe(false);
    expect(options.map((o) => o.variant)).toEqual(["short", "medium", "long", "alt"]);
    expect(options[0].text).toBe("Sounds good, see you then.");
    expect(options[3].text).toBe("Works for me. Let's meet at 3pm.");
  });

  it("keeps multi-line option text and trims surrounding blank lines", () => {
    const { options } = parseOptions("@@long\n\nLine one.\nLine two.\n\n@@alt\nOther.");
    expect(options[0].text).toBe("Line one.\nLine two.");
  });

  it("drops any preamble before the first marker", () => {
    const { options } = parseOptions("Here are your options:\n@@short\nHi.\n@@alt\nHey.");
    expect(options.map((o) => o.text)).toEqual(["Hi.", "Hey."]);
  });

  it("accepts a reply with only some variants", () => {
    const { options } = parseOptions("@@short\nOk.\n@@alt\nSure.");
    expect(options.map((o) => o.variant)).toEqual(["short", "alt"]);
  });

  it("handles Windows line endings and uppercase markers", () => {
    const { options } = parseOptions("@@SHORT\r\nHi.\r\n@@medium\r\nHello there.");
    expect(options).toEqual([
      { variant: "short", text: "Hi." },
      { variant: "medium", text: "Hello there." },
    ]);
  });

  it("treats an unknown marker or a mid-line marker as ordinary text", () => {
    const { options } = parseOptions("@@short\nSee @@medium in the doc.\n@@bogus\nStill short.");
    expect(options).toHaveLength(1);
    expect(options[0].text).toBe("See @@medium in the doc.\n@@bogus\nStill short.");
  });

  it("drops options that have a marker but no text", () => {
    const { options } = parseOptions("@@short\n@@medium\nHello.");
    expect(options).toEqual([{ variant: "medium", text: "Hello." }]);
  });

  it("falls back to one option when the model ignores the format", () => {
    const { options, usedFallback } = parseOptions("  Just one plain answer.  ");
    expect(usedFallback).toBe(true);
    expect(options).toEqual([{ variant: "medium", text: "Just one plain answer." }]);
  });

  it("returns nothing for an empty reply", () => {
    expect(parseOptions("  \n ")).toEqual({ options: [], usedFallback: false, used: null });
  });
});

describe("createOptionParser (incremental)", () => {
  function feed(chunks: string[]) {
    const parser = createOptionParser();
    const snapshots = chunks.map((chunk) => parser.push(chunk));
    return { snapshots, result: parser.finish() };
  }

  it("gives the same result however the text is chunked", () => {
    const expected = parseOptions(FULL);
    for (const size of [1, 2, 3, 7, 50]) {
      const chunks: string[] = [];
      for (let i = 0; i < FULL.length; i += size) chunks.push(FULL.slice(i, i + size));
      expect(feed(chunks).result).toEqual(expected);
    }
  });

  it("never shows a half-received marker as option text", () => {
    const { snapshots } = feed(["@@sh", "ort\nHel", "lo.\n@@me", "dium\nHi"]);
    for (const snapshot of snapshots) {
      for (const option of snapshot) expect(option.text).not.toContain("@@");
    }
    expect(snapshots[1]).toEqual([{ variant: "short", text: "Hel" }]);
    expect(snapshots[3].map((o) => o.text)).toEqual(["Hello.", "Hi"]);
  });

  it("streams the partial last line of the current option", () => {
    const { snapshots } = feed(["@@short\nHello", " there, I'm", " on my way."]);
    expect(snapshots[0]).toEqual([{ variant: "short", text: "Hello" }]);
    expect(snapshots[2][0].text).toBe("Hello there, I'm on my way.");
  });

  it("holds back a lone at-sign until it is clear what follows", () => {
    const { snapshots } = feed(["@@short\nHi.\n@", "@alt\nHey."]);
    expect(snapshots[0]).toEqual([{ variant: "short", text: "Hi." }]);
    expect(snapshots[1].map((o) => o.variant)).toEqual(["short", "alt"]);
  });

  it("does not hold back ordinary text that merely starts with letters", () => {
    const { snapshots } = feed(["@@short\nshort", " answer"]);
    expect(snapshots[0][0].text).toBe("short");
  });

  it("flushes a final line that has no trailing newline", () => {
    const { result } = feed(["@@short\nAll done"]);
    expect(result.options).toEqual([{ variant: "short", text: "All done" }]);
  });
});

describe("the notes report (@@used)", () => {
  const WITH_REPORT = `${FULL}\n@@used 2, 4`;

  it("reads the numbers of the notes the model says it used, and keeps them out of the options", () => {
    const result = parseOptions(WITH_REPORT);
    expect(result.used).toEqual([2, 4]);
    expect(result.options.map((o) => o.variant)).toEqual(["short", "medium", "long", "alt"]);
    expect(result.options[3].text).toBe("Works for me. Let's meet at 3pm.");
  });

  it("reads 'none' as no notes used, and no report as no information", () => {
    expect(parseOptions(`${FULL}\n@@used none`).used).toEqual([]);
    expect(parseOptions(`${FULL}\n@@used`).used).toEqual([]);
    expect(parseOptions(FULL).used).toBeNull();
  });

  it("accepts any reasonable way of writing the numbers, once each", () => {
    expect(parseOptions(`${FULL}\n@@used 3,1;3 and 2`).used).toEqual([3, 1, 2]);
    expect(parseOptions(`${FULL}\n@@USED 1`).used).toEqual([1]);
    expect(parseOptions(`${FULL}\n@@used 0, 7`).used).toEqual([7]);
  });

  it("ignores everything after the report", () => {
    const result = parseOptions(`${FULL}\n@@used 1\n@@short\nShould not appear\nTrailing words`);
    expect(result.used).toEqual([1]);
    expect(result.options[0].text).toBe("Sounds good, see you then.");
    expect(JSON.stringify(result.options)).not.toContain("Trailing");
  });

  it("does not take a mid-line mention for a report", () => {
    const result = parseOptions("@@short\nI @@used 3 pens.");
    expect(result.used).toBeNull();
    expect(result.options[0].text).toBe("I @@used 3 pens.");
  });

  it("never shows the report as option text while it streams in, however it is cut", () => {
    const parser = createOptionParser();
    const text = `${FULL}\n@@used 12, 3`;
    for (let i = 1; i <= text.length; i++) {
      const snapshot = createOptionParser();
      for (const option of snapshot.push(text.slice(0, i))) {
        expect(option.text).not.toContain("@@used");
        expect(option.text).not.toMatch(/@@u|used 1/);
      }
    }
    parser.push(text);
    expect(parser.finish().used).toEqual([12, 3]);
  });

  it("gives the same result however the text is chunked", () => {
    const expected = parseOptions(WITH_REPORT);
    for (const size of [1, 2, 5, 11]) {
      const parser = createOptionParser();
      for (let i = 0; i < WITH_REPORT.length; i += size) parser.push(WITH_REPORT.slice(i, i + size));
      expect(parser.finish()).toEqual(expected);
    }
  });

  it("keeps the report out of the single option made when the markers were ignored", () => {
    const result = parseOptions("Sure, see you at three.\n@@used 1");
    expect(result.usedFallback).toBe(true);
    expect(result.options).toEqual([{ variant: "medium", text: "Sure, see you at three." }]);
    expect(result.used).toEqual([1]);
  });
});
