import { USAGE_KIND_LABELS, USAGE_KINDS, type UsageKind } from "./usage";

// How far back each table looks.
export const DAYS_SHOWN = 30;
export const WEEKS_SHOWN = 12;
export const MONTHS_SHOWN = 12;
export const CONVERSATIONS_SHOWN = 20;

export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
  allTime: number;
  calls: number;
  // Calls whose model has no known price; their cost is missing from the totals.
  unpriced: number;
}

export interface SeriesRow {
  // "2026-10-01" for a day or the Monday of a week, "2026-10" for a month.
  key: string;
  costUsd: number;
  calls: number;
}

export interface KindRow {
  kind: string;
  monthUsd: number;
  monthCalls: number;
  allTimeUsd: number;
  allTimeCalls: number;
}

export interface ConversationRow {
  // Null for requests outside any thread, and for threads deleted since.
  conversationId: string | null;
  title: string | null;
  costUsd: number;
  calls: number;
  lastAt: Date;
}

export interface UsageRaw {
  totals: PeriodTotals;
  days: SeriesRow[];
  weeks: SeriesRow[];
  months: SeriesRow[];
  kinds: KindRow[];
  conversations: ConversationRow[];
}

const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, "0");

export const dayKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const monthKey = (date: Date): string => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;

// Midnight UTC of the Monday on or before `date`.
export function weekStart(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS);
}

export const monthStart = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
export const dayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

// The first moment each table looks at, so the query and the table agree.
export function windows(now: Date) {
  const today = dayStart(now);
  return {
    day: new Date(today.getTime() - (DAYS_SHOWN - 1) * DAY_MS),
    week: new Date(weekStart(now).getTime() - (WEEKS_SHOWN - 1) * 7 * DAY_MS),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_SHOWN - 1), 1)),
  };
}

export interface UsageSeriesRow extends SeriesRow {
  label: string;
}

export interface UsageView {
  totals: PeriodTotals;
  days: UsageSeriesRow[];
  weeks: UsageSeriesRow[];
  months: UsageSeriesRow[];
  kinds: Array<KindRow & { label: string }>;
  conversations: Array<ConversationRow & { label: string }>;
  empty: boolean;
}

// Newest first, with periods that had no calls shown as zero so gaps are visible.
function fill(
  raw: SeriesRow[],
  keys: string[],
  label: (key: string) => string,
): UsageSeriesRow[] {
  const byKey = new Map(raw.map((row) => [row.key, row]));
  return keys.map((key) => {
    const row = byKey.get(key);
    return { key, costUsd: row?.costUsd ?? 0, calls: row?.calls ?? 0, label: label(key) };
  });
}

// "2026-10" -> "Tháng 10/2026"
const monthLabel = (key: string): string => `Tháng ${Number(key.slice(5))}/${key.slice(0, 4)}`;

export function toUsageView(raw: UsageRaw, now: Date): UsageView {
  const today = dayStart(now);
  const dayKeys = Array.from({ length: DAYS_SHOWN }, (_, i) => dayKey(new Date(today.getTime() - i * DAY_MS)));
  const thisWeek = weekStart(now).getTime();
  const weekKeys = Array.from({ length: WEEKS_SHOWN }, (_, i) => dayKey(new Date(thisWeek - i * 7 * DAY_MS)));
  const monthKeys = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
    monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))),
  );

  const kindOrder = new Map<string, number>(USAGE_KINDS.map((kind, index) => [kind, index]));
  const kinds = [...raw.kinds]
    .sort((a, b) => b.allTimeUsd - a.allTimeUsd || (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99))
    .map((row) => ({ ...row, label: USAGE_KIND_LABELS[row.kind as UsageKind] ?? row.kind }));

  return {
    totals: raw.totals,
    days: fill(raw.days, dayKeys, (key) => (key === dayKey(today) ? `${key} (hôm nay)` : key)),
    weeks: fill(raw.weeks, weekKeys, (key) => `Tuần từ ${key}`),
    months: fill(raw.months, monthKeys, monthLabel),
    kinds,
    conversations: raw.conversations.map((row) => ({
      ...row,
      label: row.conversationId
        ? row.title?.trim() || "Cuộc trò chuyện chưa đặt tên"
        : "Không thuộc cuộc trò chuyện nào (dịch nhanh, hồ sơ phong cách, làm nóng cache, hoặc cuộc trò chuyện đã xóa)",
    })),
    empty: raw.totals.calls === 0,
  };
}

// Dollars to four decimals under $1 (single calls cost fractions of a cent),
// two above.
export function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}
