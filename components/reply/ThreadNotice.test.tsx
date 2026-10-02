import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ThreadNotice from "./ThreadNotice";

afterEach(cleanup);

describe("ThreadNotice", () => {
  it("says how many messages were added", () => {
    render(<ThreadNotice added={3} skipped={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đã thêm 3 tin nhắn mới vào cuộc trò chuyện.");
  });

  it("uses the singular and mentions what was already there", () => {
    render(<ThreadNotice added={1} skipped={4} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đã thêm 1 tin nhắn mới vào cuộc trò chuyện (4 tin đã có sẵn).");
  });

  it("says when a paste had nothing new", () => {
    render(<ThreadNotice added={0} skipped={5} />);
    expect(screen.getByRole("status")).toHaveTextContent(/không có gì mới/i);
  });
});
