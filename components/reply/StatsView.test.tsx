import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { toStatsView, type StatsRaw } from "@/lib/reply/stats";
import StatsView from "./StatsView";

afterEach(cleanup);

const RAW: StatsRaw = {
  weekly: [
    { week: new Date("2026-09-21T00:00:00Z"), good: 1, bad: 3 },
    { week: new Date("2026-09-28T00:00:00Z"), good: 3, bad: 1 },
  ],
  memory: [
    { useMemory: true, good: 6, bad: 2 },
    { useMemory: false, good: 2, bad: 2 },
  ],
  notes: [
    { withNotes: true, good: 3, bad: 1 },
    { withNotes: false, good: 1, bad: 3 },
  ],
  cost: [
    { day: new Date("2026-10-01T00:00:00Z"), model: "claude-haiku-4-5-20251001", requests: 4, usd: 0.0072 },
    { day: new Date("2026-10-01T00:00:00Z"), model: "claude-sonnet-5-5", requests: 1, usd: 0.0058 },
  ],
  latency: [{ model: "claude-haiku-4-5-20251001", requests: 4, avgFirstTokenMs: 870, avgTotalMs: 1900 }],
  counts: { requests: 5, costUsd: 0.013, edited: 3, liked: 4, memoryAsked: 4, memoryHit: 3, pasted: 8, notesUsed: 2 },
};

describe("StatsView", () => {
  it("shows the headline numbers", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    // The headline cards come first in the page; "Yêu cầu" and "Đã thích" also head table columns.
    const value = (label: string) => screen.getAllByText(label)[0].nextElementSibling;
    expect(value("Yêu cầu")).toHaveTextContent("5");
    expect(value("Chi phí bản nháp")).toHaveTextContent("$0.0130");
    expect(value("Bạn đã sửa")).toHaveTextContent("3");
    expect(value("Đã thích")).toHaveTextContent("4");
  });

  it("shows the liked share for each week", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    const weekly = within(screen.getByRole("heading", { name: "Tỉ lệ 👍 theo tuần" }).closest("section")!);
    expect(weekly.getByText("2026-09-21").closest("tr")).toHaveTextContent("25%");
    expect(weekly.getByText("2026-09-28").closest("tr")).toHaveTextContent("75%");
  });

  it("compares memory on and off and says how often memory found something", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    const section = within(screen.getByRole("heading", { name: "Trí nhớ có giúp ích không?" }).closest("section")!);
    expect(section.getByText("Bật trí nhớ").closest("tr")).toHaveTextContent("75%");
    expect(section.getByText("Tắt trí nhớ").closest("tr")).toHaveTextContent("50%");
    expect(section.getByText(/75% của 4 yêu cầu/)).toBeInTheDocument();
  });

  it("compares replies that used a note with those that did not, and says how often a note was used", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    const section = within(screen.getByRole("heading", { name: "Ghi chú có giúp ích không?" }).closest("section")!);
    expect(section.getByText("Có dùng ghi chú").closest("tr")).toHaveTextContent("75%");
    expect(section.getByText("Không dùng ghi chú").closest("tr")).toHaveTextContent("25%");
    expect(section.getByText(/25% của 8 bản nháp trả lời tin nhắn đã dán/)).toBeInTheDocument();
  });

  it("shows cost per model with a day total, and speed by model", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    const cost = within(screen.getByRole("heading", { name: "Chi phí theo ngày" }).closest("section")!);
    expect(cost.getByText("sonnet").closest("tr")).toHaveTextContent("$0.0058");
    expect(cost.getByText(/tổng ngày \$0\.0130/)).toBeInTheDocument();
    const speed = within(screen.getByRole("heading", { name: "Tốc độ theo model" }).closest("section")!);
    expect(speed.getByText("haiku").closest("tr")).toHaveTextContent("0.9 s");
    expect(speed.getByText("haiku").closest("tr")).toHaveTextContent("1.9 s");
  });

  it("explains an empty database instead of showing broken figures", () => {
    render(
      <StatsView
        stats={toStatsView({
          weekly: [],
          memory: [],
          notes: [],
          cost: [],
          latency: [],
          counts: { requests: 0, costUsd: 0, edited: 0, liked: 0, memoryAsked: 0, memoryHit: 0, pasted: 0, notesUsed: 0 },
        })}
      />,
    );
    expect(screen.getByText(/chưa có gì để hiển thị/i)).toBeInTheDocument();
    expect(screen.getByText("Chưa có đánh giá nào.")).toBeInTheDocument();
    expect(screen.getByText("Không có yêu cầu nào trong giai đoạn này.")).toBeInTheDocument();
  });
});

describe("StatsView cost note", () => {
  it("points to the usage page for the full spending", () => {
    render(<StatsView stats={toStatsView(RAW)} />);
    expect(screen.getByRole("link", { name: "Chi phí" })).toHaveAttribute("href", "/usage");
  });
});
