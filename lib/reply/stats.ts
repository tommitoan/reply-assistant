// Turns the rows the database returns into what the stats page shows.

export interface WeeklyRatingRow {
  week: Date;
  good: number;
  bad: number;
}

export interface MemoryRatingRow {
  useMemory: boolean;
  good: number;
  bad: number;
}

// Ratings of pasted-message replies, split by whether the reply used a note.
export interface NotesRatingRow {
  withNotes: boolean;
  good: number;
  bad: number;
}

export interface CostRow {
  day: Date;
  model: string;
  requests: number;
  usd: number;
}

export interface LatencyRow {
  model: string;
  requests: number;
  avgFirstTokenMs: number | null;
  avgTotalMs: number | null;
}

export interface CountsRow {
  requests: number;
  costUsd: number;
  edited: number;
  liked: number;
  memoryAsked: number;
  memoryHit: number;
  // Finished replies to a pasted message, and how many of them used a note.
  pasted: number;
  notesUsed: number;
}

export interface StatsRaw {
  weekly: WeeklyRatingRow[];
  memory: MemoryRatingRow[];
  notes: NotesRatingRow[];
  cost: CostRow[];
  latency: LatencyRow[];
  counts: CountsRow;
}

export interface Rate {
  good: number;
  bad: number;
  // good / (good + bad); null when nothing has been rated.
  rate: number | null;
}

export interface StatsView {
  weekly: Array<Rate & { weekStart: string }>;
  memoryRates: { on: Rate; off: Rate };
  // Pasted-message replies only, by whether a note was used.
  notesRates: { with: Rate; without: Rate };
  costByDay: Array<{
    day: string;
    totalUsd: number;
    models: Array<{ model: string; requests: number; usd: number }>;
  }>;
  latencyByModel: LatencyRow[];
  goldExamples: number;
  likedExamples: number;
  memoryHitRate: { asked: number; hit: number; rate: number | null };
  notesUse: { pasted: number; used: number; rate: number | null };
  totals: { requests: number; costUsd: number };
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

function toRate(good: number, bad: number): Rate {
  return { good, bad, rate: ratio(good, good + bad) };
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

export function toStatsView(raw: StatsRaw): StatsView {
  const memory = (on: boolean) => {
    const row = raw.memory.find((entry) => entry.useMemory === on);
    return toRate(row?.good ?? 0, row?.bad ?? 0);
  };

  const notes = (withNotes: boolean) => {
    const row = raw.notes.find((entry) => entry.withNotes === withNotes);
    return toRate(row?.good ?? 0, row?.bad ?? 0);
  };

  // Days newest first, and within a day the models that cost most first.
  const days = new Map<string, StatsView["costByDay"][number]>();
  for (const row of raw.cost) {
    const key = isoDay(row.day);
    const day = days.get(key) ?? { day: key, totalUsd: 0, models: [] };
    day.totalUsd += row.usd;
    day.models.push({ model: row.model, requests: row.requests, usd: row.usd });
    days.set(key, day);
  }
  const costByDay = [...days.values()]
    .map((day) => ({ ...day, models: [...day.models].sort((a, b) => b.usd - a.usd) }))
    .sort((a, b) => b.day.localeCompare(a.day));

  return {
    weekly: [...raw.weekly]
      .sort((a, b) => a.week.getTime() - b.week.getTime())
      .map((row) => ({ weekStart: isoDay(row.week), ...toRate(row.good, row.bad) })),
    memoryRates: { on: memory(true), off: memory(false) },
    notesRates: { with: notes(true), without: notes(false) },
    costByDay,
    latencyByModel: [...raw.latency].sort((a, b) => b.requests - a.requests),
    goldExamples: raw.counts.edited,
    likedExamples: raw.counts.liked,
    memoryHitRate: {
      asked: raw.counts.memoryAsked,
      hit: raw.counts.memoryHit,
      rate: ratio(raw.counts.memoryHit, raw.counts.memoryAsked),
    },
    notesUse: {
      pasted: raw.counts.pasted,
      used: raw.counts.notesUsed,
      rate: ratio(raw.counts.notesUsed, raw.counts.pasted),
    },
    totals: { requests: raw.counts.requests, costUsd: raw.counts.costUsd },
  };
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}
