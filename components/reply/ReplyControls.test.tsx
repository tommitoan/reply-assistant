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
  it("lets Use memory be switched on and off", () => {
    const onChange = setup({ useMemory: false });
    const toggle = screen.getByRole("checkbox", { name: "Use memory" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ useMemory: true });
  });

  it("shows the saved Use memory choice", () => {
    setup({ useMemory: true });
    expect(screen.getByRole("checkbox", { name: "Use memory" })).toBeChecked();
  });

  it("lets Use my notes be switched off and on, independently of memory", () => {
    const onChange = setup({ useNotes: true, useMemory: false });
    const toggle = screen.getByRole("checkbox", { name: "Use my notes" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ useNotes: false });
    expect(screen.getByRole("checkbox", { name: "Use memory" })).not.toBeChecked();
  });

  it("keeps Learn and Use memory independent", () => {
    const onChange = setup({ learn: true, useMemory: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Learn" }));
    expect(onChange).toHaveBeenCalledWith({ learn: false });
  });

  it("changes context and speed", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /casual/i }));
    expect(onChange).toHaveBeenLastCalledWith({ context: "casual" });
    fireEvent.click(screen.getByRole("button", { name: /smart/i }));
    expect(onChange).toHaveBeenLastCalledWith({ speed: "smart" });
  });

  it("disables the context and speed buttons while a request runs", () => {
    setup({}, true);
    expect(screen.getByRole("button", { name: /work/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /fast/i })).toBeDisabled();
  });
});

describe("ReplyControls explain toggle", () => {
  it("is hidden unless a message is being pasted", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: "Explain in Vietnamese" })).toBeNull();
  });

  it("can be switched off and shows the saved choice", () => {
    const onChange = setup({ explain: true }, false, true);
    const toggle = screen.getByRole("checkbox", { name: "Explain in Vietnamese" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ explain: false });
  });
});
