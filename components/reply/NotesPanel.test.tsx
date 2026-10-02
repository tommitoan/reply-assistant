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
      return suggestion ? Response.json({ suggestion }) : Response.json({ error: "Không gợi ý được bản tiếng Anh." }, { status: 502 });
    }
    if (method === "POST" && url === "/api/reply/notes/import-preview") {
      return drafts ? Response.json({ drafts }) : Response.json({ error: "Không tách được nhật ký." }, { status: 502 });
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
  await screen.findByRole("region", { name: "Ghi chú của bạn" });
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
}

const formSection = () => screen.getByRole("region", { name: "Thêm ghi chú" });
const privateBox = () => within(formSection()).getByRole("checkbox", { name: /Riêng tư/ });
const noteBox = () => screen.getByLabelText(/Điều gì đúng về bạn/) as HTMLTextAreaElement;
const englishBox = () => screen.getByLabelText(/Bản tiếng Anh \(dùng để khớp/) as HTMLTextAreaElement;

describe("the notes list", () => {
  it("offers the notes as a JSON download and says private ones are left out", async () => {
    await renderPanel([note({ id: "a" })]);
    const link = await screen.findByRole("link", { name: /Xuất ghi chú của tôi/ });
    expect(link).toHaveAttribute("href", "/api/reply/notes/export");
    expect(link).toHaveAttribute("download");
    expect(link.parentElement).toHaveTextContent("không gồm ghi chú riêng tư");
  });

  it("shows an empty state and no delete-all button", async () => {
    await renderPanel();
    expect(await screen.findByText(/Chưa có ghi chú nào/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa tất cả ghi chú/ })).not.toBeInTheDocument();
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
    expect(screen.getByText("📌 đã ghim")).toBeInTheDocument();
    expect(screen.getByText("sự kiện · 2026-09-01")).toBeInTheDocument();
    const eventCard = screen.getByText("Tháng 9 mình dọn nhà.", { selector: "p" }).closest("article") as HTMLElement;
    expect(within(eventCard).getByText("Chỉ thân mật", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("🔒 riêng tư")).toBeInTheDocument();
    expect(screen.getByText("chưa tìm kiếm được")).toBeInTheDocument();
    expect(screen.getByText(/4 đang dùng · 1 đã ghim · 1 riêng tư/)).toBeInTheDocument();
    expect(screen.getByText(/1 ghi chú chưa tìm kiếm được/)).toBeInTheDocument();
  });

  it("asks the server for the filters that were chosen", async () => {
    await renderPanel([note()]);
    await screen.findByText("Mình làm backend.");
    fireEvent.change(screen.getByLabelText("Lọc theo phạm vi"), { target: { value: "work" } });
    await waitFor(() => expect(listCalls().at(-1)?.url).toContain("scope=work"));
    fireEvent.change(screen.getByLabelText("Lọc theo loại"), { target: { value: "event" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Đã ghim" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hiện ghi chú đã lưu trữ" }));
    await waitFor(() => {
      const url = listCalls().at(-1)!.url;
      expect(url).toContain("kind=event");
      expect(url).toContain("pinned=true");
      expect(url).toContain("status=all");
    });
  });

  it("shows why the list could not be loaded", async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: "Không tải được ghi chú." }, { status: 500 }));
    render(<NotesPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được ghi chú.");
  });
});

