import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ExplainBox from "./ExplainBox";

afterEach(cleanup);

describe("ExplainBox", () => {
  it("shows the explanation with its line breaks", () => {
    render(<ExplainBox text={"Dịch: Bạn rảnh không?\n\nÝ và giọng: lịch sự."} />);
    const region = screen.getByRole("region", { name: "Họ đang nói gì" });
    expect(region).toHaveTextContent("Dịch: Bạn rảnh không?");
    expect(region).toHaveTextContent("Ý và giọng: lịch sự.");
    expect(screen.getByText(/Dịch:/)).toHaveClass("whitespace-pre-line");
  });

  it("says it is on its way while the text has not arrived", () => {
    render(<ExplainBox text={null} />);
    expect(screen.getByText("Đang dịch tin nhắn của họ…")).toBeInTheDocument();
  });
});
