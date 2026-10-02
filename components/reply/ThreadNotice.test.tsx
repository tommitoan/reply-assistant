import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ThreadNotice from "./ThreadNotice";

afterEach(cleanup);

describe("ThreadNotice", () => {
  it("says how many messages were added", () => {
    render(<ThreadNotice added={3} skipped={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Added 3 new messages to the conversation.");
  });

  it("uses the singular and mentions what was already there", () => {
    render(<ThreadNotice added={1} skipped={4} />);
    expect(screen.getByRole("status")).toHaveTextContent("Added 1 new message to the conversation (4 already there).");
  });

  it("says when a paste had nothing new", () => {
    render(<ThreadNotice added={0} skipped={5} />);
    expect(screen.getByRole("status")).toHaveTextContent(/nothing new in that paste/i);
  });
});
