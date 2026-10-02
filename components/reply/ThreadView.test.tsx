import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConversationDetail } from "@/lib/reply/types";
import { ThreadHeader, ThreadMessages } from "./ThreadView";

afterEach(cleanup);

const BASE: ConversationDetail = {
  id: "c1",
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
    { id: "3", seq: 3, author: "unknown", text: "Thanks!", source: "pasted", createdAt: "" },
  ],
};

function setup(conversation: ConversationDetail = BASE, extra: { busy?: boolean; error?: string | null } = {}) {
  const handlers = { onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() };
  render(
    <>
      <ThreadHeader conversation={conversation} busy={extra.busy ?? false} error={extra.error ?? null} {...handlers} />
      <ThreadMessages messages={conversation.messages} />
    </>,
  );
  return handlers;
}

describe("ThreadView", () => {
  it("shows every message with who wrote it, and marks replies picked in the app", () => {
    setup();
    expect(screen.getByText("Can you review my PR?")).toBeInTheDocument();
    expect(screen.getByText("Yes, this afternoon.")).toBeInTheDocument();
    expect(screen.getByText("Họ")).toBeInTheDocument();
    expect(screen.getByText("Tôi")).toBeInTheDocument();
    expect(screen.getByText("Chưa rõ")).toBeInTheDocument();
    expect(screen.getByText(/bản trả lời bạn đã dùng/i)).toBeInTheDocument();
  });

  it("shows no message list for an empty thread, and names an untitled one", () => {
    setup({ ...BASE, messages: [], title: "" });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cuộc trò chuyện chưa đặt tên" })).toBeInTheDocument();
  });

  it("renames on Enter and ignores an unchanged title", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Đổi tên" }));
    const box = screen.getByRole("textbox", { name: "Tên cuộc trò chuyện" });
    expect(box).toHaveValue("Sprint chat");
    fireEvent.change(box, { target: { value: "  Planning  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Planning");

    fireEvent.click(screen.getByRole("button", { name: "Đổi tên" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Tên cuộc trò chuyện" }), { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("leaves the title alone when renaming is cancelled", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Đổi tên" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Other" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("archives straight away", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("asks before deleting, and says what will be lost", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/bản trả lời đã viết trong đó/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Xóa" })[1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("can back out of deleting", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disables the actions while busy and shows an error", () => {
    setup(BASE, { busy: true, error: "Không lưu được." });
    expect(screen.getByRole("button", { name: "Lưu trữ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đổi tên" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Không lưu được.");
  });
});

