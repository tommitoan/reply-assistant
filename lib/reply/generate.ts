import type { StreamPart, StreamReplyParams } from "./claude";
import { embedPending } from "./backfill";
import { EMBED_TIMEOUT_MS, type Embedder } from "./embeddings";
import {
  embeddingTextFor,
  excerpt,
  MEMORY_CANDIDATE_LIMIT,
  selectMemories,
  type MemoryExample,
} from "./memory";
import type { MemoryRepo } from "./memory-repo";
import type { ExplainInput, ExplainResult } from "./explain";
import { streamGeneration } from "./generation-stream";
import { chooseNotes, labelledFor, planNotes, toPromptNote, type NotesPlan, type NotesUseDeps } from "./notes-context";
import { toNoteRef, usedNotes } from "./notes-select";
import { buildReplyRequest, THREAD_REPLY_HINT } from "./prompt";
import type { SuggestInput } from "./suggest-run";
import { routeRequest, type RouteModels } from "./router";
import type { ReplyRepo } from "./repo";
import type { GenerateBody } from "./schemas";
import type { ThreadRepo } from "./thread-store";
import { buildTranscript, formatMessage, planSummary, type Transcript } from "./transcript";
import type { ConversationRecord, MemoryStatus, ReplyStreamEvent, StoredMessage } from "./types";

// Examples and the "used memories" list stay short whatever was stored.
const EXAMPLE_INPUT_CHARS = 600;
const MEMORY_REF_INPUT_CHARS = 160;

export interface MemoryDeps {
  // Null when the server has no embedding key. For the lookup a reply waits for.
  embedder: Embedder | null;
  // For indexing nobody waits for; it must not use up the lookups' share of the
  // provider's per-minute limit. Falls back to `embedder`.
  indexer?: Embedder | null;
  repo: MemoryRepo;
  // Runs `task` once the response has been sent, without delaying it.
  afterResponse: (task: () => Promise<void>) => void;
}

export interface ThreadDeps {
  repo: ThreadRepo;
  // Names the writer goes by in pasted chats (REPLY_SELF_NAMES).
  selfNames: readonly string[];
  summarize: (input: { conversationId: string; previous: string | null; transcript: string }) => Promise<string>;
  afterResponse: (task: () => Promise<void>) => void;
}

export interface StyleDeps {
  getActive: () => Promise<{ id: string; rules: string } | null>;
}

export interface ExplainDeps {
  // Resolves null when there is nothing to show; it never rejects the request.
  run: (input: ExplainInput) => Promise<ExplainResult | null>;
  // Keeps the explanation with the request, for the history.
  save: (generationId: string, text: string) => Promise<void>;
}

// Proposes notes from what the writer typed, once the response has been sent.
export interface SuggestHook {
  run: (input: SuggestInput) => Promise<unknown>;
  afterResponse: (task: () => Promise<void>) => void;
}

export interface GenerateDeps {
  repo: ReplyRepo;
  stream: (params: StreamReplyParams) => AsyncGenerator<StreamPart>;
  models: RouteModels;
  dailyBudgetUsd: number;
  memory?: MemoryDeps;
  threads?: ThreadDeps;
  // The switched-on style profile, if any, which joins the cached prefix.
  styles?: StyleDeps;
  // Explains a pasted message beside the replies, when asked for.
  explain?: ExplainDeps;
  // The writer's notes: pinned ones, the ones that fit a pasted message, and
  // suggestions for a typed idea.
  notes?: NotesUseDeps;
  suggest?: SuggestHook;
  now?: () => number;
}

interface ThreadContext {
  conversation: ConversationRecord;
  messages: StoredMessage[];
  transcript: Transcript;
  // The size of the whole thread, not just the part sent word for word.
  totalChars: number;
  update?: { added: number; skipped: number };
}

const totalCharsOf = (messages: StoredMessage[]): number =>
  messages.reduce((sum, message) => sum + message.text.length, 0);

