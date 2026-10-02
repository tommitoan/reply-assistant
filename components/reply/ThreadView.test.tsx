import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConversationDetail } from "@/lib/reply/types";
import ThreadView from "./ThreadView";

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
  render(<ThreadView conversation={conversation} busy={extra.busy ?? false} error={extra.error ?? null} {...handlers} />);
  return handlers;
}

describe("ThreadView", () => {
  it("shows every message with who wrote it, and marks replies picked in the app", () => {
    setup();
    expect(screen.getByText("Can you review my PR?")).toBeInTheDocument();
    expect(screen.getByText("Yes, this afternoon.")).toBeInTheDocument();
    expect(screen.getByText("Them")).toBeInTheDocument();
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/reply you used/i)).toBeInTheDocument();
  });

  it("explains an empty thread", () => {
    setup({ ...BASE, messages: [], title: "" });
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Untitled conversation" })).toBeInTheDocument();
  });

  it("renames on Enter and ignores an unchanged title", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "Conversation title" });
    expect(box).toHaveValue("Sprint chat");
    fireEvent.change(box, { target: { value: "  Planning  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Planning");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Conversation title" }), { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("leaves the title alone when renaming is cancelled", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Other" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("archives straight away", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("asks before deleting, and says what will be lost", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/replies written in it/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("can back out of deleting", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("disables the actions while busy and shows an error", () => {
    setup(BASE, { busy: true, error: "Could not save that." });
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save that.");
  });
});

