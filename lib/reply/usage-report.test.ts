import { describe, expect, it } from "vitest";
import {
  DAYS_SHOWN,
  MONTHS_SHOWN,
  WEEKS_SHOWN,
  dayKey,
  formatUsd,
  monthKey,
  toUsageView,
  weekStart,
  windows,
  type UsageRaw,
} from "./usage-report";

// Thursday 2026-10-01, 12:30 UTC.
const NOW = new Date("2026-10-01T12:30:00Z");

const EMPTY: UsageRaw = {
  totals: { today: 0, week: 0, month: 0, allTime: 0, calls: 0, unpriced: 0 },
  days: [],
  weeks: [],
  months: [],
  kinds: [],
  conversations: [],
};

describe("calendar helpers (UTC)", () => {
  it("starts a week on Monday", () => {
    expect(dayKey(weekStart(NOW))).toBe("2026-09-28");
    expect(dayKey(weekStart(new Date("2026-09-28T00:00:00Z")))).toBe("2026-09-28");
    // Sunday belongs to the week that began the Monday before.
    expect(dayKey(weekStart(new Date("2026-10-04T23:59:00Z")))).toBe("2026-09-28");
  });

  it("cuts days and months in UTC even late in the evening elsewhere", () => {
    const lateUtc = new Date("2026-10-31T23:30:00Z");
    expect(dayKey(lateUtc)).toBe("2026-10-31");
    expect(monthKey(lateUtc)).toBe("2026-10");
  });

  it("starts each window so that the table has the shown number of rows", () => {
    const from = windows(NOW);
    expect(dayKey(from.day)).toBe("2026-09-02");
    expect(dayKey(from.week)).toBe("2026-07-13");
    expect(monthKey(from.month)).toBe("2025-11");
  });
});

describe("toUsageView", () => {
  it("fills quiet days, weeks and months with zeros, newest first", () => {
    const view = toUsageView(
      {
        ...EMPTY,
        totals: { ...EMPTY.totals, calls: 2, allTime: 0.5 },
        days: [{ key: "2026-10-01", costUsd: 0.3, calls: 1 }, { key: "2026-09-29", costUsd: 0.2, calls: 1 }],
      },
      NOW,
    );
    expect(view.days).toHaveLength(DAYS_SHOWN);
    expect(view.weeks).toHaveLength(WEEKS_SHOWN);
    expect(view.months).toHaveLength(MONTHS_SHOWN);
    expect(view.days.slice(0, 3).map((d) => [d.key, d.costUsd, d.calls])).toEqual([
      ["2026-10-01", 0.3, 1],
      ["2026-09-30", 0, 0],
      ["2026-09-29", 0.2, 1],
    ]);
    expect(view.days[0].label).toBe("2026-10-01 (hôm nay)");
    expect(view.weeks[0]).toMatchObject({ key: "2026-09-28", label: "Tuần từ 2026-09-28" });
    expect(view.months[0]).toMatchObject({ key: "2026-10", label: "Tháng 10/2026" });
    expect(view.months[11].key).toBe("2025-11");
  });

  it("labels conversations, with a clear name for requests outside a thread", () => {
    const lastAt = new Date("2026-10-01T00:00:00Z");
    const view = toUsageView(
      {
        ...EMPTY,
        totals: { ...EMPTY.totals, calls: 3 },
        conversations: [
          { conversationId: "a", title: "Sprint planning", costUsd: 0.1, calls: 2, lastAt },
          { conversationId: "b", title: "  ", costUsd: 0.05, calls: 1, lastAt },
          { conversationId: null, title: null, costUsd: 0.01, calls: 4, lastAt },
        ],
      },
      NOW,
    );
    expect(view.conversations.map((c) => c.label)).toEqual([
      "Sprint planning",
      "Cuộc trò chuyện chưa đặt tên",
      "Không thuộc cuộc trò chuyện nào (dịch nhanh, hồ sơ phong cách, làm nóng cache, hoặc cuộc trò chuyện đã xóa)",
    ]);
  });

  it("orders kinds by what they cost all time and names them", () => {
    const view = toUsageView(
      {
        ...EMPTY,
        totals: { ...EMPTY.totals, calls: 3 },
        kinds: [
          { kind: "summary", monthUsd: 0, monthCalls: 0, allTimeUsd: 0.01, allTimeCalls: 2 },
          { kind: "generate", monthUsd: 1, monthCalls: 5, allTimeUsd: 2, allTimeCalls: 9 },
          { kind: "mystery", monthUsd: 0, monthCalls: 0, allTimeUsd: 0, allTimeCalls: 1 },
        ],
      },
      NOW,
    );
    expect(view.kinds.map((k) => k.label)).toEqual(["Viết bản nháp", "Tóm tắt cuộc trò chuyện", "mystery"]);
  });

  it("is empty until a call has been recorded", () => {
    expect(toUsageView(EMPTY, NOW).empty).toBe(true);
    expect(toUsageView({ ...EMPTY, totals: { ...EMPTY.totals, calls: 1 } }, NOW).empty).toBe(false);
  });
});

describe("formatUsd", () => {
  it("shows fractions of a cent under a dollar and cents above", () => {
    expect(formatUsd(0.0021)).toBe("$0.0021");
    expect(formatUsd(0)).toBe("$0.0000");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
