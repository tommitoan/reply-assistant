// The embedding provider limits how many requests and tokens an account may
// use per minute, and an account without a payment method gets very little
// (3 requests and 10,000 tokens). This module keeps the app inside that budget
// by itself, so a call that would be refused is not made at all.
//
// Two lanes share the budget. A reply or a note save is "foreground": someone
// is waiting, so it may use all of it. Indexing in the background may not use
// the last request or the last part of the tokens, so it can never make a
// foreground call fail.

export type EmbedLane = "foreground" | "background";

export interface EmbedBudget {
  // Requests and tokens allowed in any 60 seconds.
  rpm: number;
  tpm: number;
}

export const WINDOW_MS = 60_000;
// Background work keeps this share of the tokens free for foreground calls.
const BACKGROUND_TOKEN_SHARE = 0.7;

// A deliberately pessimistic count: Vietnamese text can cost a token for every
// two characters, and being over is harmless while being under is a refused call.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

export interface EmbedLimiter {
  // Records the call and returns true when it fits the budget; false (and
  // nothing recorded) when it does not.
  tryAcquire(lane: EmbedLane, tokens: number): boolean;
  // Milliseconds until such a call would fit, 0 when it fits now, Infinity when
  // it can never fit (larger than the whole token budget).
  waitMs(lane: EmbedLane, tokens: number): number;
}

interface Use {
  at: number;
  tokens: number;
}

export function createEmbedLimiter(budget: EmbedBudget, now: () => number = Date.now): EmbedLimiter {
  let uses: Use[] = [];

  const prune = () => {
    const cutoff = now() - WINDOW_MS;
    uses = uses.filter((use) => use.at > cutoff);
  };

  // What a lane may use: background keeps one request and a share of the tokens
  // back, whenever the budget has more than one request to begin with.
  const caps = (lane: EmbedLane) =>
    lane === "foreground" || budget.rpm < 2
      ? { rpm: budget.rpm, tpm: budget.tpm }
      : { rpm: budget.rpm - 1, tpm: Math.floor(budget.tpm * BACKGROUND_TOKEN_SHARE) };

  return {
    tryAcquire(lane, tokens) {
      if (this.waitMs(lane, tokens) !== 0) return false;
      uses.push({ at: now(), tokens });
      return true;
    },

    waitMs(lane, tokens) {
      prune();
      const cap = caps(lane);
      if (cap.rpm < 1 || tokens > cap.tpm) return Infinity;

      // Count what is still inside the window as time passes, until the call fits.
      let calls = uses.length;
      let used = uses.reduce((sum, use) => sum + use.tokens, 0);
      if (calls < cap.rpm && used + tokens <= cap.tpm) return 0;
      for (const use of uses) {
        calls -= 1;
        used -= use.tokens;
        if (calls < cap.rpm && used + tokens <= cap.tpm) return Math.max(0, use.at + WINDOW_MS - now()) + 1;
      }
      return Infinity;
    },
  };
}

// Splits texts into groups that each stay under a token budget, keeping their
// order. A text larger than the budget still gets a group of its own.
export function chunkByTokens(texts: string[], maxTokens: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const size = estimateTokens(text);
    if (current.length > 0 && tokens + size > maxTokens) {
      chunks.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// What one embedding request may carry: well under the per-minute token budget,
// so a second request in the same minute still has room.
export function requestTokenBudget(tpm: number): number {
  return Math.max(500, Math.floor(tpm * 0.5));
}

// What one embedding request carries by default: half of what an account
// without a payment method may use in a minute, so a second request in the same
// minute still fits.
export const DEFAULT_REQUEST_TOKENS = 5000;
