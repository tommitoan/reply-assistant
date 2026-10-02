import { z } from "zod";
import {
  MAX_DIARY_CHARS,
  MAX_EDIT_CHARS,
  MAX_INPUT_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_NOTE_CHARS,
  MAX_NOTE_EN_CHARS,
  MAX_NOTES_PER_BATCH,
  MAX_PASTE_CHARS,
  MAX_TITLE_CHARS,
} from "./limits";
import { isRealDate } from "./notes-ai";
import { MAX_RULE_CHARS, MAX_RULES } from "./style-profile";
import { NOTE_KINDS, NOTE_SCOPES, REFINE_PRESETS } from "./types";

// vi_to_en is a typed idea; en_reply is a pasted English conversation, which
// only makes sense inside a conversation thread.
export const generateBodySchema = z
  .object({
    mode: z.enum(["vi_to_en", "en_reply"]),
    input: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1, "Hãy viết điều bạn muốn nói trước đã.")),
    context: z.enum(["work", "casual"]),
    speed: z.enum(["auto", "fast", "smart"]).default("auto"),
    learn: z.boolean().default(true),
    useMemory: z.boolean().default(false),
    // "Better" regenerate: always the smart model, linked to the request it redoes.
    better: z.boolean().default(false),
    parentGenerationId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    // For a pasted conversation: also explain the other person's message in Vietnamese.
    explain: z.boolean().default(true),
    // Use the writer's notes: pinned ones, and the ones that fit this message.
    useNotes: z.boolean().default(true),
    // Notes to leave out of this request ("don't use this one", then redo).
    excludeNoteIds: z.array(z.uuid()).max(20).default([]),
  })
  .superRefine((body, ctx) => {
    const limit = body.mode === "en_reply" ? MAX_PASTE_CHARS : MAX_INPUT_CHARS;
    if (body.input.length > limit) {
      ctx.addIssue({ code: "custom", path: ["input"], message: `Hãy giữ dưới ${limit} ký tự.` });
    }
    if (body.mode === "en_reply" && !body.conversationId) {
      ctx.addIssue({
        code: "custom",
        path: ["conversationId"],
        message: "Hãy chọn hoặc tạo một cuộc trò chuyện trước đã.",
      });
    }
  });

export type GenerateBody = z.infer<typeof generateBodySchema>;

// Develop a reply: grow one option in a direction. The server reads the mode,
// context, thread and wording from the stored request, so none of that is sent.
export const refineBodySchema = z
  .object({
    refine: z.object({
      optionId: z.uuid("Không tìm thấy bản nháp này."),
      instruction: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().max(MAX_INSTRUCTION_CHARS, `Hướng mở rộng cần ngắn hơn ${MAX_INSTRUCTION_CHARS} ký tự.`))
        .optional(),
      preset: z.enum(REFINE_PRESETS).optional(),
      // A saved note to take the detail from, instead of a typed one.
      noteId: z.uuid("Không tìm thấy ghi chú này.").optional(),
    }),
    speed: z.enum(["auto", "fast", "smart"]).default("auto"),
    learn: z.boolean().default(true),
  })
  .superRefine((body, ctx) => {
    const { instruction, preset, noteId } = body.refine;
    if (!instruction && !preset && !noteId) {
      ctx.addIssue({
        code: "custom",
        path: ["refine", "instruction"],
        message: "Hãy nói bạn muốn mở rộng theo hướng nào, hoặc chọn một hướng gợi ý.",
      });
    }
    // The model must not invent a personal detail; the writer supplies it.
    if (preset === "personal_detail" && !instruction && !noteId) {
      ctx.addIssue({
        code: "custom",
        path: ["refine", "instruction"],
        message: "Hãy viết chi tiết muốn thêm vào.",
      });
    }
  });

export type RefineBody = z.infer<typeof refineBodySchema>;

export const optionIdSchema = z.uuid("Không tìm thấy bản nháp này.");

export const optionPatchSchema = z
  .object({
    rating: z.enum(["good", "bad"]).nullable().optional(),
    // null puts the model's own text back.
    editedText: z
      .string()
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, "Hãy viết bản nháp đã sửa trước đã.")
          .max(MAX_EDIT_CHARS, `Hãy giữ dưới ${MAX_EDIT_CHARS} ký tự.`),
      )
      .nullable()
      .optional(),
    chosen: z.boolean().optional(),
  })
  .refine(
    (patch) => patch.rating !== undefined || patch.editedText !== undefined || patch.chosen !== undefined,
    "Không có gì để cập nhật.",
  );

export type OptionPatch = z.infer<typeof optionPatchSchema>;

export const generationsLimitSchema = z.coerce.number().int().min(1).max(50).catch(10);

export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Yêu cầu không hợp lệ.";
  // Field names are internal, so the message alone says what to fix. Zod's
  // own wording for a malformed body is English and only reachable by a client
  // that is not this UI, so it is replaced by a generic line.
  if (issue.code === "invalid_type" || issue.code === "invalid_value" || issue.code === "unrecognized_keys") {
    return "Yêu cầu không hợp lệ.";
  }
  return issue.message;
}

const titleSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(MAX_TITLE_CHARS, `Tiêu đề cần ngắn hơn ${MAX_TITLE_CHARS} ký tự.`));

