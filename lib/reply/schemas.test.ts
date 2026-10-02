import { describe, expect, it } from "vitest";
import {
  MAX_DIARY_CHARS,
  MAX_INPUT_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_NOTE_CHARS,
  MAX_NOTE_EN_CHARS,
  MAX_NOTES_PER_BATCH,
} from "./limits";
import {
  firstIssueMessage,
  generateBodySchema,
  conversationCreateSchema,
  conversationPatchSchema,
  generationsLimitSchema,
  generationsScopeSchema,
  optionIdSchema,
  optionPatchSchema,
  refineBodySchema,
  diaryImportSchema,
  noteAnalyzeSchema,
  noteBatchSchema,
  noteFilterSchema,
  noteInputSchema,
  notePatchSchema,
  styleRulesPatchSchema,
  suggestionReviewSchema,
} from "./schemas";

const VALID = { mode: "vi_to_en", input: "Mình sẽ đến muộn.", context: "work" };

describe("generateBodySchema", () => {
  it("accepts a minimal body and fills in defaults", () => {
    expect(generateBodySchema.parse(VALID)).toEqual({
      ...VALID,
      speed: "auto",
      learn: true,
      useMemory: false,
      better: false,
      explain: true,
      useNotes: true,
      excludeNoteIds: [],
    });
  });

  it("takes the notes switch and a list of notes to leave out", () => {
    const id = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";
    expect(generateBodySchema.parse({ ...VALID, useNotes: false, excludeNoteIds: [id] })).toMatchObject({
      useNotes: false,
      excludeNoteIds: [id],
    });
    expect(generateBodySchema.safeParse({ ...VALID, excludeNoteIds: ["nope"] }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, excludeNoteIds: Array.from({ length: 21 }, () => id) }).success).toBe(false);
  });

  it("accepts a better regenerate linked to its parent and rejects a malformed parent id", () => {
    const parentGenerationId = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";
    expect(generateBodySchema.parse({ ...VALID, better: true, parentGenerationId })).toMatchObject({
      better: true,
      parentGenerationId,
    });
    expect(generateBodySchema.safeParse({ ...VALID, parentGenerationId: "not-a-uuid" }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, better: "yes" }).success).toBe(false);
  });

  it("trims the input", () => {
    expect(generateBodySchema.parse({ ...VALID, input: "  hello  \n" }).input).toBe("hello");
  });

  it("rejects blank input with a readable message", () => {
    const result = generateBodySchema.safeParse({ ...VALID, input: "   " });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe("Hãy viết điều bạn muốn nói trước đã.");
  });

  it("accepts input at the limit and rejects it one character over", () => {
    expect(generateBodySchema.safeParse({ ...VALID, input: "a".repeat(MAX_INPUT_CHARS) }).success).toBe(true);
    const over = generateBodySchema.safeParse({ ...VALID, input: "a".repeat(MAX_INPUT_CHARS + 1) });
    expect(over.success).toBe(false);
  });

  it("rejects an unknown context, speed or mode", () => {
    expect(generateBodySchema.safeParse({ ...VALID, context: "family" }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, speed: "turbo" }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, mode: "translate" }).success).toBe(false);
  });

  describe("pasted conversations (en_reply)", () => {
    const CONVERSATION = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";
    const PASTE = { ...VALID, mode: "en_reply", conversationId: CONVERSATION };

    it("needs a conversation to paste into", () => {
      const result = generateBodySchema.safeParse({ ...VALID, mode: "en_reply" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssueMessage(result.error)).toBe("Hãy chọn hoặc tạo một cuộc trò chuyện trước đã.");
      }
    });

    it("accepts a long paste but still limits typed ideas", () => {
      expect(generateBodySchema.safeParse({ ...PASTE, input: "a".repeat(30000) }).success).toBe(true);
      expect(generateBodySchema.safeParse({ ...PASTE, input: "a".repeat(30001) }).success).toBe(false);
      expect(generateBodySchema.safeParse({ ...VALID, input: "a".repeat(4001), conversationId: CONVERSATION }).success).toBe(false);
    });

    it("reports the right limit for each mode", () => {
      const paste = generateBodySchema.safeParse({ ...PASTE, input: "a".repeat(30001) });
      const idea = generateBodySchema.safeParse({ ...VALID, input: "a".repeat(4001) });
      if (paste.success || idea.success) throw new Error("expected both to fail");
      expect(firstIssueMessage(paste.error)).toContain("30000");
      expect(firstIssueMessage(idea.error)).toContain("4000");
    });

    it("lets a typed idea use a thread as context, and rejects a malformed conversation id", () => {
      expect(generateBodySchema.safeParse({ ...VALID, conversationId: CONVERSATION }).success).toBe(true);
      expect(generateBodySchema.safeParse({ ...VALID, conversationId: "nope" }).success).toBe(false);
    });
  });

  it("rejects non-boolean toggles", () => {
    expect(generateBodySchema.safeParse({ ...VALID, learn: "yes" }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, useMemory: 1 }).success).toBe(false);
  });

  it("rejects missing or non-string input", () => {
    expect(generateBodySchema.safeParse({ mode: "vi_to_en", context: "work" }).success).toBe(false);
    expect(generateBodySchema.safeParse({ ...VALID, input: 42 }).success).toBe(false);
  });
});

