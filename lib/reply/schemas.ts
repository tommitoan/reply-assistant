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
      .pipe(z.string().min(1, "Write what you want to say first.")),
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
      ctx.addIssue({ code: "custom", path: ["input"], message: `Keep it under ${limit} characters.` });
    }
    if (body.mode === "en_reply" && !body.conversationId) {
      ctx.addIssue({
        code: "custom",
        path: ["conversationId"],
        message: "Choose or start a conversation first.",
      });
    }
  });

export type GenerateBody = z.infer<typeof generateBodySchema>;

// Develop a reply: grow one option in a direction. The server reads the mode,
// context, thread and wording from the stored request, so none of that is sent.
export const refineBodySchema = z
  .object({
    refine: z.object({
      optionId: z.uuid("That reply was not found."),
      instruction: z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().max(MAX_INSTRUCTION_CHARS, `Keep the direction under ${MAX_INSTRUCTION_CHARS} characters.`))
        .optional(),
      preset: z.enum(REFINE_PRESETS).optional(),
      // A saved note to take the detail from, instead of a typed one.
      noteId: z.uuid("That note was not found.").optional(),
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
        message: "Say how to develop it, or choose a quick direction.",
      });
    }
    // The model must not invent a personal detail; the writer supplies it.
    if (preset === "personal_detail" && !instruction && !noteId) {
      ctx.addIssue({
        code: "custom",
        path: ["refine", "instruction"],
        message: "Write the detail to add.",
      });
    }
  });

export type RefineBody = z.infer<typeof refineBodySchema>;

export const optionIdSchema = z.uuid("That reply was not found.");

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
          .min(1, "Write the edited reply first.")
          .max(MAX_EDIT_CHARS, `Keep it under ${MAX_EDIT_CHARS} characters.`),
      )
      .nullable()
      .optional(),
    chosen: z.boolean().optional(),
  })
  .refine(
    (patch) => patch.rating !== undefined || patch.editedText !== undefined || patch.chosen !== undefined,
    "Nothing to update.",
  );

export type OptionPatch = z.infer<typeof optionPatchSchema>;

export const generationsLimitSchema = z.coerce.number().int().min(1).max(50).catch(10);

export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

const titleSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(MAX_TITLE_CHARS, `Keep the title under ${MAX_TITLE_CHARS} characters.`));

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
    "Nothing to update.",
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
    .array(z.string().max(MAX_RULE_CHARS, `Keep each rule under ${MAX_RULE_CHARS} characters.`))
    .max(MAX_RULES, `Keep at most ${MAX_RULES} rules.`),
});

// ---- Personal notes

const noteTextSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Write the note first.")
      .max(MAX_NOTE_CHARS, `Keep a note under ${MAX_NOTE_CHARS} characters.`),
  );

// An empty English version means "none".
const noteTextEnSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(MAX_NOTE_EN_CHARS, `Keep the English version under ${MAX_NOTE_EN_CHARS} characters.`))
  .transform((value) => (value === "" ? null : value));

const noteDateSchema = z
  .string()
  .refine(isRealDate, "Use a real date (YYYY-MM-DD).")
  .nullable();

const noteKindSchema = z.enum(NOTE_KINDS);
const noteScopeSchema = z.enum(NOTE_SCOPES);

function refusePinnedPrivate(note: { private?: boolean; pinned?: boolean }, ctx: z.RefinementCtx): void {
  // A private note is never used, so pinning it would promise something false.
  if (note.private && note.pinned) {
    ctx.addIssue({ code: "custom", path: ["pinned"], message: "A private note cannot be pinned: it is never used." });
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
    .min(1, "Choose at least one note.")
    .max(MAX_NOTES_PER_BATCH, `Save at most ${MAX_NOTES_PER_BATCH} notes at once.`),
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
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to update.");

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
        .min(1, "Paste the diary first.")
        .max(MAX_DIARY_CHARS, `Keep the diary under ${MAX_DIARY_CHARS} characters. Split it in parts.`),
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
