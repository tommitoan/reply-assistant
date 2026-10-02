import { describe, expect, it } from "vitest";
import {
  PASTE_FAST_MAX_CHARS,
  PASTE_FAST_MAX_MESSAGES,
  THREAD_FAST_MAX_CHARS,
  routeRequest,
} from "./router";

const MODELS = { fast: "fast-model", smart: "smart-model" };

describe("routeRequest", () => {
  it("sends Vietnamese-to-English without a thread to the fast model", () => {
    expect(routeRequest({ mode: "vi_to_en", speed: "auto" }, MODELS)).toEqual({
      tier: "fast",
      model: "fast-model",
    });
  });

  it("keeps a small thread on the fast model and sends a large one to the smart model", () => {
    const small = { transcriptChars: THREAD_FAST_MAX_CHARS - 1 };
    const large = { transcriptChars: THREAD_FAST_MAX_CHARS };
    expect(routeRequest({ mode: "vi_to_en", speed: "auto", thread: small }, MODELS).tier).toBe("fast");
    expect(routeRequest({ mode: "vi_to_en", speed: "auto", thread: large }, MODELS).tier).toBe("smart");
  });

  it("treats a short English exchange as fast and anything else as smart", () => {
    const short = { messageCount: PASTE_FAST_MAX_MESSAGES, chars: PASTE_FAST_MAX_CHARS - 1 };
    const manyMessages = { messageCount: PASTE_FAST_MAX_MESSAGES + 1, chars: 100 };
    const manyChars = { messageCount: 2, chars: PASTE_FAST_MAX_CHARS };
    expect(routeRequest({ mode: "en_reply", speed: "auto", paste: short }, MODELS).tier).toBe("fast");
    expect(routeRequest({ mode: "en_reply", speed: "auto", paste: manyMessages }, MODELS).tier).toBe("smart");
    expect(routeRequest({ mode: "en_reply", speed: "auto", paste: manyChars }, MODELS).tier).toBe("smart");
  });

  it("uses the smart model for an English reply with no size information", () => {
    expect(routeRequest({ mode: "en_reply", speed: "auto" }, MODELS).tier).toBe("smart");
  });

  it("sends an English reply to the smart model when notes about the writer are offered", () => {
    const short = { messageCount: 1, chars: 80 };
    expect(routeRequest({ mode: "en_reply", speed: "auto", paste: short, notesOffered: true }, MODELS).tier).toBe("smart");
    expect(routeRequest({ mode: "en_reply", speed: "auto", paste: short, notesOffered: false }, MODELS).tier).toBe("fast");
    // Notes are never sent with a typed idea, so the flag changes nothing there.
    expect(routeRequest({ mode: "vi_to_en", speed: "auto", notesOffered: true }, MODELS).tier).toBe("fast");
  });

  it("keeps an explicit fast choice even when notes are offered", () => {
    expect(routeRequest({ mode: "en_reply", speed: "fast", notesOffered: true }, MODELS).tier).toBe("fast");
  });

  it("lets an explicit speed choice win over the automatic rules", () => {
    const bigThread = { transcriptChars: THREAD_FAST_MAX_CHARS * 2 };
    expect(routeRequest({ mode: "vi_to_en", speed: "fast", thread: bigThread }, MODELS).tier).toBe("fast");
    expect(routeRequest({ mode: "vi_to_en", speed: "smart" }, MODELS)).toEqual({
      tier: "smart",
      model: "smart-model",
    });
  });

  it("always uses the smart model for a 'better' regenerate", () => {
    expect(routeRequest({ mode: "vi_to_en", speed: "fast", better: true }, MODELS).tier).toBe("smart");
    expect(routeRequest({ mode: "vi_to_en", speed: "auto", better: true }, MODELS).tier).toBe("smart");
  });
});
