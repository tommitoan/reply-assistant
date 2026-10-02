import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toUsageView, type UsageRaw } from "@/lib/reply/usage-report";
import UsageView from "./UsageView";

afterEach(cleanup);

const NOW = new Date("2026-10-01T12:30:00Z");

const RAW: UsageRaw = {
  totals: { today: 0.0123, week: 0.05, month: 0.4, allTime: 1.5, calls: 42, unpriced: 0 },
  days: [{ key: "2026-10-01", costUsd: 0.0123, calls: 5 }],
  weeks: [{ key: "2026-09-28", costUsd: 0.05, calls: 9 }],
  months: [{ key: "2026-10", costUsd: 0.4, calls: 30 }],
  kinds: [
    { kind: "generate", monthUsd: 0.3, monthCalls: 20, allTimeUsd: 1.2, allTimeCalls: 30 },
    { kind: "explain", monthUsd: 0.1, monthCalls: 10, allTimeUsd: 0.3, allTimeCalls: 12 },
  ],
  conversations: [
    { conversationId: "c1", title: "Sprint planning", costUsd: 0.2, calls: 12, lastAt: new Date("2026-09-30T08:00:00Z") },
    { conversationId: null, title: null, costUsd: 0.05, calls: 3, lastAt: new Date("2026-09-29T08:00:00Z") },
  ],
};

function show(raw: UsageRaw = RAW) {
  render(<UsageView usage={toUsageView(raw, NOW)} />);
}

describe("UsageView", () => {
  it("shows today, this week, this month and all time", () => {
    show();
    // The totals come first on the page; some labels are column headers further down.
    const card = (label: string) => screen.getAllByText(label)[0].parentElement;
    expect(card("Hôm nay")).toHaveTextContent("$0.0123");
    expect(card("Tuần này")).toHaveTextContent("$0.0500");
    expect(card("Tháng này")).toHaveTextContent("$0.4000");
    expect(card("Tổng cộng")).toHaveTextContent("$1.50");
    expect(card("Tổng cộng")).toHaveTextContent("42 lượt gọi");
  });

  it("breaks the cost down by kind, conversation, day, week and month", () => {
    show();
    for (const title of ["Theo loại lượt gọi", "Theo cuộc trò chuyện", "Theo ngày", "Theo tuần", "Theo tháng"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("Viết bản nháp")).toBeInTheDocument();
    expect(screen.getByText("Giải thích tin nhắn")).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText("Không thuộc cuộc trò chuyện nào (dịch nhanh, hồ sơ phong cách, làm nóng cache, hoặc cuộc trò chuyện đã xóa)")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01 (hôm nay)")).toBeInTheDocument();
    expect(screen.getByText("Tuần từ 2026-09-28")).toBeInTheDocument();
    expect(screen.getByText("Tháng 10/2026")).toBeInTheDocument();
  });

  it("lists every day of the window, with quiet days as dashes", () => {
    show();
    const section = screen.getByRole("heading", { name: "Theo ngày" }).closest("section");
    expect(section).not.toBeNull();
    // 30 days plus the header row.
    expect(within(section as HTMLElement).getAllByRole("row")).toHaveLength(31);
  });

  it("warns when some calls could not be priced", () => {
    show({ ...RAW, totals: { ...RAW.totals, unpriced: 2 } });
    expect(screen.getByRole("note")).toHaveTextContent("2 lượt gọi dùng model chưa có giá");
  });

  it("says there is no cost yet when the table is empty", () => {
    show({ ...RAW, totals: { ...RAW.totals, calls: 0, allTime: 0 } });
    expect(screen.getByText(/Chưa có chi phí nào/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Theo ngày" })).toBeNull();
  });
});
