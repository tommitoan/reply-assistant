import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConversationDetail, ConversationListItem, RecentGeneration } from "@/lib/reply/types";
import ReplyWorkspace from "./ReplyWorkspace";

const ID = "0b6f2f4e-8d1c-4a55-9a7e-3f1d2c9b8a10";
const NEW_ID = "1c7a3a5f-9e2d-4b66-8b8f-4a2e3d0c9b21";

const LIST: ConversationListItem[] = [
  { id: ID, title: "Sprint chat", context: "work", archived: false, updatedAt: new Date().toISOString(), messageCount: 2 },
];

const DETAIL: ConversationDetail = {
  id: ID,
  title: "Sprint chat",
  context: "work",
  summary: null,
  summaryUptoSeq: null,
  archived: false,
  createdAt: "",
  updatedAt: "",
  messages: [
    { id: "1", seq: 1, author: "them", text: "Can you review my PR?", source: "pasted", createdAt: "" },
    { id: "2", seq: 2, author: "me", text: "Yes, this afternoon.", source: "chosen_reply", createdAt: "" },
  ],
};

const fetchMock = vi.fn();
let calls: Array<{ url: string; method: string }>;
let created: ConversationListItem[];
let recent: RecentGeneration[];

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  created = [];
  recent = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/reply/conversations" && method === "GET") return Response.json({ conversations: [...created, ...LIST] });
    if (url === "/api/reply/conversations" && method === "POST") {
      const item: ConversationListItem = { id: NEW_ID, title: "", context: "work", archived: false, updatedAt: new Date().toISOString(), messageCount: 0 };
      created.push(item);
      return Response.json({ conversation: { ...item, summary: null, summaryUptoSeq: null, createdAt: "", updatedAt: "" } }, { status: 201 });
    }
    if (url === `/api/reply/conversations/${ID}`) return Response.json({ conversation: DETAIL });
    if (url === `/api/reply/conversations/${NEW_ID}`) {
      return Response.json({ conversation: { ...DETAIL, id: NEW_ID, title: "", messages: [] } });
    }
    if (url.startsWith("/api/reply/generations")) return Response.json({ generations: recent });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReplyWorkspace", () => {
  it("starts on Dịch nhanh and lists the saved conversations", async () => {
    render(<ReplyWorkspace />);
    expect(await screen.findByRole("button", { name: /sprint chat/i })).toBeInTheDocument();
    const list = within(screen.getByRole("navigation", { name: "Cuộc trò chuyện" }));
    expect(list.getByRole("button", { name: /dịch nhanh/i })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("group", { name: "Nội dung muốn viết" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cuộc trò chuyện" })).not.toBeInTheDocument();
  });

  it("opens a conversation: its messages appear and the composer switches to paste mode", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));

    expect(await screen.findByText("Can you review my PR?")).toBeInTheDocument();
    expect(screen.getByText("Yes, this afternoon.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Nội dung muốn viết" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gợi ý trả lời" })).toBeInTheDocument();
    expect(calls).toContainEqual({ url: `/api/reply/conversations/${ID}`, method: "GET" });
  });

  it("goes back to Dịch nhanh", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));
    await screen.findByText("Can you review my PR?");
    const list = within(screen.getByRole("navigation", { name: "Cuộc trò chuyện" }));
    fireEvent.click(list.getByRole("button", { name: /dịch nhanh/i }));
    await waitFor(() => expect(screen.queryByText("Can you review my PR?")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Viết bản nháp" })).toBeInTheDocument();
  });

  it("starts a new conversation and opens it", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /cuộc trò chuyện mới/i }));

    expect(await screen.findByText(/dán đoạn chat vào đây/i)).toBeInTheDocument();
    expect(calls).toContainEqual({ url: "/api/reply/conversations", method: "POST" });
    expect(screen.getByRole("button", { name: "Gợi ý trả lời" })).toBeInTheDocument();
  });

  it("archives the open conversation and returns to Dịch nhanh", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));
    await screen.findByText("Can you review my PR?");
    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ" }));

    await waitFor(() => expect(calls).toContainEqual({ url: `/api/reply/conversations/${ID}`, method: "PATCH" }));
    await waitFor(() => expect(screen.queryByText("Can you review my PR?")).not.toBeInTheDocument());
  });

  it("shows a failure to start a conversation instead of failing silently", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/reply/conversations" && init?.method === "POST") return Response.json({ error: "Nope." }, { status: 500 });
      if (url === "/api/reply/conversations") return Response.json({ conversations: [] });
      return Response.json({ generations: [] });
    });
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /cuộc trò chuyện mới/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });

  it("lists recent replies in the side bar and shows one when it is picked", async () => {
    recent = [
      {
        id: "g-old",
        createdAt: new Date().toISOString(),
        context: "work",
        inputText: "Mình cần thêm một ngày.",
        model: "claude-haiku-4-5",
        options: [{ id: "o-old", generationId: "g-old", variant: "short", text: "I need one more day.", rating: null, editedText: null, chosen: false }],
        developed: [],
      },
    ];
    render(<ReplyWorkspace />);
    const sidebar = within(screen.getByRole("complementary", { name: "Thanh bên" }));
    fireEvent.click(await sidebar.findByRole("button", { name: /mình cần thêm một ngày/i }));

    expect(await screen.findByText("I need one more day.")).toBeInTheDocument();
    const review = within(screen.getByRole("region", { name: "Lượt đang xem lại" }));
    expect(review.getByText("Mình cần thêm một ngày.")).toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByText("I need one more day.")).not.toBeInTheDocument());
  });

  it("hides and shows the side bar, and remembers the choice", async () => {
    render(<ReplyWorkspace />);
    expect(screen.getByRole("button", { name: "Ẩn thanh bên" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hiện thanh bên" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ẩn thanh bên" }));
    expect(screen.getByRole("button", { name: "Hiện thanh bên" })).toBeInTheDocument();
    expect(window.localStorage.getItem("reply.sidebar.v1")).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Hiện thanh bên" }));
    expect(screen.queryByRole("button", { name: "Hiện thanh bên" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("reply.sidebar.v1")).toBe("1");
  });

  it("starts with the side bar hidden when it was hidden last time", async () => {
    window.localStorage.setItem("reply.sidebar.v1", "0");
    render(<ReplyWorkspace />);
    expect(await screen.findByRole("button", { name: "Hiện thanh bên" })).toBeInTheDocument();
  });

  it("scopes the recent list to Dịch nhanh, then to the open conversation", async () => {
    render(<ReplyWorkspace />);
    await waitFor(() => expect(calls.some((c) => c.url.includes("conversation=none"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes(`conversation=${ID}`))).toBe(true));
  });
});
