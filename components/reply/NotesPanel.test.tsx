import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NoteDraft, NoteRecord, NoteSuggestion } from "@/lib/reply/types";
import NotesPanel from "./NotesPanel";

const note = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: "n1",
  text: "Mình làm backend.",
  textEn: "I work on backends.",
  kind: "fact",
  happenedOn: null,
  scope: "both",
  private: false,
  pinned: false,
  status: "active",
  source: "manual",
  indexed: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

let notes: NoteRecord[];
let calls: Call[];
let failNext: { match: RegExp; status: number; error: string } | null;
let suggestion: NoteSuggestion | null;
let drafts: NoteDraft[] | null;
let nextId: number;

const fetchMock = vi.fn();

function counts() {
  const live = notes.filter((n) => n.status === "active");
  return {
    active: live.length,
    archived: notes.filter((n) => n.status === "archived").length,
    pinned: live.filter((n) => n.pinned).length,
    private: notes.filter((n) => n.private).length,
    unindexed: notes.filter((n) => !n.indexed).length,
  };
}

beforeEach(() => {
  notes = [];
  calls = [];
  failNext = null;
  nextId = 100;
  suggestion = { textEn: "I moved flat in September.", kind: "event", scope: "casual", happenedOn: "2026-09-01" };
  drafts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
    calls.push({ method, url, body });

    if (failNext && failNext.match.test(`${method} ${url}`)) {
      const { status, error } = failNext;
      failNext = null;
      return Response.json({ error }, { status });
    }

    if (method === "GET" && url.startsWith("/api/reply/notes?")) {
      const params = new URL(url, "http://x").searchParams;
      const status = params.get("status");
      const shown = notes.filter((n) => (status === "all" ? true : n.status === status));
      return Response.json({ notes: shown, counts: counts() });
    }
    if (method === "POST" && url === "/api/reply/notes/analyze") {
      return suggestion ? Response.json({ suggestion }) : Response.json({ error: "Could not suggest an English version." }, { status: 502 });
    }
    if (method === "POST" && url === "/api/reply/notes/import-preview") {
      return drafts ? Response.json({ drafts }) : Response.json({ error: "Could not split the diary." }, { status: 502 });
    }
    if (method === "POST" && url === "/api/reply/notes/batch") {
      const created = (body!.notes as Array<Record<string, unknown>>).map((item) =>
        note({ id: `n${nextId++}`, text: item.text as string, textEn: (item.textEn as string | undefined) ?? null, private: item.private === true }),
      );
      notes.push(...created);
      return Response.json({ notes: created }, { status: 201 });
    }
    if (method === "POST" && url === "/api/reply/notes") {
      const created = note({ id: `n${nextId++}`, text: body!.text as string, textEn: (body!.textEn as string | undefined) ?? null });
      notes.push(created);
      return Response.json({ note: created }, { status: 201 });
    }
    if (method === "DELETE" && url === "/api/reply/notes?confirm=all") {
      const deleted = notes.length;
      notes = [];
      return Response.json({ deleted });
    }
    if (method === "GET" && url === "/api/reply/notes/inbox") {
      const waiting = notes.filter((n) => n.status === "suggested");
      return Response.json({ notes: waiting, count: waiting.length });
    }
    const review = /^\/api\/reply\/notes\/([^/?]+)\/review$/.exec(url);
    if (review && method === "POST") {
      const index = notes.findIndex((n) => n.id === review[1]);
      if (body!.decision === "dismiss") notes[index] = { ...notes[index], status: "dismissed" };
      else notes[index] = { ...notes[index], ...((body!.changes as Partial<NoteRecord>) ?? {}), status: "active" };
      return Response.json({ note: notes[index] });
    }
    const one = /^\/api\/reply\/notes\/([^/?]+)$/.exec(url);
    if (one && method === "PATCH") {
      const index = notes.findIndex((n) => n.id === one[1]);
      notes[index] = { ...notes[index], ...(body as Partial<NoteRecord>) };
      return Response.json({ note: notes[index] });
    }
    if (one && method === "DELETE") {
      notes = notes.filter((n) => n.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const writes = () => calls.filter((c) => c.method !== "GET");
const listCalls = () => calls.filter((c) => c.method === "GET");

async function renderPanel(initial: NoteRecord[] = []) {
  notes = initial;
  render(<NotesPanel />);
  await screen.findByRole("region", { name: "Your notes" });
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
}

const formSection = () => screen.getByRole("region", { name: "Add a note" });
const privateBox = () => within(formSection()).getByRole("checkbox", { name: /Private/ });
const noteBox = () => screen.getByLabelText(/What is true about you/) as HTMLTextAreaElement;
const englishBox = () => screen.getByLabelText(/English version \(used to match/) as HTMLTextAreaElement;

describe("the notes list", () => {
  it("offers the notes as a JSON download and says private ones are left out", async () => {
    await renderPanel([note({ id: "a" })]);
    const link = await screen.findByRole("link", { name: /Export my notes/ });
    expect(link).toHaveAttribute("href", "/api/reply/notes/export");
    expect(link).toHaveAttribute("download");
    expect(link.parentElement).toHaveTextContent("private notes are not included");
  });

  it("shows an empty state and no delete-all button", async () => {
    await renderPanel();
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete all notes/ })).not.toBeInTheDocument();
  });

  it("lists notes with their English version, tags and counts", async () => {
    await renderPanel([
      note({ id: "a", pinned: true, text: "Mình làm backend." }),
      note({ id: "b", text: "Tháng 9 mình dọn nhà.", textEn: "I moved in September.", kind: "event", happenedOn: "2026-09-01", scope: "casual" }),
      note({ id: "c", text: "Chuyện riêng.", textEn: null, private: true }),
      note({ id: "d", text: "Chưa có chỉ mục.", indexed: false }),
    ]);
    expect((await screen.findAllByText("EN: I work on backends.")).length).toBeGreaterThan(0);
    expect(screen.getByText("EN: I moved in September.")).toBeInTheDocument();
    expect(screen.getByText("📌 pinned")).toBeInTheDocument();
    expect(screen.getByText("event · 2026-09-01")).toBeInTheDocument();
    const eventCard = screen.getByText("Tháng 9 mình dọn nhà.", { selector: "p" }).closest("article") as HTMLElement;
    expect(within(eventCard).getByText("Casual only", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("🔒 private")).toBeInTheDocument();
    expect(screen.getByText("not searchable yet")).toBeInTheDocument();
    expect(screen.getByText(/4 active · 1 pinned · 1 private/)).toBeInTheDocument();
    expect(screen.getByText(/1 note is not searchable yet/)).toBeInTheDocument();
  });

  it("asks the server for the filters that were chosen", async () => {
    await renderPanel([note()]);
    await screen.findByText("Mình làm backend.");
    fireEvent.change(screen.getByLabelText("Filter by scope"), { target: { value: "work" } });
    await waitFor(() => expect(listCalls().at(-1)?.url).toContain("scope=work"));
    fireEvent.change(screen.getByLabelText("Filter by kind"), { target: { value: "event" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Pinned" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
    await waitFor(() => {
      const url = listCalls().at(-1)!.url;
      expect(url).toContain("kind=event");
      expect(url).toContain("pinned=true");
      expect(url).toContain("status=all");
    });
  });

  it("shows why the list could not be loaded", async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: "Could not load the notes." }, { status: 500 }));
    render(<NotesPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the notes.");
  });
});

describe("adding a note", () => {
  it("suggests an English version and tags, which the writer can adjust before saving", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Tháng 9 mình mới dọn nhà." } });
    fireEvent.click(screen.getByRole("button", { name: /Suggest English/ }));

    await waitFor(() => expect(englishBox()).toHaveValue("I moved flat in September."));
    expect(calls.find((c) => c.url === "/api/reply/notes/analyze")?.body).toEqual({ text: "Tháng 9 mình mới dọn nhà." });
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-01");

    fireEvent.change(englishBox(), { target: { value: "I moved to a new flat in September." } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(writes().some((c) => c.url === "/api/reply/notes")).toBe(true));
    expect(writes().find((c) => c.url === "/api/reply/notes")?.body).toEqual({
      text: "Tháng 9 mình mới dọn nhà.",
      textEn: "I moved to a new flat in September.",
      kind: "event",
      happenedOn: "2026-09-01",
      scope: "casual",
      private: false,
      pinned: false,
    });
    // The form is ready for the next note and the list shows the new one.
    await waitFor(() => expect(noteBox()).toHaveValue(""));
    expect(within(formSection()).getByLabelText("Use in")).toHaveValue("both");
    expect(within(formSection()).getByLabelText("Kind")).toHaveValue("fact");
    expect(await screen.findByText("Tháng 9 mình mới dọn nhà.", { selector: "p" })).toBeInTheDocument();
  });

  it("leaves the English version out when it is empty, so the server writes it", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình thích leo núi." } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0].body!;
    expect(body).not.toHaveProperty("textEn");
    expect(body).not.toHaveProperty("happenedOn");
    expect(body).toMatchObject({ kind: "fact", scope: "both", private: false, pinned: false });
  });

  it("does not carry a private tick over to the next note", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Chuyện riêng." } });
    fireEvent.click(privateBox());
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(noteBox()).toHaveValue(""));
    expect(privateBox()).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Suggest English/ })).toBeDisabled(); // no text yet
    fireEvent.change(noteBox(), { target: { value: "Chuyện công khai." } });
    expect(screen.getByRole("button", { name: /Suggest English/ })).toBeEnabled();
  });

  it("sends the pin choice", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình làm Go." } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Always use/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(writes()[0]?.body).toMatchObject({ pinned: true }));
  });

  it("does not offer a model for a private note, and sends nothing but the text", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Chuyện riêng tư." } });
    fireEvent.change(englishBox(), { target: { value: "typed before locking" } });
    fireEvent.click(privateBox());

    expect(screen.getByRole("button", { name: /Suggest English/ })).toBeDisabled();
    expect(englishBox()).toBeDisabled();
    expect(englishBox()).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /Always use/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ text: "Chuyện riêng tư.", private: true, pinned: false });
    expect(writes()[0].body).not.toHaveProperty("textEn");
    expect(calls.some((c) => c.url === "/api/reply/notes/analyze")).toBe(false);
  });

  it("drops a pin that was ticked before the note was made private", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Always use/ }));
    fireEvent.click(privateBox());
    fireEvent.click(privateBox());
    expect(screen.getByRole("checkbox", { name: /Always use/ })).not.toBeChecked();
  });

  it("needs some text, and keeps the writer's text when a suggestion fails", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Suggest English/ })).toBeDisabled();

    suggestion = null;
    fireEvent.change(noteBox(), { target: { value: "Giữ lại nhé." } });
    fireEvent.click(screen.getByRole("button", { name: /Suggest English/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not suggest an English version.");
    expect(noteBox()).toHaveValue("Giữ lại nhé.");
  });

  it("shows the server's reason when a note cannot be saved, and keeps the form", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình làm Go." } });
    failNext = { match: /POST \/api\/reply\/notes$/, status: 400, error: "At most 20 notes can be pinned." };
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At most 20 notes can be pinned.");
    expect(noteBox()).toHaveValue("Mình làm Go.");
  });
});

