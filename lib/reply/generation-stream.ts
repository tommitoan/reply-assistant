import type { StreamPart, StreamReplyParams } from "./claude";
import { describeClaudeError } from "./claude";
import { encodeEvent } from "./ndjson";
import { computeCostUsd } from "./pricing";
import type { SystemBlock, UserMessage } from "./prompt";
import type { ReplyRepo } from "./repo";
import type { Route } from "./router";
import { parseOptions } from "./stream-parser";
import type { NoteRef, ReplyOptionDraft, ReplyStreamEvent } from "./types";

const REFUSAL_MESSAGE = "The model declined to write this one. Try again with ⚡ or 🎯.";
const EMPTY_MESSAGE = "The model did not return any replies. Try again.";

export type MetaEvent = Extract<ReplyStreamEvent, { t: "meta" }>;

export interface GenerationStreamParams {
  repo: ReplyRepo;
  stream: (params: StreamReplyParams) => AsyncGenerator<StreamPart>;
  now: () => number;
  // Aborted when the caller goes away.
  abort: AbortController;
  generationId: string;
  route: Route;
  prompt: { system: SystemBlock[]; messages: [UserMessage] };
  meta: MetaEvent;
  // Keeps only the first N options the model wrote; unset keeps them all.
  maxOptions?: number;
  // Work that runs beside the model call and may send events of its own. The
  // stream stays open until it settles, unless nobody is listening any more.
  background?: (send: (event: ReplyStreamEvent) => void) => Promise<void>;
  // Runs once the options are saved, before the "done" event is sent.
  onSaved?: () => void;
  // Turns the numbers the model gave in its "@@used" line (null when it gave
  // none) into the notes it used. They are saved with the request and sent in
  // the "done" event. Leave it out for a request that offered no notes.
  resolveUsed?: (reported: number[] | null) => NoteRef[];
}

// Sends the NDJSON events of one generation: meta, the text as it arrives,
// then done or error. Storage of the finished options and of any failure
// happens here, so every request type records its outcome the same way.
export function streamGeneration(params: GenerationStreamParams): ReadableStream<Uint8Array> {
  const { repo, now, abort, generationId, route } = params;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ReplyStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          open = false;
        }
      };

      const startedAt = now();
      let firstTokenMs: number | null = null;
      let final: Extract<StreamPart, { type: "final" }> | null = null;
      let background: Promise<void> | null = null;

      try {
        send(params.meta);

        // Runs beside the model call, so the replies are not delayed by it.
        if (params.background) background = params.background(send);

        for await (const part of params.stream({
          tier: route.tier,
          model: route.model,
          system: params.prompt.system,
          messages: params.prompt.messages,
          signal: abort.signal,
        })) {
          if (part.type === "delta") {
            if (firstTokenMs === null) firstTokenMs = now() - startedAt;
            send({ t: "delta", text: part.text });
          } else {
            final = part;
          }
        }
        if (!final) throw new Error("model stream ended without a final message");

        const totalMs = now() - startedAt;
        const costUsd =
          computeCostUsd(final.model, final.usage) ?? computeCostUsd(route.model, final.usage);
        const timing = { firstTokenMs, totalMs, usage: final.usage, costUsd, model: final.model };

        if (final.stopReason === "refusal") {
          await repo.failGeneration(generationId, { status: "refused", ...timing });
          send({ t: "error", message: REFUSAL_MESSAGE, retryable: true });
          return;
        }

        const result = parseOptions(final.text);
        const options: ReplyOptionDraft[] =
          params.maxOptions === undefined ? result.options : result.options.slice(0, params.maxOptions);
        if (options.length === 0) {
          await repo.failGeneration(generationId, { status: "error", ...timing });
          send({ t: "error", message: EMPTY_MESSAGE, retryable: true });
          return;
        }

        const notesUsed = params.resolveUsed?.(result.used);
        const saved = await repo.finishGeneration(generationId, {
          ...timing,
          options,
          ...(notesUsed ? { noteIds: notesUsed.map((note) => note.id) } : {}),
        });
        params.onSaved?.();
        send({
          t: "done",
          options: saved,
          usage: final.usage,
          costUsd,
          firstTokenMs,
          totalMs,
          stopReason: final.stopReason,
          ...(notesUsed ? { notesUsed } : {}),
        });
      } catch (err) {
        const cancelled = abort.signal.aborted;
        const described = describeClaudeError(err);
        if (!cancelled) {
          console.error("[/api/reply/generate]", err);
        } else {
          // A cancel is not an error, but it must not be invisible either: a proxy
          // that drops the connection looks exactly like this from in here.
          console.warn(
            `[/api/reply/generate] stopped: the client disconnected (request ${generationId}, ${now() - startedAt} ms in, ${
              firstTokenMs === null ? "before the first token" : "after the first token"
            })`,
          );
        }
        try {
          await repo.failGeneration(generationId, {
            status: "error",
            firstTokenMs,
            totalMs: now() - startedAt,
          });
        } catch (storeErr) {
          console.error("[/api/reply/generate] could not record the failure", storeErr);
        }
        send({ t: "error", message: described.message, retryable: described.retryable });
      } finally {
        // A late background result is still worth waiting for, unless nobody is listening.
        if (background && !abort.signal.aborted) await background;
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
}