describe("optionPatchSchema", () => {
  it("accepts a rating, an edit or a chosen mark on its own", () => {
    expect(optionPatchSchema.parse({ rating: "good" })).toEqual({ rating: "good" });
    expect(optionPatchSchema.parse({ editedText: "  Sounds good.  " })).toEqual({ editedText: "Sounds good." });
    expect(optionPatchSchema.parse({ chosen: true })).toEqual({ chosen: true });
  });

  it("accepts several fields at once", () => {
    expect(optionPatchSchema.parse({ rating: "bad", chosen: false })).toEqual({ rating: "bad", chosen: false });
  });

  it("lets null clear a rating or an edit", () => {
    expect(optionPatchSchema.parse({ rating: null })).toEqual({ rating: null });
    expect(optionPatchSchema.parse({ editedText: null })).toEqual({ editedText: null });
  });

  it("rejects a body with nothing to update", () => {
    const result = optionPatchSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe("Không có gì để cập nhật.");
  });

  it("rejects an unknown rating and a non-boolean chosen", () => {
    expect(optionPatchSchema.safeParse({ rating: "great" }).success).toBe(false);
    expect(optionPatchSchema.safeParse({ chosen: "yes" }).success).toBe(false);
  });

  it("rejects a blank edit and an edit over the length limit", () => {
    const blank = optionPatchSchema.safeParse({ editedText: "   " });
    expect(blank.success).toBe(false);
    if (!blank.success) expect(firstIssueMessage(blank.error)).toContain("Hãy viết bản nháp đã sửa trước đã.");
    expect(optionPatchSchema.safeParse({ editedText: "a".repeat(4000) }).success).toBe(true);
    expect(optionPatchSchema.safeParse({ editedText: "a".repeat(4001) }).success).toBe(false);
  });
});

describe("optionIdSchema", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(optionIdSchema.safeParse("0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10").success).toBe(true);
    expect(optionIdSchema.safeParse("12").success).toBe(false);
    expect(optionIdSchema.safeParse("' or 1=1 --").success).toBe(false);
  });
});

describe("generationsLimitSchema", () => {
  it("defaults to 10 when missing or unusable", () => {
    expect(generationsLimitSchema.parse(undefined)).toBe(10);
    expect(generationsLimitSchema.parse("abc")).toBe(10);
    expect(generationsLimitSchema.parse("0")).toBe(10);
    expect(generationsLimitSchema.parse("999")).toBe(10);
  });

  it("accepts a limit from 1 to 50", () => {
    expect(generationsLimitSchema.parse("1")).toBe(1);
    expect(generationsLimitSchema.parse("25")).toBe(25);
    expect(generationsLimitSchema.parse("50")).toBe(50);
  });
});

describe("conversationCreateSchema", () => {
  it("needs a context and defaults the title to empty", () => {
    expect(conversationCreateSchema.parse({ context: "work" })).toEqual({ title: "", context: "work" });
    expect(conversationCreateSchema.safeParse({}).success).toBe(false);
    expect(conversationCreateSchema.safeParse({ context: "family" }).success).toBe(false);
  });

  it("trims the title and limits its length", () => {
    expect(conversationCreateSchema.parse({ title: "  Sprint chat  ", context: "casual" }).title).toBe("Sprint chat");
    expect(conversationCreateSchema.safeParse({ title: "a".repeat(120), context: "work" }).success).toBe(true);
    expect(conversationCreateSchema.safeParse({ title: "a".repeat(121), context: "work" }).success).toBe(false);
  });
});

