import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConversationDetail, ReplyStreamEvent } from "@/lib/reply/types";
import ReplyComposer from "./ReplyComposer";

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

const CONVERSATION: ConversationDetail = {
  id: "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10",
  title: "Sprint chat",
  context: "casual",
  summary: null,
  summaryUptoSeq: null,
  archived: false,
  createdAt: "",
  updatedAt: "",
  messages: [],
};

function ndjson(events: ReplyStreamEvent[]): Response {
  const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

function replyEvents(thread?: { added: number; skipped: number }): ReplyStreamEvent[] {
  return [
    { t: "meta", generationId: "g1", model: "claude-haiku-4-5", tier: "fast", memoryStatus: "off", memories: [], ...(thread ? { thread } : {}) },
    { t: "delta", text: "@@short\nSounds good." },
    {
      t: "done",
      options: [{ id: "o1", variant: "short", text: "Sounds good." }],
      usage: USAGE,
      costUsd: 0.001,
      firstTokenMs: 400,
      totalMs: 900,
      stopReason: "end_turn",
    },
  ];
}

const fetchMock = vi.fn();
// A test can answer /api/reply/generate with its own events.
let eventsFor: ((body: Record<string, unknown>) => ReplyStreamEvent[]) | null = null;
let generateBodies: Array<Record<string, unknown>>;
let generationUrls: string[];

beforeEach(() => {
  window.localStorage.clear();
  eventsFor = null;
  generateBodies = [];
  generationUrls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/reply/generate") {
      generateBodies.push(JSON.parse(init?.body as string));
      const body = generateBodies.at(-1) as Record<string, unknown>;
      if (eventsFor) return ndjson(eventsFor(body));
      return ndjson(replyEvents(body.mode === "en_reply" ? { added: 2, skipped: 1 } : undefined));
    }
    if (url.startsWith("/api/reply/generations")) {
      generationUrls.push(url);
      return Response.json({ generations: [] });
    }
    return new Response(null, { status: 204 }); // the cache warm-up
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(conversation: ConversationDetail | null = CONVERSATION) {
  const onThreadChanged = vi.fn();
  const onContextChange = vi.fn();
  render(<ReplyComposer conversation={conversation} onThreadChanged={onThreadChanged} onContextChange={onContextChange} />);
  return { onThreadChanged, onContextChange };
}

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("ReplyComposer outside a thread (Quick translate)", () => {
  it("only offers the Vietnamese idea box, with the typed-idea limit", () => {
    setup(null);
    expect(screen.queryByRole("group", { name: "What to write" })).not.toBeInTheDocument();
    expect(box()).toHaveAttribute("placeholder", expect.stringContaining("Bạn muốn nói gì"));
    expect(screen.getByText(/0 \/ 4000/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write replies" })).toBeInTheDocument();
  });

  it("offers example ideas to start from; clicking one fills the box and the examples go away", () => {
    setup(null);
    const examples = within(screen.getByRole("group", { name: "Examples" }));
    expect(examples.getAllByRole("button")).toHaveLength(4);
    fireEvent.click(examples.getAllByRole("button")[2]);
    expect(box().value).toContain("Cuối tuần này bạn rảnh không");
    expect(screen.queryByRole("group", { name: "Examples" })).not.toBeInTheDocument();
  });

  it("shows no examples inside a thread where a chat is pasted", () => {
    setup();
    expect(screen.queryByRole("group", { name: "Examples" })).not.toBeInTheDocument();
  });

  it("sends a typed idea with no conversation", async () => {
    setup(null);
    fireEvent.change(box(), { target: { value: "Mình đến muộn nhé." } });
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));
    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(generateBodies[0]).toMatchObject({ mode: "vi_to_en", input: "Mình đến muộn nhé.", context: "work" });
    expect(generateBodies[0].conversationId).toBeUndefined();
  });

  it("changes the context through the settings", () => {
    const { onContextChange } = setup(null);
    fireEvent.click(screen.getByRole("button", { name: /casual/i }));
    expect(onContextChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /casual/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("scopes the recent list to requests made outside threads", async () => {
    setup(null);
    await waitFor(() => expect(generationUrls.length).toBeGreaterThan(0));
    expect(generationUrls[0]).toContain("conversation=none");
  });
});

describe("ReplyComposer inside a thread", () => {
  it("starts in paste mode with the longer limit", () => {
    setup();
    expect(screen.getByRole("button", { name: "📋 Paste their message" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Suggest replies" })).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 30000/)).toBeInTheDocument();
    expect(box()).toHaveAttribute("placeholder", expect.stringContaining("Paste the chat"));
  });

  it("switches to a typed Vietnamese idea", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "✍️ Ý tiếng Việt" }));
    expect(screen.getByRole("button", { name: "Write replies" })).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 4000/)).toBeInTheDocument();
    expect(box()).toHaveAttribute("placeholder", expect.stringContaining("Bạn muốn nói gì"));
  });

  it("allows a long paste but not a long typed idea", () => {
    setup();
    fireEvent.change(box(), { target: { value: "a".repeat(5000) } });
    expect(screen.getByRole("button", { name: "Suggest replies" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "✍️ Ý tiếng Việt" }));
    expect(screen.getByRole("button", { name: "Write replies" })).toBeDisabled();
  });

  it("sends the paste with the conversation and the thread's own context", async () => {
    setup();
    fireEvent.change(box(), { target: { value: "Alice: hey\nSam: hi\nAlice: ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest replies" }));
    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(generateBodies[0]).toMatchObject({
      mode: "en_reply",
      conversationId: CONVERSATION.id,
      // The thread's context wins over the page setting (work).
      context: "casual",
      input: "Alice: hey\nSam: hi\nAlice: ping",
    });
  });

  it("clears the paste, tells the thread to reload, and says what was added", async () => {
    const { onThreadChanged } = setup();
    fireEvent.change(box(), { target: { value: "Alice: hey\nAlice: ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest replies" }));

    expect(await screen.findByText(/Added 2 new messages to the conversation \(1 already there\)/)).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(onThreadChanged).toHaveBeenCalled();
    expect(await screen.findByText("Sounds good.")).toBeInTheDocument();
  });

  it("keeps a typed idea in the box and does not claim anything was added", async () => {
    const { onThreadChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "✍️ Ý tiếng Việt" }));
    fireEvent.change(box(), { target: { value: "Mình đồng ý." } });
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));

    expect(await screen.findByText("Sounds good.")).toBeInTheDocument();
    expect(generateBodies[0]).toMatchObject({ mode: "vi_to_en", conversationId: CONVERSATION.id });
    expect(box()).toHaveValue("Mình đồng ý.");
    expect(screen.queryByText(/new message/)).not.toBeInTheDocument();
    expect(onThreadChanged).not.toHaveBeenCalled();
  });

  it("changes the thread's context instead of the page setting", () => {
    const { onContextChange } = setup();
    expect(screen.getByRole("button", { name: /casual/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /work/i }));
    expect(onContextChange).toHaveBeenCalledWith("work");
    expect(window.localStorage.getItem("reply.settings.v1")).toBeNull();
  });

  it("scopes the recent list to this thread", async () => {
    setup();
    await waitFor(() => expect(generationUrls.length).toBeGreaterThan(0));
    expect(generationUrls[0]).toContain(`conversation=${CONVERSATION.id}`);
  });
});