describe("adding a note", () => {
  it("suggests an English version and tags, which the writer can adjust before saving", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Tháng 9 mình mới dọn nhà." } });
    fireEvent.click(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ }));

    await waitFor(() => expect(englishBox()).toHaveValue("I moved flat in September."));
    expect(calls.find((c) => c.url === "/api/reply/notes/analyze")?.body).toEqual({ text: "Tháng 9 mình mới dọn nhà." });
    expect(screen.getByLabelText("Ngày xảy ra")).toHaveValue("2026-09-01");

    fireEvent.change(englishBox(), { target: { value: "I moved to a new flat in September." } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));

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
    expect(within(formSection()).getByLabelText("Dùng khi")).toHaveValue("both");
    expect(within(formSection()).getByLabelText("Loại")).toHaveValue("fact");
    expect(await screen.findByText("Tháng 9 mình mới dọn nhà.", { selector: "p" })).toBeInTheDocument();
  });

  it("leaves the English version out when it is empty, so the server writes it", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình thích leo núi." } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(noteBox()).toHaveValue(""));
    expect(privateBox()).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ })).toBeDisabled(); // no text yet
    fireEvent.change(noteBox(), { target: { value: "Chuyện công khai." } });
    expect(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ })).toBeEnabled();
  });

  it("sends the pin choice", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình làm Go." } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Luôn dùng/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() => expect(writes()[0]?.body).toMatchObject({ pinned: true }));
  });

  it("does not offer a model for a private note, and sends nothing but the text", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Chuyện riêng tư." } });
    fireEvent.change(englishBox(), { target: { value: "typed before locking" } });
    fireEvent.click(privateBox());

    expect(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ })).toBeDisabled();
    expect(englishBox()).toBeDisabled();
    expect(englishBox()).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /Luôn dùng/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ text: "Chuyện riêng tư.", private: true, pinned: false });
    expect(writes()[0].body).not.toHaveProperty("textEn");
    expect(calls.some((c) => c.url === "/api/reply/notes/analyze")).toBe(false);
  });

  it("drops a pin that was ticked before the note was made private", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Luôn dùng/ }));
    fireEvent.click(privateBox());
    fireEvent.click(privateBox());
    expect(screen.getByRole("checkbox", { name: /Luôn dùng/ })).not.toBeChecked();
  });

  it("needs some text, and keeps the writer's text when a suggestion fails", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: "Lưu ghi chú" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ })).toBeDisabled();

    suggestion = null;
    fireEvent.change(noteBox(), { target: { value: "Giữ lại nhé." } });
    fireEvent.click(screen.getByRole("button", { name: /Gợi ý bản tiếng Anh/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không gợi ý được bản tiếng Anh.");
    expect(noteBox()).toHaveValue("Giữ lại nhé.");
  });

  it("shows the server's reason when a note cannot be saved, and keeps the form", async () => {
    await renderPanel();
    fireEvent.change(noteBox(), { target: { value: "Mình làm Go." } });
    failNext = { match: /POST \/api\/reply\/notes$/, status: 400, error: "Chỉ ghim được tối đa 20 ghi chú." };
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chỉ ghim được tối đa 20 ghi chú.");
    expect(noteBox()).toHaveValue("Mình làm Go.");
  });
});

