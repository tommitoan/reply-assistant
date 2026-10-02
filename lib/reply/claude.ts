import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import { getReplyEnv } from "./env";
import { buildSystemBlocks, type PromptNote, type SystemBlock, type UserMessage } from "./prompt";
import type { ModelTier, ReplyUsage } from "./types";

// Replies are short by design. Thinking tokens on the smart model count
// against its limit, hence the larger ceiling.
export const MAX_TOKENS: Record<ModelTier, number> = { fast: 2000, smart: 4000 };

// Server-side fallback after a safety refusal on the smart model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    // A dedicated key keeps reply spend separate; without one the SDK reads
    // ANTHROPIC_API_KEY from the environment.
    client = new Anthropic({ apiKey: getReplyEnv().REPLY_ANTHROPIC_API_KEY });
  }
  return client;
}

export interface StreamReplyParams {
  tier: ModelTier;
  model: string;
  system: SystemBlock[];
  messages: UserMessage[];
  signal?: AbortSignal;
}

export type StreamPart =
  | { type: "delta"; text: string }
  | {
      type: "final";
      text: string;
      stopReason: string | null;
      usage: ReplyUsage;
      model: string;
    };

// The two SDK stream classes differ in their generics but share this shape.
interface ReplyMessageStream {
  [Symbol.asyncIterator](): AsyncIterator<{ type: string; delta?: unknown }>;
  finalMessage(): Promise<{
    content: Array<{ type: string; text?: string }>;
    stop_reason: string | null;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
  }>;
}

function openStream(params: StreamReplyParams): ReplyMessageStream {
  const { tier, model, system, messages, signal } = params;
  const sdk = getClient();

  if (tier === "fast") {
    // Haiku 4.5 takes no thinking or effort settings here.
    return sdk.messages.stream({ model, max_tokens: MAX_TOKENS.fast, system, messages }, { signal });
  }

  const env = getReplyEnv();
  const body = {
    model,
    max_tokens: MAX_TOKENS.smart,
    system,
    messages,
    thinking: env.REPLY_SMART_THINKING === "between_tools" ? { type: "between_tools" } : { type: "adaptive" },
    output_config: { effort: env.REPLY_SMART_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
  // SDK 0.110 types `fallbacks` as an array only and has no `between_tools`
  // thinking type, but the API accepts both. Cast here until the SDK is
  // upgraded, so the rest of the code stays fully typed.
  return sdk.beta.messages.stream(body as unknown as BetaMessageStreamParams, { signal });
}

function textDeltaOf(event: { type: string; delta?: unknown }): string | null {
  if (event.type !== "content_block_delta") return null;
  const delta = event.delta as { type?: string; text?: string } | undefined;
  return delta?.type === "text_delta" && delta.text ? delta.text : null;
}

// Yields each text delta as it arrives, then one final part with the complete
// text, stop reason and usage.
export async function* streamReply(params: StreamReplyParams): AsyncGenerator<StreamPart> {
  const stream = openStream(params);
  let text = "";
  for await (const event of stream) {
    const delta = textDeltaOf(event);
    if (delta) {
      text += delta;
      yield { type: "delta", text: delta };
    }
  }
  const message = await stream.finalMessage();
  yield {
    type: "final",
    text,
    stopReason: message.stop_reason,
    model: message.model,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

// Writes the cached prefix for the fast model ahead of the first real request.
// `max_tokens: 0` runs the prefill only, so no output tokens are billed.
export async function warmFastCache(
  styleProfile?: { rules: string } | null,
  pinnedNotes?: PromptNote[],
): Promise<{ model: string; usage: ReplyUsage }> {
  const message = await getClient().messages.create({
    model: getReplyEnv().REPLY_MODEL_FAST,
    max_tokens: 0,
    // The same prefix real requests send: the active style profile and the
    // pinned notes of the scope being warmed.
    system: buildSystemBlocks(styleProfile, pinnedNotes),
    messages: [{ role: "user", content: "warmup" }],
  });
  return {
    model: message.model,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

export interface CompletedText {
  text: string;
  model: string;
  usage: ReplyUsage;
}

// One short, non-streaming answer, with what it used. For background work such
// as thread summaries and style profiles, where nobody waits for the first word.
export async function completeTextWithUsage(params: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<CompletedText> {
  const message = await getClient().messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });
  return {
    text: message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim(),
    model: message.model,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

export async function completeText(params: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  return (await completeTextWithUsage(params)).text;
}

export interface DescribedError {
  message: string;
  retryable: boolean;
}

// Maps SDK failures to a message safe to show the user. Details stay in the
// server log.
export function describeClaudeError(err: unknown): DescribedError {
  if (err instanceof Anthropic.APIUserAbortError) {
    return { message: "Cancelled.", retryable: false };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { message: "The reply assistant has no valid API key.", retryable: false };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: "The model is busy right now. Try again in a moment.", retryable: true };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { message: "Could not reach the model. Check the connection and try again.", retryable: true };
  }
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) {
    return { message: "The model had a problem. Try again in a moment.", retryable: true };
  }
  return { message: "Something went wrong while writing the replies.", retryable: false };
}
