import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConversationDetail, ConversationListItem } from "@/lib/reply/types";
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

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  created = [];
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
    if (url.startsWith("/api/reply/generations")) return Response.json({ generations: [] });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReplyWorkspace", () => {
  it("starts on Quick translate and lists the saved conversations", async () => {
    render(<ReplyWorkspace />);
    expect(await screen.findByRole("button", { name: /sprint chat/i })).toBeInTheDocument();
    const list = within(screen.getByRole("navigation", { name: "Conversations" }));
    expect(list.getByRole("button", { name: /quick translate/i })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("group", { name: "What to write" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Conversation" })).not.toBeInTheDocument();
  });

  it("opens a conversation: its messages appear and the composer switches to paste mode", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));

    expect(await screen.findByText("Can you review my PR?")).toBeInTheDocument();
    expect(screen.getByText("Yes, this afternoon.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "What to write" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest replies" })).toBeInTheDocument();
    expect(calls).toContainEqual({ url: `/api/reply/conversations/${ID}`, method: "GET" });
  });

  it("goes back to Quick translate", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));
    await screen.findByText("Can you review my PR?");
    const list = within(screen.getByRole("navigation", { name: "Conversations" }));
    fireEvent.click(list.getByRole("button", { name: /quick translate/i }));
    await waitFor(() => expect(screen.queryByText("Can you review my PR?")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Write replies" })).toBeInTheDocument();
  });

  it("starts a new conversation and opens it", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /new conversation/i }));

    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
    expect(calls).toContainEqual({ url: "/api/reply/conversations", method: "POST" });
    expect(screen.getByRole("button", { name: "Suggest replies" })).toBeInTheDocument();
  });

  it("archives the open conversation and returns to Quick translate", async () => {
    render(<ReplyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /sprint chat/i }));
    await screen.findByText("Can you review my PR?");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

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
    fireEvent.click(await screen.findByRole("button", { name: /new conversation/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });
});