describe("conversationPatchSchema", () => {
  it("accepts one change at a time, including clearing the title", () => {
    expect(conversationPatchSchema.parse({ title: "New name" })).toEqual({ title: "New name" });
    expect(conversationPatchSchema.parse({ title: "" })).toEqual({ title: "" });
    expect(conversationPatchSchema.parse({ context: "casual" })).toEqual({ context: "casual" });
    expect(conversationPatchSchema.parse({ archived: true })).toEqual({ archived: true });
  });

  it("rejects an empty update and bad values", () => {
    const empty = conversationPatchSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) expect(firstIssueMessage(empty.error)).toBe("Không có gì để cập nhật.");
    expect(conversationPatchSchema.safeParse({ context: "family" }).success).toBe(false);
    expect(conversationPatchSchema.safeParse({ archived: "yes" }).success).toBe(false);
  });
});

describe("generationsScopeSchema", () => {
  it("accepts none or a thread id, and treats anything else as 'all'", () => {
    expect(generationsScopeSchema.parse("none")).toBe("none");
    expect(generationsScopeSchema.parse("0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10")).toBe("0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10");
    expect(generationsScopeSchema.parse(undefined)).toBeUndefined();
    expect(generationsScopeSchema.parse("' or 1=1 --")).toBeUndefined();
  });
});

