import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SETTINGS, type ReplySettings } from "@/lib/reply/settings";
import ReplyControls from "./ReplyControls";

afterEach(cleanup);

function setup(settings: Partial<ReplySettings> = {}, disabled = false, showExplain = false) {
  const onChange = vi.fn();
  render(
    <ReplyControls
      settings={{ ...DEFAULT_SETTINGS, ...settings }}
      onChange={onChange}
      disabled={disabled}
      showExplain={showExplain}
    />,
  );
  return onChange;
}

describe("ReplyControls", () => {
  it("lets the memory switch be switched on and off", () => {
    const onChange = setup({ useMemory: false });
    const toggle = screen.getByRole("checkbox", { name: "Dùng trí nhớ" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ useMemory: true });
  });

  it("shows the saved memory choice", () => {
    setup({ useMemory: true });
    expect(screen.getByRole("checkbox", { name: "Dùng trí nhớ" })).toBeChecked();
  });

  it("lets the notes switch be switched off and on, independently of memory", () => {
    const onChange = setup({ useNotes: true, useMemory: false });
    const toggle = screen.getByRole("checkbox", { name: "Dùng ghi chú của tôi" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ useNotes: false });
    expect(screen.getByRole("checkbox", { name: "Dùng trí nhớ" })).not.toBeChecked();
  });

  it("keeps learning and memory independent", () => {
    const onChange = setup({ learn: true, useMemory: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Ghi nhớ để học" }));
    expect(onChange).toHaveBeenCalledWith({ learn: false });
  });

  it("changes context and speed", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /thân mật/i }));
    expect(onChange).toHaveBeenLastCalledWith({ context: "casual" });
    fireEvent.click(screen.getByRole("button", { name: /kỹ lưỡng/i }));
    expect(onChange).toHaveBeenLastCalledWith({ speed: "smart" });
  });

  it("disables the context and speed buttons while a request runs", () => {
    setup({}, true);
    expect(screen.getByRole("button", { name: /công việc/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /nhanh/i })).toBeDisabled();
  });
});

describe("ReplyControls explain toggle", () => {
  it("is hidden unless a message is being pasted", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: "Giải thích bằng tiếng Việt" })).toBeNull();
  });

  it("can be switched off and shows the saved choice", () => {
    const onChange = setup({ explain: true }, false, true);
    const toggle = screen.getByRole("checkbox", { name: "Giải thích bằng tiếng Việt" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ explain: false });
  });
});