interface ResolvedMemory {
  status: MemoryStatus;
  examples: MemoryExample[];
  // The input's embedding when it was computed on the request path.
  embedding: number[] | null;
}

// Looks up past replies close in meaning to the new input. Any failure means
// "no memory for this request"; it never fails the request itself.
async function resolveMemory(
  body: GenerateBody,
  memory: MemoryDeps | undefined,
  embedding: Promise<number[] | null> | null,
): Promise<ResolvedMemory> {
  if (!body.useMemory) return { status: "off", examples: [], embedding: null };
  if (!memory?.embedder || !embedding) return { status: "unavailable", examples: [], embedding: null };

  const vector = await embedding;
  if (!vector) return { status: "skipped", examples: [], embedding: null };

  try {
    const candidates = await memory.repo.findCandidates(
      vector,
      { mode: body.mode, context: body.context },
      MEMORY_CANDIDATE_LIMIT,
    );
    const examples = selectMemories(candidates);
    return { status: examples.length > 0 ? "used" : "none", examples, embedding: vector };
  } catch (err) {
    console.error("[/api/reply/generate] memory lookup failed", err);
    return { status: "skipped", examples: [], embedding: vector };
  }
}

interface Lookups {
  memory: Promise<number[] | null> | null;
  notes: Promise<number[] | null> | null;
}

// Starts the embedding the memory lookup and the notes search need. When both
// are wanted they go in ONE request to the provider (two texts, or one when
// they are the same), because the provider limits requests per minute.
function startLookups(embedder: Embedder | null, memoryText: string | null, notesText: string | null): Lookups {
  if (!embedder || (!memoryText && !notesText)) return { memory: null, notes: null };
  if (memoryText && notesText && memoryText !== notesText) {
    const both = embedder.embedMany([memoryText, notesText], { timeoutMs: EMBED_TIMEOUT_MS });
    return { memory: both.then((vectors) => vectors?.[0] ?? null), notes: both.then((vectors) => vectors?.[1] ?? null) };
  }
  const one = embedder.embed((memoryText ?? notesText) as string);
  return { memory: memoryText ? one : null, notes: notesText ? one : null };
}

export type StartResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; status: 400 | 404 | 429 | 500; error: string };

// A finished request that may be used as memory later needs its input
// embedding stored. That happens after the response, so it adds no waiting.
// The vector made for the lookup is saved as it is; any request still waiting
// for one (this one, if the lookup was skipped or off) shares ONE request to
// the provider with the others, so a busy minute does not spend one call per
// reply. Requests with "Learn" off are kept but never made findable.
function scheduleEmbeddingStore(
  body: GenerateBody,
  memory: MemoryDeps | undefined,
  generationId: string,
  embedding: number[] | null,
): void {
  const embedder = memory?.embedder;
  if (!memory || !embedder || !body.learn) return;
  const indexer = memory.indexer ?? embedder;
  memory.afterResponse(async () => {
    if (embedding) await memory.repo.saveEmbedding(generationId, embedding, embedder.model);
    await embedPending(memory.repo, indexer);
  });
}

// Loads the thread a request runs in. For a pasted conversation the new part
// is added to the thread first, so a repeated paste only adds what is new.
async function loadThread(
  body: GenerateBody,
  threads: ThreadDeps | undefined,
): Promise<ThreadContext | { error: StartResult }> {
  const missing = (status: 400 | 404, error: string) => ({ error: { ok: false, status, error } as StartResult });
  if (!threads || !body.conversationId) return missing(400, "Conversation threads are not available.");

  if (body.mode === "en_reply") {
    const outcome = await threads.repo.mergePaste(body.conversationId, body.input, threads.selfNames);
    if (!outcome) return missing(404, "That conversation was not found.");
    return {
      conversation: outcome.conversation,
      messages: outcome.messages,
      transcript: buildTranscript(outcome.messages),
      totalChars: totalCharsOf(outcome.messages),
      update: { added: outcome.added, skipped: outcome.skipped },
    };
  }

  const conversation = await threads.repo.getConversation(body.conversationId);
  if (!conversation) return missing(404, "That conversation was not found.");
  const messages = await threads.repo.getMessages(body.conversationId);
  return { conversation, messages, transcript: buildTranscript(messages), totalChars: totalCharsOf(messages) };
}

