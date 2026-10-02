import { scheduleSuggestions, type GenerateDeps, type StartResult } from "./generate";
import { streamGeneration } from "./generation-stream";
import { buildReplyRequest } from "./prompt";
import type { NotesReader } from "./notes-read";
import { noteWording, toNoteRef, type UsableNote } from "./notes-select";
import { storedDirection } from "./refine-directions";
import { routeRequest } from "./router";
import type { RefineBody } from "./schemas";
import type { ThreadRepo } from "./thread-store";
import { buildTranscript } from "./transcript";

// A developed version is two replies, not four.
export const REFINE_OPTION_COUNT = 2;

export type RefineDeps = Pick<GenerateDeps, "repo" | "stream" | "models" | "dailyBudgetUsd" | "styles" | "suggest" | "now"> & {
  threads?: { repo: Pick<ThreadRepo, "getConversation" | "getMessages"> };
  // Needed to develop a reply with one of the writer's saved notes.
  notes?: { reader: Pick<NotesReader, "getUsable"> };
};

// How much of a note is kept as the direction of a reply developed with it.
const NOTE_DIRECTION_CHARS = 200;

// Develops one reply in the direction the writer gave. The mode, context,
// thread and wording come from the stored request, never from the caller, so
// a developed reply always stays inside the conversation it belongs to.
export async function startRefinement(
  body: RefineBody,
  deps: RefineDeps,
  requestSignal?: AbortSignal,
): Promise<StartResult> {
  const now = deps.now ?? Date.now;
  const { optionId, instruction, noteId } = body.refine;
  // A note supplies a personal detail, so that is the default direction for one.
  const preset = body.refine.preset ?? (noteId ? "personal_detail" : undefined);

  // Read alongside the checks below, as for a normal request.
  const styleLookup = deps.styles
    ? deps.styles.getActive().catch((err) => {
        console.error("[/api/reply/generate] style profile lookup failed", err);
        return null;
      })
    : null;

  const spent = await deps.repo.spentTodayUsd(new Date(now()));
  if (spent >= deps.dailyBudgetUsd) {
    return {
      ok: false,
      status: 429,
      error: "The daily spending limit for replies is reached. It resets at 00:00 UTC.",
    };
  }

  const base = await deps.repo.getRefineBase(optionId);
  if (!base) return { ok: false, status: 404, error: "That reply was not found." };
  // One level only: a developed version is chosen against its original, and
  // the original's options are what the writer develops.
  if (base.developed) {
    return { ok: false, status: 400, error: "Develop the original reply, not a developed version of it." };
  }

  let thread: { summary: string | null; transcript: string; chars: number; count: number } | null = null;
  if (base.conversationId) {
    if (!deps.threads) return { ok: false, status: 400, error: "Conversation threads are not available." };
    const conversation = await deps.threads.repo.getConversation(base.conversationId);
    if (!conversation) return { ok: false, status: 404, error: "That conversation was not found." };
    const messages = await deps.threads.repo.getMessages(base.conversationId);
    const transcript = buildTranscript(messages);
    thread = {
      summary: conversation.summary,
      transcript: transcript.text,
      count: transcript.count,
      chars: messages.reduce((sum, message) => sum + message.text.length, 0),
    };
  }

  // The note must be one this reply may use: active, not private, and of this
  // reply's context. The detail comes from the stored note, never from the caller.
  let note: UsableNote | null = null;
  if (noteId) {
    if (!deps.notes) return { ok: false, status: 400, error: "Notes are not available." };
    try {
      note = await deps.notes.reader.getUsable(noteId, { context: base.context });
    } catch (err) {
      console.error("[/api/reply/generate] could not read the note", err);
      return { ok: false, status: 500, error: "Could not read that note. Try again." };
    }
    if (!note) return { ok: false, status: 404, error: "That note was not found, or it cannot be used here." };
  }

  const style = styleLookup ? await styleLookup : null;
  const route = routeRequest(
    {
      mode: "vi_to_en",
      speed: body.speed,
      thread: thread ? { transcriptChars: thread.chars } : undefined,
    },
    deps.models,
  );
  const prompt = buildReplyRequest({
    mode: base.mode,
    context: base.context,
    input: "",
    styleProfile: style ? { rules: style.rules } : null,
    thread: thread && thread.count > 0 ? { summary: thread.summary, transcript: thread.transcript } : undefined,
    refine: {
      baseReply: base.text,
      instruction,
      preset,
      // A pasted conversation is already in the thread; only a typed idea is extra.
      originalIdea: base.mode === "vi_to_en" ? base.inputText : null,
      noteDetail: note ? noteWording(note) : null,
    },
  });

  const generationId = await deps.repo.createGeneration({
    mode: base.mode,
    context: base.context,
    inputText: base.inputText,
    model: route.model,
    tier: route.tier,
    speed: body.speed,
    // A developed reply is learnable only if the request it grew from was.
    learn: body.learn && base.learn,
    useMemory: false,
    conversationId: base.conversationId ?? undefined,
    styleProfileId: style?.id,
    refineOfOptionId: base.optionId,
    // With a note, its wording is the direction kept for learning.
    refineInstruction: storedDirection(
      preset,
      instruction ?? (note ? noteWording(note).slice(0, NOTE_DIRECTION_CHARS) : undefined),
    ),
  });

  const abort = new AbortController();
  requestSignal?.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = streamGeneration({
    repo: deps.repo,
    stream: deps.stream,
    now,
    abort,
    generationId,
    route,
    fallbackRoute: route.tier === "smart" ? { tier: "fast", model: deps.models.fast } : undefined,
    prompt,
    maxOptions: REFINE_OPTION_COUNT,
    // The note the reply was developed with is the note it used.
    resolveUsed: note ? () => [toNoteRef(note)] : undefined,
    // The direction the writer typed is their own words, so it may hold a fact about them.
    onSaved: () => {
      if (body.learn && base.learn && instruction) {
        scheduleSuggestions(deps.suggest, { text: instruction, context: base.context });
      }
    },
    meta: {
      t: "meta",
      generationId,
      model: route.model,
      tier: route.tier,
      memoryStatus: "off",
      memories: [],
    },
  });
  return { ok: true, stream };
}