describe("importing a diary", () => {
  const importSection = () => screen.getByRole("region", { name: "Nhập từ nhật ký" });
  const pasteDiary = async () => {
    fireEvent.change(within(importSection()).getByLabelText("Nhật ký cần tách thành ghi chú"), { target: { value: "Hôm nay mình đi làm." } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Tách thành ghi chú" }));
    await within(importSection()).findByText(/được đề xuất/);
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
    expect(within(importSection()).getByText(/được gửi cho mô hình để tách/)).toBeInTheDocument();
    expect(within(importSection()).getByRole("button", { name: "Tách thành ghi chú" })).toBeDisabled();
  });

  it("shows the proposed notes and stores nothing yet", async () => {
    await renderPanel();
    await pasteDiary();
    expect(within(importSection()).getAllByLabelText("Nội dung ghi chú")).toHaveLength(3);
    expect(within(importSection()).getByText("3 ghi chú được đề xuất. Bỏ chọn những ghi chú bạn không muốn giữ, và sửa chỗ nào chưa đúng.")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/reply/notes/import-preview")?.body).toEqual({ text: "Hôm nay mình đi làm." });
    expect(writes().every((c) => c.url === "/api/reply/notes/import-preview")).toBe(true);
  });

  it("saves only what is ticked, with the edits, and keeps a private one out of any English version", async () => {
    await renderPanel();
    await pasteDiary();
    const section = importSection();
    const keeps = within(section).getAllByRole("checkbox", { name: /Giữ ghi chú này/ });
    fireEvent.click(keeps[2]); // untick the third
    fireEvent.change(within(section).getAllByLabelText("Nội dung ghi chú")[0], { target: { value: "Mình làm backend Go." } });
    fireEvent.click(within(section).getAllByRole("checkbox", { name: /Riêng tư/ })[1]);
    expect(within(section).getByRole("button", { name: "Lưu 2 ghi chú" })).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Lưu 2 ghi chú" }));
    await waitFor(() => expect(writes().some((c) => c.url === "/api/reply/notes/batch")).toBe(true));
    expect(writes().find((c) => c.url === "/api/reply/notes/batch")?.body).toEqual({
      notes: [
        { text: "Mình làm backend Go.", textEn: "I am a backend engineer.", kind: "fact", scope: "work", private: false, pinned: false },
        { text: "Tháng 9 mình dọn nhà.", kind: "event", happenedOn: "2026-09-01", scope: "casual", private: true, pinned: false },
      ],
    });
    expect(await screen.findByText("Đã lưu 2 ghi chú.")).toBeInTheDocument();
    // Back to the paste step.
    expect(within(importSection()).getByLabelText("Nhật ký cần tách thành ghi chú")).toHaveValue("");
  });

  it("cannot save with nothing ticked, and Cancel goes back without saving", async () => {
    await renderPanel();
    await pasteDiary();
    const section = importSection();
    for (const box of within(section).getAllByRole("checkbox", { name: /Giữ ghi chú này/ })) fireEvent.click(box);
    expect(within(section).getByRole("button", { name: "Lưu 0 ghi chú" })).toBeDisabled();
    fireEvent.click(within(section).getByRole("button", { name: "Hủy" }));
    expect(within(section).getByLabelText("Nhật ký cần tách thành ghi chú")).toBeInTheDocument();
    expect(writes().some((c) => c.url === "/api/reply/notes/batch")).toBe(false);
  });

  it("says so when nothing worth keeping was found", async () => {
    drafts = [];
    await renderPanel();
    fireEvent.change(within(importSection()).getByLabelText("Nhật ký cần tách thành ghi chú"), { target: { value: "xin chào" } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Tách thành ghi chú" }));
    expect(await within(importSection()).findByRole("alert")).toHaveTextContent("không tìm thấy gì đáng giữ");
  });

  it("shows why the diary could not be split and keeps the pasted text", async () => {
    drafts = null;
    await renderPanel();
    fireEvent.change(within(importSection()).getByLabelText("Nhật ký cần tách thành ghi chú"), { target: { value: "Nhật ký" } });
    fireEvent.click(within(importSection()).getByRole("button", { name: "Tách thành ghi chú" }));
    expect(await within(importSection()).findByRole("alert")).toHaveTextContent("Không tách được nhật ký.");
    expect(within(importSection()).getByLabelText("Nhật ký cần tách thành ghi chú")).toHaveValue("Nhật ký");
  });
});

describe("a saved note", () => {
  const card = async () => (await screen.findByText("Mình làm backend.", { selector: "p" })).closest("article") as HTMLElement;

  it("is pinned and unpinned with one click", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "📌 Ghim" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", url: "/api/reply/notes/n1", body: { pinned: true } }]));
    expect(await within(await card()).findByRole("button", { name: "📌 Bỏ ghim" })).toBeInTheDocument();
  });

  it("changes its scope", async () => {
    await renderPanel([note()]);
    fireEvent.change(within(await card()).getByLabelText("Dùng khi"), { target: { value: "work" } });
    await waitFor(() => expect(writes()[0]?.body).toEqual({ scope: "work" }));
  });

  it("is archived and restored", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ status: "archived" }));
    // It leaves the active list.
    await waitFor(() => expect(screen.queryByText("Mình làm backend.", { selector: "p" })).not.toBeInTheDocument());
  });

  it("is made private at once, and then cannot be pinned", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "🔒 Đặt riêng tư" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ private: true }));
    const updated = await card();
    expect(await within(updated).findByRole("button", { name: "🔓 Cho phép dùng" })).toBeInTheDocument();
    expect(within(updated).getByRole("button", { name: "📌 Ghim" })).toBeDisabled();
  });

  it("asks before a private note is made usable, because its text will go to the model", async () => {
    await renderPanel([note({ private: true, textEn: null })]);
    fireEvent.click(within(await card()).getByRole("button", { name: "🔓 Cho phép dùng" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cho phép dùng ghi chú này?" });
    expect(dialog).toHaveTextContent("gửi cho mô hình AI");
    expect(writes()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Giữ riêng tư" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(writes()).toEqual([]);

    fireEvent.click(within(await card()).getByRole("button", { name: "🔓 Cho phép dùng" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cho phép dùng" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ private: false }));
  });

  it("is deleted only after a confirmation", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "Xóa" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Xóa ghi chú này?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Giữ lại" }));
    expect(writes()).toEqual([]);

    fireEvent.click(within(await card()).getByRole("button", { name: "Xóa" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Xóa luôn" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", url: "/api/reply/notes/n1", body: null }]));
    await waitFor(() => expect(screen.queryByText("Mình làm backend.", { selector: "p" })).not.toBeInTheDocument());
  });

  it("is edited, and only what changed is sent", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Sửa" }));
    const article = await card().catch(() => null);
    expect(article).toBeNull(); // the text is now in a box
    const [text, english] = [screen.getByLabelText("Nội dung ghi chú"), screen.getByLabelText("Bản tiếng Anh")];
    fireEvent.change(english, { target: { value: "I build backend services." } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ textEn: "I build backend services." }));
    expect(text).toBeDefined();
  });

  it("is edited with new text, and may lose its English version", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Sửa" }));
    fireEvent.change(screen.getByLabelText("Nội dung ghi chú"), { target: { value: "Mình làm fullstack." } });
    fireEvent.change(screen.getByLabelText("Bản tiếng Anh"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ text: "Mình làm fullstack.", textEn: null }));
  });

  it("makes no request when an edit changes nothing", async () => {
    await renderPanel([note()]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Sửa" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(writes()).toEqual([]);
    expect(await card()).toBeInTheDocument();
  });

  it("has no English box when it is private", async () => {
    await renderPanel([note({ private: true, textEn: null })]);
    fireEvent.click(within(await card()).getByRole("button", { name: "✏️ Sửa" }));
    expect(screen.getByLabelText("Nội dung ghi chú")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bản tiếng Anh")).not.toBeInTheDocument();
  });

  it("shows the server's reason when a change is refused", async () => {
    await renderPanel([note()]);
    failNext = { match: /PATCH/, status: 400, error: "Chỉ ghim được tối đa 20 ghi chú." };
    fireEvent.click(within(await card()).getByRole("button", { name: "📌 Ghim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chỉ ghim được tối đa 20 ghi chú.");
  });
});

describe("deleting every note", () => {
  it("asks first, then deletes them all", async () => {
    await renderPanel([note({ id: "a" }), note({ id: "b", text: "Hai." })]);
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tất cả ghi chú…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Xóa tất cả ghi chú?" });
    expect(dialog).toHaveTextContent("Xóa toàn bộ 2 ghi chú");
    expect(writes()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Giữ lại ghi chú" }));
    expect(writes()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Xóa tất cả ghi chú…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Xóa hết" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", url: "/api/reply/notes?confirm=all", body: null }]));
    expect(await screen.findByText("Đã xóa 2 ghi chú.")).toBeInTheDocument();
    expect(await screen.findByText(/Chưa có ghi chú nào/)).toBeInTheDocument();
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
  const inbox = () => screen.findByRole("region", { name: "Ghi chú gợi ý" });

  it("is not shown when nothing is waiting, and suggestions are not listed among the notes", async () => {
    await renderPanel([note({ id: "a", text: "Mình làm Go." })]);
    expect(screen.queryByRole("region", { name: "Ghi chú gợi ý" })).not.toBeInTheDocument();

    cleanup();
    await renderPanel([waiting()]);
    await inbox();
    const mine = screen.getByRole("region", { name: "Ghi chú của bạn" });
    expect(within(mine).queryByText("Tuần trước mình vừa dọn nhà.")).not.toBeInTheDocument();
  });

  it("shows each suggestion with its English version and a count", async () => {
    await renderPanel([waiting(), waiting({ id: "s2", text: "Mình thích leo núi.", textEn: null })]);
    const region = await inbox();
    expect(within(region).getByRole("heading", { name: /Ghi chú gợi ý \(2\)/ })).toBeInTheDocument();
    expect(within(region).getAllByLabelText("Nội dung ghi chú gợi ý").map((box) => (box as HTMLTextAreaElement).value)).toEqual([
      "Tuần trước mình vừa dọn nhà.",
      "Mình thích leo núi.",
    ]);
    expect(within(region).getAllByLabelText("Bản tiếng Anh của ghi chú gợi ý")[0]).toHaveValue("I moved house last week.");
    expect(region).toHaveTextContent("Chưa có gì được dùng khi trả lời");
  });

  it("adds a suggestion with the chosen scope and pin, sending only what changed, and moves it into the notes", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.change(within(region).getByLabelText("Dùng khi"), { target: { value: "both" } });
    fireEvent.click(within(region).getByRole("checkbox", { name: "Ghim" }));
    fireEvent.click(within(region).getByRole("button", { name: "Thêm vào ghi chú của tôi" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "POST",
      url: "/api/reply/notes/s1/review",
      body: { decision: "approve", changes: { scope: "both", pinned: true } },
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ghi chú gợi ý" })).not.toBeInTheDocument());
    const mine = screen.getByRole("region", { name: "Ghi chú của bạn" });
    expect(await within(mine).findByText("Tuần trước mình vừa dọn nhà.")).toBeInTheDocument();
  });

  it("sends the corrected wording when the writer edits it first", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.change(within(region).getByLabelText("Nội dung ghi chú gợi ý"), { target: { value: "Mình vừa dọn nhà tuần trước." } });
    fireEvent.change(within(region).getByLabelText("Bản tiếng Anh của ghi chú gợi ý"), { target: { value: "" } });
    fireEvent.click(within(region).getByRole("button", { name: "Thêm vào ghi chú của tôi" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ decision: "approve", changes: { text: "Mình vừa dọn nhà tuần trước.", textEn: null } });
  });

  it("dismisses a suggestion and it disappears", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    fireEvent.click(within(region).getByRole("button", { name: "Bỏ qua" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: "/api/reply/notes/s1/review", body: { decision: "dismiss" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ghi chú gợi ý" })).not.toBeInTheDocument());
  });

  it("shows the server's reason when adding is refused, and keeps the suggestion", async () => {
    await renderPanel([waiting()]);
    const region = await inbox();
    failNext = { match: /POST .*review/, status: 400, error: "Chỉ ghim được tối đa 20 ghi chú." };
    fireEvent.click(within(region).getByRole("button", { name: "Thêm vào ghi chú của tôi" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Chỉ ghim được tối đa 20 ghi chú.");
    expect(within(region).getByLabelText("Nội dung ghi chú gợi ý")).toBeInTheDocument();
  });
});