describe("refineBodySchema", () => {
  const OPTION = "4f1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d44";
  const body = (refine: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({
    refine: { optionId: OPTION, ...refine },
    ...rest,
  });

  it("accepts a Vietnamese direction and fills in defaults", () => {
    expect(refineBodySchema.parse(body({ instruction: "  thêm là mình cũng mới dọn nhà  " }))).toEqual({
      refine: { optionId: OPTION, instruction: "thêm là mình cũng mới dọn nhà" },
      speed: "auto",
      learn: true,
    });
  });

  it("accepts a quick direction alone", () => {
    for (const preset of ["longer", "ask_back", "casual"]) {
      expect(refineBodySchema.safeParse(body({ preset })).success).toBe(true);
    }
  });

  it("needs a direction of some kind", () => {
    const result = refineBodySchema.safeParse(body({}));
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe("Hãy nói bạn muốn mở rộng theo hướng nào, hoặc chọn một hướng gợi ý.");
    expect(refineBodySchema.safeParse(body({ instruction: "   " })).success).toBe(false);
  });

  it("takes the detail from a saved note, which makes the typed one unnecessary", () => {
    const noteId = "7a1c3b0e-8a52-4a67-9d6f-0c8e1b2a3d99";
    expect(refineBodySchema.safeParse(body({ noteId })).success).toBe(true);
    expect(refineBodySchema.safeParse(body({ preset: "personal_detail", noteId })).success).toBe(true);
    expect(refineBodySchema.safeParse(body({ noteId: "nope" })).success).toBe(false);
  });

  it("makes the writer supply a personal detail instead of inventing one", () => {
    expect(refineBodySchema.safeParse(body({ preset: "personal_detail" })).success).toBe(false);
    expect(refineBodySchema.safeParse(body({ preset: "personal_detail", instruction: "mình mới dọn nhà" })).success).toBe(true);
  });

  it("rejects an unknown quick direction and a bad option id", () => {
    expect(refineBodySchema.safeParse(body({ preset: "shorter" })).success).toBe(false);
    expect(refineBodySchema.safeParse({ refine: { optionId: "nope", preset: "longer" } }).success).toBe(false);
  });

  it("limits the length of the direction", () => {
    expect(refineBodySchema.safeParse(body({ instruction: "x".repeat(MAX_INSTRUCTION_CHARS) })).success).toBe(true);
    expect(refineBodySchema.safeParse(body({ instruction: "x".repeat(MAX_INSTRUCTION_CHARS + 1) })).success).toBe(false);
  });

  it("takes speed and learn but ignores anything else a caller sends", () => {
    const parsed = refineBodySchema.parse(
      body({ preset: "longer" }, { speed: "smart", learn: false, mode: "en_reply", conversationId: "x" }),
    );
    expect(parsed).toEqual({ refine: { optionId: OPTION, preset: "longer" }, speed: "smart", learn: false });
  });
});

describe("noteInputSchema", () => {
  it("accepts a note and fills in the defaults", () => {
    expect(noteInputSchema.parse({ text: "  Mình làm backend.  " })).toEqual({
      text: "Mình làm backend.",
      kind: "fact",
      scope: "both",
      private: false,
      pinned: false,
    });
  });

  it("needs some text, and not too much", () => {
    expect(noteInputSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(noteInputSchema.safeParse({ text: "x".repeat(MAX_NOTE_CHARS) }).success).toBe(true);
    expect(noteInputSchema.safeParse({ text: "x".repeat(MAX_NOTE_CHARS + 1) }).success).toBe(false);
  });

  it("tells a missing English version from a removed one", () => {
    expect("textEn" in noteInputSchema.parse({ text: "a" })).toBe(false);
    expect(noteInputSchema.parse({ text: "a", textEn: "  " }).textEn).toBeNull();
    expect(noteInputSchema.parse({ text: "a", textEn: null }).textEn).toBeNull();
    expect(noteInputSchema.parse({ text: "a", textEn: " I work. " }).textEn).toBe("I work.");
    expect(noteInputSchema.safeParse({ text: "a", textEn: "x".repeat(MAX_NOTE_EN_CHARS + 1) }).success).toBe(false);
  });

  it("accepts real dates only", () => {
    expect(noteInputSchema.safeParse({ text: "a", kind: "event", happenedOn: "2026-09-01" }).success).toBe(true);
    expect(noteInputSchema.safeParse({ text: "a", happenedOn: null }).success).toBe(true);
    expect(noteInputSchema.safeParse({ text: "a", happenedOn: "2026-02-30" }).success).toBe(false);
    expect(noteInputSchema.safeParse({ text: "a", happenedOn: "September" }).success).toBe(false);
  });

  it("rejects unknown kinds and scopes", () => {
    expect(noteInputSchema.safeParse({ text: "a", kind: "memory" }).success).toBe(false);
    expect(noteInputSchema.safeParse({ text: "a", scope: "family" }).success).toBe(false);
  });

  it("refuses to pin a private note, with a clear message", () => {
    const result = noteInputSchema.safeParse({ text: "a", private: true, pinned: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toBe("Ghi chú riêng tư không thể ghim vì sẽ không bao giờ được dùng.");
  });

  it("ignores fields it does not know, such as a status or source a caller might send", () => {
    const parsed = noteInputSchema.parse({ text: "a", status: "dismissed", source: "suggested" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("source");
  });
});

describe("noteBatchSchema", () => {
  it("takes a list of notes within the limit", () => {
    expect(noteBatchSchema.safeParse({ notes: [{ text: "a" }, { text: "b", private: true }] }).success).toBe(true);
    expect(noteBatchSchema.safeParse({ notes: [] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_NOTES_PER_BATCH + 1 }, () => ({ text: "a" }));
    expect(noteBatchSchema.safeParse({ notes: tooMany }).success).toBe(false);
  });

  it("rejects the whole batch when one note is invalid", () => {
    expect(noteBatchSchema.safeParse({ notes: [{ text: "a" }, { text: "" }] }).success).toBe(false);
  });
});

describe("notePatchSchema", () => {
  it("needs at least one field", () => {
    expect(notePatchSchema.safeParse({}).success).toBe(false);
    expect(notePatchSchema.safeParse({ pinned: false }).success).toBe(true);
  });

  it("lets null clear the English version and the date, and absent leave them", () => {
    expect(notePatchSchema.parse({ textEn: null, happenedOn: null })).toEqual({ textEn: null, happenedOn: null });
    expect(notePatchSchema.parse({ scope: "work" })).toEqual({ scope: "work" });
  });

  it("only allows the statuses a person can set", () => {
    expect(notePatchSchema.safeParse({ status: "archived" }).success).toBe(true);
    expect(notePatchSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(notePatchSchema.safeParse({ status: "suggested" }).success).toBe(false);
    expect(notePatchSchema.safeParse({ status: "dismissed" }).success).toBe(false);
  });

  it("refuses private and pinned together", () => {
    expect(notePatchSchema.safeParse({ private: true, pinned: true }).success).toBe(false);
    expect(notePatchSchema.safeParse({ private: true, pinned: false }).success).toBe(true);
  });
});

describe("noteAnalyzeSchema and diaryImportSchema", () => {
  it("limit the text of a note and of a diary", () => {
    expect(noteAnalyzeSchema.safeParse({ text: "x".repeat(MAX_NOTE_CHARS + 1) }).success).toBe(false);
    expect(diaryImportSchema.safeParse({ text: "x".repeat(MAX_DIARY_CHARS) }).success).toBe(true);
    const tooLong = diaryImportSchema.safeParse({ text: "x".repeat(MAX_DIARY_CHARS + 1) });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(firstIssueMessage(tooLong.error)).toContain(String(MAX_DIARY_CHARS));
    expect(diaryImportSchema.safeParse({ text: "  " }).success).toBe(false);
  });
});

describe("noteFilterSchema", () => {
  it("defaults to the active notes with no other filter", () => {
    expect(noteFilterSchema.parse({})).toEqual({ status: "active" });
  });

  it("reads the filters the page sends", () => {
    expect(noteFilterSchema.parse({ status: "all", scope: "work", kind: "event", pinned: "true", private: "false" })).toEqual({
      status: "all",
      scope: "work",
      kind: "event",
      pinned: true,
      private: false,
    });
  });

  it("treats an unknown value as no filter", () => {
    expect(noteFilterSchema.parse({ status: "weird", scope: "x", kind: "y", pinned: "maybe" })).toEqual({ status: "active" });
  });
});

describe("suggestionReviewSchema", () => {
  it("accepts a dismissal, and an approval with or without edits", () => {
    expect(suggestionReviewSchema.parse({ decision: "dismiss" })).toEqual({ decision: "dismiss" });
    expect(suggestionReviewSchema.parse({ decision: "approve" })).toEqual({ decision: "approve" });
    expect(
      suggestionReviewSchema.parse({ decision: "approve", changes: { text: "  Mình làm Go. ", textEn: "", scope: "work", pinned: true } }),
    ).toEqual({ decision: "approve", changes: { text: "Mình làm Go.", textEn: null, scope: "work", pinned: true } });
  });

  it("refuses an unknown decision, an empty text and a private note that is pinned", () => {
    expect(suggestionReviewSchema.safeParse({ decision: "archive" }).success).toBe(false);
    expect(suggestionReviewSchema.safeParse({}).success).toBe(false);
    expect(suggestionReviewSchema.safeParse({ decision: "approve", changes: { text: "  " } }).success).toBe(false);
    expect(suggestionReviewSchema.safeParse({ decision: "approve", changes: { private: true, pinned: true } }).success).toBe(false);
  });

  it("cannot be used to set a status: changes carry no status field", () => {
    const parsed = suggestionReviewSchema.parse({ decision: "approve", changes: { status: "archived" } });
    expect(parsed).toEqual({ decision: "approve", changes: {} });
  });
});

describe("styleRulesPatchSchema", () => {
  it("takes a list of rules, kept as written (cleaning happens when saving)", () => {
    expect(styleRulesPatchSchema.parse({ rules: ["Be brief.", "  Say ok. "] })).toEqual({ rules: ["Be brief.", "  Say ok. "] });
    expect(styleRulesPatchSchema.parse({ rules: [] })).toEqual({ rules: [] });
  });

  it("refuses anything that is not a list of text, too many rules and a rule that is too long", () => {
    expect(styleRulesPatchSchema.safeParse({}).success).toBe(false);
    expect(styleRulesPatchSchema.safeParse({ rules: "x" }).success).toBe(false);
    expect(styleRulesPatchSchema.safeParse({ rules: Array.from({ length: 16 }, () => "r") }).success).toBe(false);
    expect(styleRulesPatchSchema.safeParse({ rules: ["x".repeat(241)] }).success).toBe(false);
    expect(styleRulesPatchSchema.safeParse({ rules: ["x".repeat(240)] }).success).toBe(true);
  });
});