// Older messages that fell out of the window are folded into the thread
// summary after the response, so the next request can use it.
function scheduleSummary(threads: ThreadDeps | undefined, thread: ThreadContext): void {
  if (!threads) return;
  const plan = planSummary(thread.messages, thread.transcript.firstSeq, thread.conversation.summaryUptoSeq);
  if (!plan) return;
  threads.afterResponse(async () => {
    const summary = await threads.summarize({
      conversationId: thread.conversation.id,
      previous: thread.conversation.summary,
      transcript: plan.messages.map((message) => formatMessage(message)).join("\n"),
    });
    if (summary) await threads.repo.saveSummary(thread.conversation.id, summary, plan.uptoSeq);
  });
}

// Looks for facts about the writer in what they typed, after the response.
export function scheduleSuggestions(hook: SuggestHook | undefined, input: SuggestInput): void {
  if (!hook) return;
  hook.afterResponse(async () => {
    await hook.run(input);
  });
}

// Starts the explanation and sends it as soon as it is ready. Every failure
// ends quietly: the explanation is an extra, never a reason to fail.
function explainInBackground(
  explain: ExplainDeps,
  thread: ThreadContext,
  body: GenerateBody,
  generationId: string,
  send: (event: ReplyStreamEvent) => void,
): Promise<void> {
  return explain
    .run({
      conversationId: thread.conversation.id,
      context: body.context,
      summary: thread.conversation.summary,
      transcript: thread.transcript.text,
      messages: thread.messages,
    })
    .then(async (result) => {
      if (!result) return;
      send({ t: "explain", text: result.text });
      await explain.save(generationId, result.text);
    })
    .catch((err) => {
      console.error("[/api/reply/generate] explanation failed", err);
    });
}