describe("ReplyComposer with the writer's notes", () => {
  const NOTE_A = { id: "11111111-1111-4111-8111-111111111111", text: "I moved to a new flat in September.", pinned: false };
  const NOTE_B = { id: "22222222-2222-4222-8222-222222222222", text: "I work on Go.", pinned: true };

  function events(over: {
    notes?: Extract<ReplyStreamEvent, { t: "meta" }>["notes"];
    notesUsed?: Array<typeof NOTE_A>;
    options?: Array<{ id: string; variant: "short" | "medium" | "long" | "alt"; text: string }>;
  }): ReplyStreamEvent[] {
    const options = over.options ?? [
      { id: "o1", variant: "short", text: "Moving is hard." },
      { id: "o2", variant: "medium", text: "Moving is exhausting. I just moved too." },
    ];
    return [
      { t: "meta", generationId: "g9", model: "claude-haiku-4-5", tier: "fast", memoryStatus: "off", memories: [], notes: over.notes },
      { t: "delta", text: `@@short\n${options[0].text}` },
      {
        t: "done",
        options,
        usage: USAGE,
        costUsd: 0.001,
        firstTokenMs: 400,
        totalMs: 900,
        stopReason: "end_turn",
        ...(over.notesUsed ? { notesUsed: over.notesUsed } : {}),
      },
    ];
  }

  const pasteAndSend = async () => {
    fireEvent.change(box(), { target: { value: "Alice: It's exhausting when moving to a new place." } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest replies" }));
    await screen.findByText("Moving is hard.");
  };

  it("has the notes switch on and sends it with every request", async () => {
    setup(null);
    expect(screen.getByRole("checkbox", { name: "Use my notes" })).toBeChecked();
    fireEvent.change(box(), { target: { value: "Mình đến muộn nhé." } });
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));
    await waitFor(() => expect(generateBodies).toHaveLength(1));
    expect(generateBodies[0]).toMatchObject({ useNotes: true });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use my notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));
    await waitFor(() => expect(generateBodies).toHaveLength(2));
    expect(generateBodies[1]).toMatchObject({ useNotes: false });
  });

  it("tells which notes a pasted message's replies used", async () => {
    eventsFor = () => events({ notes: { status: "ready", offered: 2, suggestions: [] }, notesUsed: [NOTE_A] });
    setup();
    await pasteAndSend();
    expect(await screen.findByText("Used 1 note")).toBeInTheDocument();
    expect(screen.getByText(NOTE_A.text)).toBeInTheDocument();
  });

  it("writes the replies again without a note when asked, and leaves out every note asked about", async () => {
    eventsFor = () => events({ notes: { status: "ready", offered: 2, suggestions: [] }, notesUsed: [NOTE_A, NOTE_B] });
    setup();
    await pasteAndSend();

    fireEvent.click((await screen.findAllByRole("button", { name: "Don’t use this one" }))[0]);
    await waitFor(() => expect(generateBodies).toHaveLength(2));
    expect(generateBodies[1]).toMatchObject({
      mode: "en_reply",
      excludeNoteIds: [NOTE_A.id],
      parentGenerationId: "g9",
      // The message was explained the first time.
      explain: false,
    });

    fireEvent.click((await screen.findAllByRole("button", { name: "Don’t use this one" }))[1]);
    await waitFor(() => expect(generateBodies).toHaveLength(3));
    expect(generateBodies[2]).toMatchObject({ excludeNoteIds: [NOTE_A.id, NOTE_B.id] });
  });

  it("shows no notes line when the switch was off", async () => {
    eventsFor = () => events({ notes: undefined });
    setup();
    await pasteAndSend();
    expect(screen.queryByText(/Used \d+ note/)).not.toBeInTheDocument();
    expect(screen.queryByText(/available; none fit/)).not.toBeInTheDocument();
  });

  it("suggests notes under a typed idea's medium reply, and adds one with a click", async () => {
    eventsFor = (body) =>
      body.refine
        ? [
            { t: "meta", generationId: "g10", model: "claude-haiku-4-5", tier: "fast", memoryStatus: "off", memories: [] },
            { t: "delta", text: "@@long\nMoving is exhausting. I just moved too, in September." },
            {
              t: "done",
              options: [{ id: "d1", variant: "long", text: "Moving is exhausting. I just moved too, in September." }],
              usage: USAGE,
              costUsd: 0.001,
              firstTokenMs: 300,
              totalMs: 700,
              stopReason: "end_turn",
              notesUsed: [NOTE_A],
            },
          ]
        : events({ notes: { status: "ready", offered: 0, suggestions: [NOTE_A] } });
    setup(null);
    fireEvent.change(box(), { target: { value: "Tôi cũng sống ở chung cư" } });
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));
    await screen.findByText("Moving is hard.");

    const chips = await screen.findByRole("group", { name: "Notes you could add" });
    expect(chips).toHaveTextContent("💡 Add:");
    // Under the medium reply, not the first.
    const medium = screen.getByText("Moving is exhausting. I just moved too.").closest("article") as HTMLElement;
    expect(medium.parentElement?.contains(chips)).toBe(true);
    expect(screen.getByText("Moving is hard.").closest("article")?.parentElement?.contains(chips)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: `Add this note: ${NOTE_A.text}` }));
    await waitFor(() => expect(generateBodies).toHaveLength(2));
    // Only the reply and the note are sent; the detail is read from the stored note.
    expect(generateBodies[1]).toEqual({ refine: { optionId: "o2", noteId: NOTE_A.id }, speed: "auto", learn: true });
    expect(await screen.findByText("Moving is exhausting. I just moved too, in September.")).toBeInTheDocument();
    expect(screen.getByText(`🌱 [personal detail] ${NOTE_A.text}`)).toBeInTheDocument();
  });

  it("offers no chips for a pasted message, or when nothing fits", async () => {
    eventsFor = () => events({ notes: { status: "ready", offered: 2, suggestions: [NOTE_A] } });
    setup();
    await pasteAndSend();
    expect(screen.queryByRole("group", { name: "Notes you could add" })).not.toBeInTheDocument();
    cleanup();

    eventsFor = () => events({ notes: { status: "empty", offered: 0, suggestions: [] } });
    setup(null);
    fireEvent.change(box(), { target: { value: "Mình đến muộn nhé." } });
    fireEvent.click(screen.getByRole("button", { name: "Write replies" }));
    await screen.findByText("Moving is hard.");
    expect(screen.queryByRole("group", { name: "Notes you could add" })).not.toBeInTheDocument();
  });
});
