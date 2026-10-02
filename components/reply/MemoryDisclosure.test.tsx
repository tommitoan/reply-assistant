import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MemoryDisclosure from "./MemoryDisclosure";

afterEach(cleanup);

describe("MemoryDisclosure", () => {
  it("shows nothing when memory was not asked for", () => {
    const { container } = render(<MemoryDisclosure status="off" memories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the earlier inputs that were used", () => {
    render(
      <MemoryDisclosure
        status="used"
        memories={[
          { id: "a", input: "Mình đến muộn nhé." },
          { id: "b", input: "Cảm ơn bạn." },
        ]}
      />,
    );
    expect(screen.getByText("Đã dùng 2 mục trí nhớ")).toBeInTheDocument();
    expect(screen.getByText("Mình đến muộn nhé.")).toBeInTheDocument();
    expect(screen.getByText("Cảm ơn bạn.")).toBeInTheDocument();
  });

  it("uses the singular for one memory", () => {
    render(<MemoryDisclosure status="used" memories={[{ id: "a", input: "x" }]} />);
    expect(screen.getByText("Đã dùng 1 mục trí nhớ")).toBeInTheDocument();
  });

  it.each([
    ["none", /chưa có bản nháp nào tương tự/i],
    ["skipped", /đã bỏ qua trí nhớ/i],
    ["unavailable", /chưa bật trí nhớ/i],
  ] as const)("explains the %s case in plain words", (status, message) => {
    render(<MemoryDisclosure status={status} memories={[]} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