// Checks the daily budget, records the generation, then returns the NDJSON
// stream. Anything that can fail before the first byte (budget, storage) is
// reported here so the route can answer with a proper status code.
export async function startGeneration(
  body: GenerateBody,
  deps: GenerateDeps,
  requestSignal?: AbortSignal,
): Promise<StartResult> {
  const now = deps.now ?? Date.now;

  // Which notes could apply, read before the embedding starts so that one
  // request can serve both the memory lookup and the notes search. Only a
  // database read: with notes off, or none to search, this costs nothing.
  const notesDeps = body.useNotes ? deps.notes : undefined;
  const notesPlan: NotesPlan | null = notesDeps
    ? await planNotes(notesDeps, {
        mode: body.mode,
        context: body.context,
        input: body.input,
        excludeIds: body.excludeNoteIds,
      })
    : null;

  // Started before the checks below, so the embedding call overlaps with them.
  const memoryEmbedder = deps.memory?.embedder ?? null;
  const lookups = startLookups(
    memoryEmbedder ?? notesDeps?.embedder ?? null,
    body.useMemory && memoryEmbedder ? embeddingTextFor(body.mode, body.input) : null,
    notesPlan?.queryText ?? null,
  );
  const embedding = lookups.memory;

  // Read alongside the checks below. A profile that cannot be read is skipped:
  // the replies are then written without it.
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

  if (body.parentGenerationId && !(await deps.repo.generationExists(body.parentGenerationId))) {
    return { ok: false, status: 400, error: "The request to redo was not found." };
  }

  const thread = body.conversationId ? await loadThread(body, deps.threads) : null;
  if (thread && "error" in thread) return thread.error;

  const memory = await resolveMemory(body, deps.memory, embedding);
  const notes =
    notesDeps && notesPlan
      ? await chooseNotes(notesDeps, notesPlan, lookups.notes ? await lookups.notes : null, body.context, body.excludeNoteIds)
      : null;
  // Pinned notes go in the cached prefix; the others in this request. A typed
  // idea is never given notes: they are only suggested.
  const labelled = notes ? labelledFor(notes) : [];
  const pinnedPrompt = notes ? labelled.slice(0, notes.pinned.length).map(toPromptNote) : [];
  const aboutMe = notes ? labelled.slice(notes.pinned.length).map(toPromptNote) : [];
  const style = styleLookup ? await styleLookup : null;
  const route = routeRequest(
    {
      mode: body.mode,
      speed: body.speed,
      better: body.better,
      thread: thread && body.mode === "vi_to_en" ? { transcriptChars: thread.totalChars } : undefined,
      paste:
        thread && body.mode === "en_reply"
          ? { messageCount: thread.transcript.count, chars: thread.transcript.chars }
          : undefined,
      notesOffered: labelled.length > 0,
    },
    deps.models,
  );
  const prompt = buildReplyRequest({
    mode: body.mode,
    context: body.context,
    // The pasted conversation is in the thread already; the input is only a nudge.
    input: body.mode === "en_reply" && thread ? THREAD_REPLY_HINT : body.input,
    styleProfile: style ? { rules: style.rules } : null,
    pinnedNotes: pinnedPrompt,
    aboutMe,
    today: (notesDeps?.now?.() ?? new Date()).toISOString().slice(0, 10),
    thread:
      thread && thread.transcript.count > 0
        ? { summary: thread.conversation.summary, transcript: thread.transcript.text }
        : undefined,
    examples: memory.examples.map(({ input, reply }) => ({
      input: excerpt(input, EXAMPLE_INPUT_CHARS),
      reply,
    })),
  });
  const generationId = await deps.repo.createGeneration({
    mode: body.mode,
    context: body.context,
    inputText: body.input,
    model: route.model,
    tier: route.tier,
    // A "better" request is an explicit ask for the smart model.
    speed: body.better ? "smart" : body.speed,
    learn: body.learn,
    useMemory: body.useMemory,
    parentGenerationId: body.parentGenerationId,
    memoryExampleIds: memory.examples.map((example) => example.optionId),
    conversationId: body.conversationId,
    styleProfileId: style?.id,
  });

  const abort = new AbortController();
  requestSignal?.addEventListener("abort", () => abort.abort(), { once: true });
  const { explain } = deps;

  const stream = streamGeneration({
    repo: deps.repo,
    stream: deps.stream,
    now,
    abort,
    generationId,
    route,
    prompt,
    meta: {
      t: "meta",
      generationId,
      model: route.model,
      tier: route.tier,
      memoryStatus: memory.status,
      memories: memory.examples.map((example) => ({
        id: example.optionId,
        input: excerpt(example.input, MEMORY_REF_INPUT_CHARS),
      })),
      ...(thread?.update ? { thread: thread.update } : {}),
      ...(notes
        ? {
            notes: {
              status: notes.status,
              // What the model may use; a typed idea is only given suggestions.
              offered: body.mode === "en_reply" ? notes.pinned.length + notes.offered.length : 0,
              suggestions: notes.suggestions.map(toNoteRef),
            },
          }
        : {}),
    },
    // Reports which of the offered notes the model says it used (pasted message only).
    resolveUsed:
      notes && body.mode === "en_reply"
        ? (reported) => usedNotes(labelled, reported).map(toNoteRef)
        : undefined,
    // Runs beside the model call, so the replies are not delayed by it.
    background:
      explain && thread && body.mode === "en_reply" && body.explain
        ? (send) => explainInBackground(explain, thread, body, generationId, send)
        : undefined,
    onSaved: () => {
      scheduleEmbeddingStore(body, deps.memory, generationId, memory.embedding);
      // Only a typed idea is the writer's own words; a pasted message never is.
      if (body.learn && body.mode === "vi_to_en") {
        scheduleSuggestions(deps.suggest, { text: body.input, context: body.context });
      }
      if (thread) scheduleSummary(deps.threads, thread);
    },
  });

  return { ok: true, stream };
}
