import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ReplyDb } from "./db";
import { generations, replyOptions, styleProfiles } from "./schema";
import { EVIDENCE_LIMITS, type ProfileEvidence } from "./style-profile";
import type { StyleProfileRecord } from "./types";

export interface NewStyleProfile {
  rules: string;
  model: string;
  sourceCounts: StyleProfileRecord["sourceCounts"];
}

export interface StyleProfileRepo {
  // The profile whose rules go into the prompt, if one is switched on.
  getActive(): Promise<{ id: string; rules: string } | null>;
  // Newest first, each with its version number.
  list(limit: number): Promise<StyleProfileRecord[]>;
  // A new profile starts switched off, so it can be read before it is used.
  create(input: NewStyleProfile): Promise<StyleProfileRecord>;
  // Switches one profile on and every other off; null switches all off.
  // Resolves false when the id does not exist.
  setActive(id: string | null): Promise<boolean>;
  // Replaces the rules of a version that is not in use. A version in use is
  // refused ("active"): its rules are in every prompt, so it is switched off first.
  updateRules(id: string, rules: string): Promise<"updated" | "active" | "missing">;
  latestCreatedAt(): Promise<Date | null>;
  collectEvidence(): Promise<ProfileEvidence>;
}

type Row = typeof styleProfiles.$inferSelect;

function toRecord(row: Row, version: number): StyleProfileRecord {
  return {
    id: row.id,
    version,
    rules: row.rules,
    model: row.model,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    sourceCounts: row.sourceCounts as StyleProfileRecord["sourceCounts"],
  };
}

// Keeps a typed idea as context, and drops the pasted conversations of other
// people, which must never reach a prompt that is written from this data.
const ideaOf = (mode: string, inputText: string): string | null => (mode === "vi_to_en" ? inputText : null);

export function createStyleProfileRepo(db: ReplyDb): StyleProfileRepo {
  return {
    async getActive() {
      const [row] = await db
        .select({ id: styleProfiles.id, rules: styleProfiles.rules })
        .from(styleProfiles)
        .where(eq(styleProfiles.active, true))
        .limit(1);
      return row ?? null;
    },

    async list(limit) {
      const rows = await db.select().from(styleProfiles).orderBy(asc(styleProfiles.createdAt));
      return rows
        .map((row, index) => toRecord(row, index + 1))
        .reverse()
        .slice(0, limit);
    },

    async create({ rules, model, sourceCounts }) {
      const [row] = await db.insert(styleProfiles).values({ rules, model, sourceCounts, active: false }).returning();
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(styleProfiles);
      return toRecord(row, Number(count));
    },

    async setActive(id) {
      return db.transaction(async (tx) => {
        if (id !== null) {
          const [found] = await tx.select({ id: styleProfiles.id }).from(styleProfiles).where(eq(styleProfiles.id, id));
          if (!found) return false;
        }
        await tx.update(styleProfiles).set({ active: false }).where(eq(styleProfiles.active, true));
        if (id !== null) await tx.update(styleProfiles).set({ active: true }).where(eq(styleProfiles.id, id));
        return true;
      });
    },

    async updateRules(id, rules) {
      const updated = await db
        .update(styleProfiles)
        .set({ rules })
        .where(and(eq(styleProfiles.id, id), eq(styleProfiles.active, false)))
        .returning({ id: styleProfiles.id });
      if (updated.length > 0) return "updated";
      const [found] = await db.select({ id: styleProfiles.id }).from(styleProfiles).where(eq(styleProfiles.id, id));
      return found ? "active" : "missing";
    },

    async latestCreatedAt() {
      const [row] = await db
        .select({ createdAt: styleProfiles.createdAt })
        .from(styleProfiles)
        .orderBy(desc(styleProfiles.createdAt))
        .limit(1);
      return row?.createdAt ?? null;
    },

    async collectEvidence() {
      // Only requests kept for learning, and finished ones.
      const learnable = and(eq(generations.learn, true), eq(generations.status, "done"));
      // Developed versions are learned from as a group (reply, direction, result),
      // so the three plain lists leave them out.
      const original = and(learnable, isNull(generations.refineInstruction));
      const base = () =>
        db
          .select({
            text: replyOptions.text,
            editedText: replyOptions.editedText,
            mode: generations.mode,
            inputText: sql<string>`left(${generations.inputText}, 500)`,
          })
          .from(replyOptions)
          .innerJoin(generations, eq(replyOptions.generationId, generations.id));

      const edited = await base()
        .where(and(original, isNotNull(replyOptions.editedText)))
        .orderBy(desc(replyOptions.createdAt))
        .limit(EVIDENCE_LIMITS.edited);
      const liked = await base()
        .where(and(original, eq(replyOptions.rating, "good"), isNull(replyOptions.editedText)))
        .orderBy(desc(replyOptions.ratedAt))
        .limit(EVIDENCE_LIMITS.liked);
      const disliked = await base()
        .where(and(original, eq(replyOptions.rating, "bad"), isNull(replyOptions.editedText)))
        .orderBy(desc(replyOptions.ratedAt))
        .limit(EVIDENCE_LIMITS.disliked);

      // A developed version counts when the writer picked, edited or liked it.
      const baseOption = alias(replyOptions, "base_option");
      const refined = await db
        .select({
          text: replyOptions.text,
          editedText: replyOptions.editedText,
          baseText: baseOption.text,
          baseEditedText: baseOption.editedText,
          direction: generations.refineInstruction,
        })
        .from(replyOptions)
        .innerJoin(generations, eq(replyOptions.generationId, generations.id))
        .innerJoin(baseOption, eq(generations.refineOfOptionId, baseOption.id))
        .where(
          and(
            learnable,
            isNotNull(generations.refineInstruction),
            or(isNotNull(replyOptions.editedText), eq(replyOptions.chosen, true), eq(replyOptions.rating, "good")),
          ),
        )
        .orderBy(desc(replyOptions.createdAt))
        .limit(EVIDENCE_LIMITS.refined);

      return {
        edited: edited.map((row) => ({
          original: row.text,
          edited: row.editedText ?? row.text,
          idea: ideaOf(row.mode, row.inputText),
        })),
        liked: liked.map((row) => ({ reply: row.text, idea: ideaOf(row.mode, row.inputText) })),
        disliked: disliked.map((row) => ({ reply: row.text })),
        refined: refined.map((row) => ({
          before: row.baseEditedText ?? row.baseText,
          direction: row.direction ?? "",
          after: row.editedText ?? row.text,
        })),
      };
    },
  };
}
