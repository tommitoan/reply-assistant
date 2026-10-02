import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FeedbackItem } from "@/lib/reply/feedback-state";
import ReplyOptionCard, { type OptionActions } from "./ReplyOptionCard";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReplyOptionCard", () => {
  it("shows the variant label and the text", () => {
    render(<ReplyOptionCard variant="alt" text="Works for me." />);
    expect(screen.getByText("Cách khác")).toBeInTheDocument();
    expect(screen.getByText("Works for me.")).toBeInTheDocument();
  });

  it("copies the text and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<ReplyOptionCard variant="short" text="See you at 3." />);

    fireEvent.click(screen.getByRole("button", { name: /sao chép bản nháp ngắn/i }));

    expect(writeText).toHaveBeenCalledWith("See you at 3.");
    expect(await screen.findByText("Đã chép ✓")).toBeInTheDocument();
  });

  it("says so when the browser blocks copying", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<ReplyOptionCard variant="medium" text="Hello." />);

    fireEvent.click(screen.getByRole("button", { name: /sao chép/i }));

    expect(await screen.findByText("Chép không được")).toBeInTheDocument();
  });

  it("returns to the normal label after a moment", async () => {
    vi.useFakeTimers();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    render(<ReplyOptionCard variant="long" text="Hello." />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sao chép/i }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Đã chép ✓")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByText("Sao chép")).toBeInTheDocument();
  });

  it("disables copy until there is text to copy", () => {
    render(<ReplyOptionCard variant="short" text="" streaming />);
    expect(screen.getByRole("button", { name: /sao chép/i })).toBeDisabled();
  });
});

function item(overrides: Partial<FeedbackItem["shown"]> = {}, extra: Partial<FeedbackItem> = {}): FeedbackItem {
  const feedback = { rating: null, editedText: null, chosen: false, ...overrides };
  return { generationId: "g1", familyId: "g1", saved: feedback, shown: feedback, pending: false, error: null, ...extra };
}

function actions(feedbackItem: FeedbackItem = item(), overrides: Partial<OptionActions> = {}): OptionActions {
  return {
    item: feedbackItem,
    onRate: vi.fn(),
    onSaveEdit: vi.fn().mockResolvedValue(true),
    onUse: vi.fn(),
    onDismissError: vi.fn(),
    ...overrides,
  };
}

