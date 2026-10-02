import { describe, expect, it } from "vitest";
import {
  buildThreadExcerpt,
  EXPORT_INPUT_CHARS,
  EXPORT_THREAD_MESSAGES,
  exportFilename,
  serializeJsonl,
  toExportRecords,
  type ExportRow,
  type ThreadMessageRow,
} from "./export";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 10, minutes));

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    mode: "vi_to_en",
    context: "work",
    inputText: "Mình đến muộn nhé.",
    text: "I'll be late.",
    editedText: null,
    createdAt: at(30),
    conversationId: null,
    refineInstruction: null,
    ...overrides,
  };
}

function message(minutes: number, text: string, author: ThreadMessageRow["author"] = "them", conversationId = "c1"): ThreadMessageRow {
  return { conversationId, author, text, createdAt: at(minutes) };
}

describe("toExportRecords", () => {
  it("exports a liked reply as the model wrote it", () => {
    const [record] = toExportRecords([row()], []);
    expect(record).toEqual({
      mode: "vi_to_en",
      context: "work",
      input: "Mình đến muộn nhé.",
      thread_excerpt: null,
      reply: "I'll be late.",
      is_edited: false,
      created_at: "2026-10-01T10:30:00.000Z",
    });
  });

  it("exports the user's own wording for an edited reply", () => {
    const [record] = toExportRecords([row({ editedText: "I'm running late." })], []);
    expect(record.reply).toBe("I'm running late.");
    expect(record.is_edited).toBe(true);
  });

  it("keeps the newest part of a very long pasted input", () => {
    const [record] = toExportRecords([row({ inputText: `${"old ".repeat(3000)}NEWEST` })], []);
    expect(record.input.length).toBeLessThanOrEqual(EXPORT_INPUT_CHARS + 1);
    expect(record.input.endsWith("NEWEST")).toBe(true);
  });

  it("adds the direction, last, to a developed reply only", () => {
    const [plain, developed] = toExportRecords(
      [row(), row({ refineInstruction: "[longer] thêm là xe buýt chậm" })],
      [],
    );
    expect("instruction" in plain).toBe(false);
    expect(developed.instruction).toBe("[longer] thêm là xe buýt chậm");
    expect(Object.keys(developed).at(-1)).toBe("instruction");
    // The older format is unchanged for original replies.
    expect(Object.keys(plain)).toEqual([
      "mode",
      "context",
      "input",
      "thread_excerpt",
      "reply",
      "is_edited",
      "created_at",
    ]);
  });

  it("adds the thread messages that existed when the request was made", () => {
    const messages = [
      message(1, "Can you join at 3?"),
      message(2, "Let me check.", "me"),
      message(45, "Written after the request."),
    ];
    const [record] = toExportRecords([row({ conversationId: "c1" })], messages);
    expect(record.thread_excerpt).toBe("Them: Can you join at 3?\nMe: Let me check.");
  });

  it("uses only the messages of its own thread", () => {
    const messages = [message(1, "About thread one", "them", "c1"), message(2, "About thread two", "them", "c2")];
    const [record] = toExportRecords([row({ conversationId: "c2" })], messages);
    expect(record.thread_excerpt).toBe("Them: About thread two");
  });

  it("has no excerpt for a thread with no messages yet", () => {
    const [record] = toExportRecords([row({ conversationId: "c9" })], []);
    expect(record.thread_excerpt).toBeNull();
  });
});

describe("buildThreadExcerpt", () => {
  it("keeps only the last few messages", () => {
    const messages = Array.from({ length: 10 }, (_, i) => message(i, `m${i}`));
    const excerpt = buildThreadExcerpt(messages, at(30))!;
    expect(excerpt.split("\n")).toHaveLength(EXPORT_THREAD_MESSAGES);
    expect(excerpt.endsWith("Them: m9")).toBe(true);
    expect(excerpt).not.toContain("m3");
  });

  it("shortens long messages and indents extra lines", () => {
    const excerpt = buildThreadExcerpt([message(1, `line one\nline two ${"x".repeat(400)}`)], at(30))!;
    expect(excerpt).toContain("\n  line two");
    expect(excerpt.endsWith("[…]")).toBe(true);
  });
});

describe("serializeJsonl", () => {
  it("writes one valid JSON object per line, with newlines inside texts escaped", () => {
    const records = toExportRecords([row({ text: "line one\nline two" }), row({ text: "second" })], []);
    const output = serializeJsonl(records);
    const lines = output.trimEnd().split("\n");
    expect(output.endsWith("\n")).toBe(true);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).reply).toBe("line one\nline two");
    expect(JSON.parse(lines[1]).reply).toBe("second");
  });

  it("is empty for no records", () => {
    expect(serializeJsonl([])).toBe("");
  });
});

describe("exportFilename", () => {
  it("is dated, with the timestamp-free JSONL name", () => {
    expect(exportFilename(new Date("2026-10-01T23:59:59Z"))).toBe("reply-export-20261001.jsonl");
  });
});
