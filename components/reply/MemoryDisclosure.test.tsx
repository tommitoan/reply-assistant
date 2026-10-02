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
    expect(screen.getByText("Used 2 memories")).toBeInTheDocument();
    expect(screen.getByText("Mình đến muộn nhé.")).toBeInTheDocument();
    expect(screen.getByText("Cảm ơn bạn.")).toBeInTheDocument();
  });

  it("uses the singular for one memory", () => {
    render(<MemoryDisclosure status="used" memories={[{ id: "a", input: "x" }]} />);
    expect(screen.getByText("Used 1 memory")).toBeInTheDocument();
  });

  it.each([
    ["none", /no similar earlier replies/i],
    ["skipped", /memory was skipped/i],
    ["unavailable", /not set up on this server/i],
  ] as const)("explains the %s case in plain words", (status, message) => {
    render(<MemoryDisclosure status={status} memories={[]} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