export const conversationCreateSchema = z.object({
  title: titleSchema.default(""),
  context: z.enum(["work", "casual"]),
});

export const conversationPatchSchema = z
  .object({
    title: titleSchema.optional(),
    context: z.enum(["work", "casual"]).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (patch) => patch.title !== undefined || patch.context !== undefined || patch.archived !== undefined,
    "Không có gì để cập nhật.",
  );

export type ConversationPatch = z.infer<typeof conversationPatchSchema>;

// "all", a thread id, or "none" for requests made outside any thread.
export const generationsScopeSchema = z
  .union([z.literal("none"), z.uuid()])
  .optional()
  .catch(undefined);

// Switches one style profile on, or all of them off with null.
export const styleProfilePatchSchema = z.object({ activeId: z.uuid().nullable() });

// The rules of one version, as edited by the writer (the whole list replaces the old one).
export const styleRulesPatchSchema = z.object({
  rules: z
    .array(z.string().max(MAX_RULE_CHARS, `Mỗi quy tắc cần ngắn hơn ${MAX_RULE_CHARS} ký tự.`))
    .max(MAX_RULES, `Chỉ giữ tối đa ${MAX_RULES} quy tắc.`),
});

// ---- Personal notes

const noteTextSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Hãy viết ghi chú trước đã.")
      .max(MAX_NOTE_CHARS, `Mỗi ghi chú cần ngắn hơn ${MAX_NOTE_CHARS} ký tự.`),
  );

// An empty English version means "none".
const noteTextEnSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(MAX_NOTE_EN_CHARS, `Bản tiếng Anh cần ngắn hơn ${MAX_NOTE_EN_CHARS} ký tự.`))
  .transform((value) => (value === "" ? null : value));

const noteDateSchema = z
  .string()
  .refine(isRealDate, "Hãy nhập một ngày có thật (YYYY-MM-DD).")
  .nullable();

const noteKindSchema = z.enum(NOTE_KINDS);
const noteScopeSchema = z.enum(NOTE_SCOPES);

function refusePinnedPrivate(note: { private?: boolean; pinned?: boolean }, ctx: z.RefinementCtx): void {
  // A private note is never used, so pinning it would promise something false.
  if (note.private && note.pinned) {
    ctx.addIssue({ code: "custom", path: ["pinned"], message: "Ghi chú riêng tư không thể ghim vì sẽ không bao giờ được dùng." });
  }
}

export const noteInputSchema = z
  .object({
    text: noteTextSchema,
    textEn: noteTextEnSchema.nullable().optional(),
    kind: noteKindSchema.default("fact"),
    happenedOn: noteDateSchema.optional(),
    scope: noteScopeSchema.default("both"),
    private: z.boolean().default(false),
    pinned: z.boolean().default(false),
  })
  .superRefine(refusePinnedPrivate);

export type NoteInput = z.infer<typeof noteInputSchema>;

export const noteBatchSchema = z.object({
  notes: z
    .array(noteInputSchema)
    .min(1, "Hãy chọn ít nhất một ghi chú.")
    .max(MAX_NOTES_PER_BATCH, `Mỗi lần chỉ lưu tối đa ${MAX_NOTES_PER_BATCH} ghi chú.`),
});

export const notePatchSchema = z
  .object({
    text: noteTextSchema.optional(),
    textEn: noteTextEnSchema.nullable().optional(),
    kind: noteKindSchema.optional(),
    happenedOn: noteDateSchema.optional(),
    scope: noteScopeSchema.optional(),
    private: z.boolean().optional(),
    pinned: z.boolean().optional(),
    // Only these two can be set by hand; "suggested" and "dismissed" belong to the inbox.
    status: z.enum(["active", "archived"]).optional(),
  })
  .superRefine(refusePinnedPrivate)
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Không có gì để cập nhật.");

export type NotePatch = z.infer<typeof notePatchSchema>;

// What the writer can change while approving a suggested note.
const reviewChangesSchema = z
  .object({
    text: noteTextSchema.optional(),
    textEn: noteTextEnSchema.nullable().optional(),
    kind: noteKindSchema.optional(),
    happenedOn: noteDateSchema.optional(),
    scope: noteScopeSchema.optional(),
    private: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .superRefine(refusePinnedPrivate);

export const suggestionReviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), changes: reviewChangesSchema.optional() }),
  z.object({ decision: z.literal("dismiss") }),
]);

export type SuggestionReview = z.infer<typeof suggestionReviewSchema>;

export const noteAnalyzeSchema = z.object({ text: noteTextSchema });

export const diaryImportSchema = z.object({
  text: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Hãy dán nhật ký vào trước đã.")
        .max(MAX_DIARY_CHARS, `Nhật ký cần ngắn hơn ${MAX_DIARY_CHARS} ký tự. Hãy chia thành nhiều phần.`),
    ),
});

// The list filters, read leniently: an unknown value means "no filter".
export const noteFilterSchema = z.object({
  status: z.enum(["active", "archived", "all"]).catch("active"),
  scope: noteScopeSchema.optional().catch(undefined),
  kind: noteKindSchema.optional().catch(undefined),
  pinned: z.stringbool().optional().catch(undefined),
  private: z.stringbool().optional().catch(undefined),
});

export type NoteFilterInput = z.infer<typeof noteFilterSchema>;
