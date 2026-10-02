import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConversationListItem } from "@/lib/reply/types";
import ThreadList from "./ThreadList";

afterEach(cleanup);

const ITEMS: ConversationListItem[] = [
  { id: "a", title: "Sprint planning", context: "work", archived: false, updatedAt: new Date().toISOString(), messageCount: 5 },
  { id: "b", title: "", context: "casual", archived: false, updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), messageCount: 1 },
];

function setup(overrides: Partial<Parameters<typeof ThreadList>[0]> = {}) {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  render(
    <ThreadList items={ITEMS} error={null} activeId={null} creating={false} onSelect={onSelect} onCreate={onCreate} {...overrides} />,
  );
  return { onSelect, onCreate };
}

describe("ThreadList", () => {
  it("lists the conversations with their size and age", () => {
    setup();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText(/5 messages · just now/)).toBeInTheDocument();
    expect(screen.getByText(/1 message · 3 h ago/)).toBeInTheDocument();
  });

  it("names an untitled conversation", () => {
    setup();
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("marks the open conversation, and Quick translate when none is open", () => {
    setup({ activeId: "a" });
    expect(screen.getByRole("button", { name: /sprint planning/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /quick translate/i })).not.toHaveAttribute("aria-current");
    cleanup();
    setup({ activeId: null });
    expect(screen.getByRole("button", { name: /quick translate/i })).toHaveAttribute("aria-current", "page");
  });

  it("selects a conversation, or none for Quick translate", () => {
    const { onSelect } = setup({ activeId: "a" });
    fireEvent.click(screen.getByRole("button", { name: /quick translate/i }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: /sprint planning/i }));
    expect(onSelect).toHaveBeenLastCalledWith("a");
  });

  it("starts a new conversation, and cannot be double-clicked while one is starting", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: /new conversation/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ creating: true });
    expect(screen.getByRole("button", { name: /starting/i })).toBeDisabled();
  });

  it("shows loading, empty and error states", () => {
    setup({ items: null });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    cleanup();
    setup({ items: [] });
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
    cleanup();
    setup({ items: null, error: "Could not load the conversations." });
    expect(screen.getByText("Could not load the conversations.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