describe("importing a diary", () => {
  const importSection = () => screen.getByRole("region", { name: "Import a diary" });
  const pasteDiary = async () => {
    fireEvent.change(within(importSection()).getByLabelText("The diary to split into notes"), { target: { value: "Hôm nay mình đi làm." } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Split into notes" }));
    await within(importSection()).findByText(/proposed/);
  };

  beforeEach(() => {
    drafts = [
      { text: "Mình làm backend.", textEn: "I am a backend engineer.", kind: "fact", scope: "work", happenedOn: null },
      { text: "Tháng 9 mình dọn nhà.", textEn: "I moved in September.", kind: "event", scope: "casual", happenedOn: "2026-09-01" },
      { text: "Mình thích leo núi.", textEn: null, kind: "fact", scope: "both", happenedOn: null },
    ];
  });

  it("warns that the pasted text goes to a model, and keeps the button off until there is text", async () => {
    await renderPanel();
    expect(within(importSection()).getByText(/sent to the model to split it/)).toBeInTheDocument();
    expect(within(importSection()).getByRole("button", { name: "Split into notes" })).toBeDisabled();
  });

  it("shows the proposed notes and stores nothing yet", async () => {
    await renderPanel();
    await pasteDiary();
    expect(within(importSection()).getAllByLabelText("Note text")).toHaveLength(3);
    expect(within(importSection()).getByText("3 proposed. Untick what you do not want, and fix anything that is wrong.")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/reply/notes/import-preview")?.body).toEqual({ text: "Hôm nay mình đi làm." });
    expect(writes().every((c) => c.url === "/api/reply/notes/import-preview")).toBe(true);
  });

  it("saves only what is ticked, with the edits, and keeps a private one out of any English version", async () => {
    await renderPanel();
    await pasteDiary();
    const section = importSection();
    const keeps = within(section).getAllByRole("checkbox", { name: /Keep this note/ });
    fireEvent.click(keeps[2]); // untick the third
    fireEvent.change(within(section).getAllByLabelText("Note text")[0], { target: { value: "Mình làm backend Go." } });
    fireEvent.click(within(section).getAllByRole("checkbox", { name: /Private/ })[1]);
    expect(within(section).getByRole("button", { name: "Save 2 notes" })).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Save 2 notes" }));
    await waitFor(() => expect(writes().some((c) => c.url === "/api/reply/notes/batch")).toBe(true));
    expect(writes().find((c) => c.url === "/api/reply/notes/batch")?.body).toEqual({
      notes: [
        { text: "Mình làm backend Go.", textEn: "I am a backend engineer.", kind: "fact", scope: "work", private: false, pinned: false },
        { text: "Tháng 9 mình dọn nhà.", kind: "event", happenedOn: "2026-09-01", scope: "casual", private: true, pinned: false },
      ],
    });
    expect(await screen.findByText("Saved 2 notes.")).toBeInTheDocument();
    // Back to the paste step.
    expect(within(importSection()).getByLabelText("The diary to split into notes")).toHaveValue("");
  });

  it("cannot save with nothing ticked, and Cancel goes back without saving", async () => {
    await renderPanel();
    await pasteDiary();
    const section = importSection();
    for (const box of within(section).getAllByRole("checkbox", { name: /Keep this note/ })) fireEvent.click(box);
    expect(within(section).getByRole("button", { name: "Save 0 notes" })).toBeDisabled();
    fireEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    expect(within(section).getByLabelText("The diary to split into notes")).toBeInTheDocument();
    expect(writes().some((c) => c.url === "/api/reply/notes/batch")).toBe(false);
  });

  it("says so when nothing worth keeping was found", async () => {
    drafts = [];
    await renderPanel();
    fireEvent.change(within(importSection()).getByLabelText("The diary to split into notes"), { target: { value: "xin chào" } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Split into notes" }));
    expect(await within(importSection()).findByRole("alert")).toHaveTextContent("nothing worth keeping");
  });

  it("shows why the diary could not be split and keeps the pasted text", async () => {
    drafts = null;
    await renderPanel();
    fireEvent.change(within(importSection()).getByLabelText("The diary to split into notes"), { target: { value: "Nhật ký" } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Split into notes" }));
    expect(await within(importSection()).findByRole("alert")).toHaveTextContent("Could not split the diary.");
    expect(within(importSection()).getByLabelText("The diary to split into notes")).toHaveValue("Nhật ký");
  });
});

describe("a saved note", () => {
  const card = async () => (await screen.findByText("Mình làm backend.", { selector: "p" })).closest("article") as HTMLElement;

  it("is pinned and unpinned with one click", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "📌 Pin" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", url: "/api/reply/notes/n1", body: { pinned: true } }]));
    expect(await within(await card()).findByRole("button", { name: "📌 Unpin" })).toBeInTheDocument();
  });

  it("changes its scope", async () => {
    await renderPanel([note()]);
    fireEvent.change(within(await card()).getByLabelText("Use in"), { target: { value: "work" } });
    await waitFor(() => expect(writes()[0]?.body).toEqual({ scope: "work" }));
  });

  it("is archived and restored", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ status: "archived" }));
    // It leaves the active list.
    await waitFor(() => expect(screen.queryByText("Mình làm backend.", { selector: "p" })).not.toBeInTheDocument());
  });

  it("is made private at once, and then cannot be pinned", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "🔒 Make private" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ private: true }));
    const updated = await card();
    expect(await within(updated).findByRole("button", { name: "🔓 Make usable" })).toBeInTheDocument();
    expect(within(updated).getByRole("button", { name: "📌 Pin" })).toBeDisabled();
  });

  it("asks before a private note is made usable, because its text will go to the model", async () => {
    await renderPanel([note({ private: true, textEn: null })]);
    fireEvent.click(within(await card()).getByRole("button", { name: "🔓 Make usable" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Make this note usable?" });
    expect(dialog).toHaveTextContent("sent to the AI model");
    expect(writes()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep private" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(writes()).toEqual([]);

    fireEvent.click(within(await card()).getByRole("button", { name: "🔓 Make usable" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Make usable" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ private: false }));
  });

  it("is deleted only after a confirmation", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this note?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(writes()).toEqual([]);

    fireEvent.click(within(await card()).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", url: "/api/reply/notes/n1", body: null }]));
    await waitFor(() => expect(screen.queryByText("Mình làm backend.", { selector: "p" })).not.toBeInTheDocument());
  });

  it("is edited, and only what changed is sent", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Edit" }));
    const article = await card().catch(() => null);
    expect(article).toBeNull(); // the text is now in a box
    const [text, english] = [screen.getByLabelText("Note text"), screen.getByLabelText("English version")];
    fireEvent.change(english, { target: { value: "I build backend services." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ textEn: "I build backend services." }));
    expect(text).toBeDefined();
  });

  it("is edited with new text, and may lose its English version", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Edit" }));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "Mình làm fullstack." } });
    fireEvent.change(screen.getByLabelText("English version"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ text: "Mình làm fullstack.", textEn: null }));
  });

  it("makes no request when an edit changes nothing", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(writes()).toEqual([]);
    expect(await card()).toBeInTheDocument();
  });

  it("has no English box when it is private", async () => {
    await renderPanel([note({ private: true, textEn: null })]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Edit" }));
    expect(screen.getByLabelText("Note text")).toBeInTheDocument();
    expect(screen.queryByLabelText("English version")).not.toBeInTheDocument();
  });

  it("shows the server's reason when a change is refused", async () => {
    await renderPanel([note()]);
    failNext = { match: /PATCH/, status: 400, error: "At most 20 notes can be pinned." };
    fireEvent.click(within(await card()).getByRole("button", { name: "📌 Pin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At most 20 notes can be pinned.");
  });
});

describe("deleting every note", () => {
  it("asks first, then deletes them all", async () => {
    await renderPanel([note({ id: "a" }), note({ id: "b", text: "Hai." })]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete all notes…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete every note?" });
    expect(dialog).toHaveTextContent("Delete all 2 notes");
    expect(writes()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep my notes" }));
    expect(writes()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Delete all notes…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", url: "/api/reply/notes?confirm=all", body: null }]));
    expect(await screen.findByText("Deleted 2 notes.")).toBeInTheDocument();
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
  });
});

describe("the inbox of suggested notes", () => {
  const waiting = (over: Partial<NoteRecord> = {}) =>
    note({
      id: "s1",
      text: "Tuần trước mình vừa dọn nhà.",
      textEn: "I moved house last week.",
      status: "suggested",
      source: "suggested",
      scope: "casual",
      ...over,
    });
  const inbox = () => screen.findByRole("region", { name: "Suggested notes" });

  it("is not shown when nothing is waiting, and suggestions are not listed among the notes", async () => {
    await renderPanel([note({ id: "a", text: "Mình làm Go." })]);
    expect(screen.queryByRole("region", { name: "Suggested notes" })).not.toBeInTheDocument();

    cleanup();
    await renderPanel([waiting()]);
    await inbox();
    const mine = screen.getByRole("region", { name: "Your notes" });
    expect(within(mine).queryByText("Tuần trước mình vừa dọn nhà.")).not.toBeInTheDocument();
  });

  it("shows each suggestion with its English version and a count", async () => {
    await renderPanel([waiting(), waiting({ id: "s2", text: "Mình thích leo núi.", textEn: null })]);
    const region = await inbox();
    expect(within(region).getByRole("heading", { name: /Suggested notes \(2\)/ })).toBeInTheDocument();
    expect(within(region).getAllByLabelText("Suggested note").map((box) => (box as HTMLTextAreaElement).value)).toEqual([
      "Tuần trước mình vừa dọn nhà.",
      "Mình thích leo núi.",
    ]);
    expect(within(region).getAllByLabelText("English version of the suggested note")[0]).toHaveValue("I moved house last week.");
    expect(region).toHaveTextContent("Nothing is used in a reply until you add it");
  });

  it("adds a suggestion with the chosen scope and pin, sending only what changed, and moves it into the notes", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.change(within(region).getByLabelText("Use in"), { target: { value: "both" } });
    fireEvent.click(within(region).getByRole("checkbox", { name: "Pin" }));
    fireEvent.click(within(region).getByRole("button", { name: "Add to my notes" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "POST",
      url: "/api/reply/notes/s1/review",
      body: { decision: "approve", changes: { scope: "both", pinned: true } },
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Suggested notes" })).not.toBeInTheDocument());
    const mine = screen.getByRole("region", { name: "Your notes" });
    expect(await within(mine).findByText("Tuần trước mình vừa dọn nhà.")).toBeInTheDocument();
  });

  it("sends the corrected wording when the writer edits it first", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.change(within(region).getByLabelText("Suggested note"), { target: { value: "Mình vừa dọn nhà tuần trước." } });
    fireEvent.change(within(region).getByLabelText("English version of the suggested note"), { target: { value: "" } });
    fireEvent.click(within(region).getByRole("button", { name: "Add to my notes" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ decision: "approve", changes: { text: "Mình vừa dọn nhà tuần trước.", textEn: null } });
  });

  it("dismisses a suggestion and it disappears", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: "/api/reply/notes/s1/review", body: { decision: "dismiss" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Suggested notes" })).not.toBeInTheDocument());
  });

  it("shows the server's reason when adding is refused, and keeps the suggestion", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    failNext = { match: /POST .*review/, status: 400, error: "At most 20 notes can be pinned." };
    fireEvent.click(within(region).getByRole("button", { name: "Add to my notes" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("At most 20 notes can be pinned.");
    expect(within(region).getByLabelText("Suggested note")).toBeInTheDocument();
  });
});