describe("ReplyOptionCard feedback actions", () => {
  it("shows no feedback buttons without actions", () => {
    render(<ReplyOptionCard variant="short" text="Hi." />);
    expect(screen.queryByRole("button", { name: /bản nháp hay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dùng bản này/i })).not.toBeInTheDocument();
  });

  it("rates a reply, and clears the rating when the same button is pressed again", () => {
    const onRate = vi.fn();
    const { rerender } = render(<ReplyOptionCard variant="short" text="Hi." actions={actions(item(), { onRate })} />);

    fireEvent.click(screen.getByRole("button", { name: "Bản nháp hay" }));
    expect(onRate).toHaveBeenLastCalledWith("good");

    rerender(<ReplyOptionCard variant="short" text="Hi." actions={actions(item({ rating: "good" }), { onRate })} />);
    expect(screen.getByRole("button", { name: "Bản nháp hay" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Bản nháp hay" }));
    expect(onRate).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "Bản nháp chưa ổn" }));
    expect(onRate).toHaveBeenLastCalledWith("bad");
  });

  it("disables the buttons while a change is being saved", () => {
    render(<ReplyOptionCard variant="short" text="Hi." actions={actions(item({}, { pending: true }))} />);
    for (const name of ["Bản nháp hay", "Bản nháp chưa ổn", /sửa/i, "Dùng bản này"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("copies the text and marks it as used", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const onUse = vi.fn();
    render(<ReplyOptionCard variant="short" text="See you at 3." actions={actions(item(), { onUse })} />);

    fireEvent.click(screen.getByRole("button", { name: "Dùng bản này" }));

    expect(await screen.findByText("Đã chép ✓")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("See you at 3.");
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("still marks the reply as used when the browser blocks copying", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const onUse = vi.fn();
    render(<ReplyOptionCard variant="short" text="Hi." actions={actions(item(), { onUse })} />);

    fireEvent.click(screen.getByRole("button", { name: "Dùng bản này" }));

    expect(await screen.findByText("Chép không được")).toBeInTheDocument();
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("shows a used reply as used", () => {
    render(<ReplyOptionCard variant="short" text="Hi." actions={actions(item({ chosen: true }))} />);
    expect(screen.getByRole("button", { name: "Đã dùng ✓" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows and copies the edited text instead of the model's", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(
      <ReplyOptionCard variant="short" text="Original." actions={actions(item({ editedText: "My version." }))} />,
    );

    expect(screen.getByText("My version.")).toBeInTheDocument();
    expect(screen.queryByText("Original.")).not.toBeInTheDocument();
    expect(screen.getByText("đã sửa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sao chép bản nháp ngắn/i }));
    expect(writeText).toHaveBeenCalledWith("My version.");
  });

  describe("editing", () => {
    function startEditing(onSaveEdit: OptionActions["onSaveEdit"], text = "Original.", edited: string | null = null) {
      render(<ReplyOptionCard variant="medium" text={text} actions={actions(item({ editedText: edited }), { onSaveEdit })} />);
      fireEvent.click(screen.getByRole("button", { name: /sửa/i }));
      return screen.getByRole("textbox", { name: /sửa bản nháp vừa/i }) as HTMLTextAreaElement;
    }

    it("opens a box with the current text and saves the new text", async () => {
      const onSaveEdit = vi.fn().mockResolvedValue(true);
      const box = startEditing(onSaveEdit);
      expect(box.value).toBe("Original.");

      fireEvent.change(box, { target: { value: "  Better words.  " } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

      expect(onSaveEdit).toHaveBeenCalledWith("Better words.");
      await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    });

    it("stays open when the save fails", async () => {
      const onSaveEdit = vi.fn().mockResolvedValue(false);
      const box = startEditing(onSaveEdit);
      fireEvent.change(box, { target: { value: "New." } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

      await waitFor(() => expect(onSaveEdit).toHaveBeenCalled());
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("treats writing the original text back as removing the edit", async () => {
      const onSaveEdit = vi.fn().mockResolvedValue(true);
      const box = startEditing(onSaveEdit, "Original.", "Edited before.");
      fireEvent.change(box, { target: { value: "Original." } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
      expect(onSaveEdit).toHaveBeenCalledWith(null);
    });

    it("closes without saving when nothing changed", () => {
      const onSaveEdit = vi.fn();
      startEditing(onSaveEdit);
      fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
      expect(onSaveEdit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("cannot save a blank reply", () => {
      const box = startEditing(vi.fn());
      fireEvent.change(box, { target: { value: "   " } });
      expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    });

    it("cancels without saving", () => {
      const onSaveEdit = vi.fn();
      const box = startEditing(onSaveEdit);
      fireEvent.change(box, { target: { value: "Something else" } });
      fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
      expect(onSaveEdit).not.toHaveBeenCalled();
      expect(screen.getByText("Original.")).toBeInTheDocument();
    });

    it("offers to go back to the model's text once edited", async () => {
      const onSaveEdit = vi.fn().mockResolvedValue(true);
      startEditing(onSaveEdit, "Original.", "Edited.");
      fireEvent.click(screen.getByRole("button", { name: "Dùng bản gốc" }));
      expect(onSaveEdit).toHaveBeenCalledWith(null);
      await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    });
  });

  it("shows a save error and lets it be dismissed", () => {
    const onDismissError = vi.fn();
    render(
      <ReplyOptionCard
        variant="short"
        text="Hi."
        actions={actions(item({}, { error: "Không lưu được." }), { onDismissError })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Không lưu được.");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
