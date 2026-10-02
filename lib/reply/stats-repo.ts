import { sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import type { CostRow, CountsRow, LatencyRow, MemoryRatingRow, NotesRatingRow, StatsRaw, WeeklyRatingRow } from "./stats";

// How far back the time-based figures look.
export const WEEKLY_WINDOW_DAYS = 56;
export const COST_WINDOW_DAYS = 14;
export const LATENCY_WINDOW_DAYS = 30;

// A raw `sql` parameter has no column to infer its type from, so a Date would
// reach the driver unserialised. Bind an ISO string and cast it in the query.
const daysAgo = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();

type Raw = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);
const maybe = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export interface StatsRepo {
  load(now?: Date): Promise<StatsRaw>;
}

export function createStatsRepo(db: ReplyDb): StatsRepo {
  async function rows(query: ReturnType<typeof sql>): Promise<Raw[]> {
    return (await db.execute(query)) as unknown as Raw[];
  }

  return {
    async load(now = new Date()) {
      const [weekly, memory, notes, cost, latency, counts] = await Promise.all([
        rows(sql`
          select date_trunc('week', rated_at) as week,
                 count(*) filter (where rating = 'good') as good,
                 count(*) filter (where rating = 'bad') as bad
          from reply_options
          where rating is not null and rated_at is not null and rated_at >= ${daysAgo(now, WEEKLY_WINDOW_DAYS)}::timestamptz
          group by 1 order by 1`),
        rows(sql`
          select g.use_memory as use_memory,
                 count(*) filter (where o.rating = 'good') as good,
                 count(*) filter (where o.rating = 'bad') as bad
          from reply_options o join generations g on g.id = o.generation_id
          where o.rating is not null
          group by 1`),
        // Pasted-message replies only: a typed idea never uses notes, and a
        // developed version belongs to the reply it grew from.
        rows(sql`
          select (cardinality(g.note_ids) > 0) as with_notes,
                 count(*) filter (where o.rating = 'good') as good,
                 count(*) filter (where o.rating = 'bad') as bad
          from reply_options o join generations g on g.id = o.generation_id
          where o.rating is not null and g.status = 'done' and g.mode = 'en_reply' and g.refine_instruction is null
          group by 1`),
        rows(sql`
          select date_trunc('day', created_at) as day, model,
                 count(*) as requests, coalesce(sum(cost_usd), 0) as usd
          from generations
          where created_at >= ${daysAgo(now, COST_WINDOW_DAYS)}::timestamptz
          group by 1, 2 order by 1 desc`),
        rows(sql`
          select model, count(*) as requests,
                 avg(first_token_ms)::float8 as avg_first_token_ms, avg(total_ms)::float8 as avg_total_ms
          from generations
          where status = 'done' and created_at >= ${daysAgo(now, LATENCY_WINDOW_DAYS)}::timestamptz
          group by model`),
        rows(sql`
          select
            (select count(*) from generations where status = 'done') as requests,
            (select coalesce(sum(cost_usd), 0) from generations) as cost_usd,
            (select count(*) from reply_options o join generations g on g.id = o.generation_id
               where g.learn and g.status = 'done' and o.edited_text is not null) as edited,
            (select count(*) from reply_options o join generations g on g.id = o.generation_id
               where g.learn and g.status = 'done' and o.rating = 'good' and o.edited_text is null) as liked,
            (select count(*) from generations where status = 'done' and use_memory) as memory_asked,
            (select count(*) from generations
               where status = 'done' and use_memory and cardinality(memory_example_ids) > 0) as memory_hit,
            (select count(*) from generations
               where status = 'done' and mode = 'en_reply' and refine_instruction is null) as pasted,
            (select count(*) from generations
               where status = 'done' and mode = 'en_reply' and refine_instruction is null
                 and cardinality(note_ids) > 0) as notes_used`),
      ]);

      const total = counts[0] ?? {};
      return {
        weekly: weekly.map((r): WeeklyRatingRow => ({ week: new Date(r.week as string | Date), good: num(r.good), bad: num(r.bad) })),
        memory: memory.map((r): MemoryRatingRow => ({ useMemory: Boolean(r.use_memory), good: num(r.good), bad: num(r.bad) })),
        notes: notes.map((r): NotesRatingRow => ({ withNotes: Boolean(r.with_notes), good: num(r.good), bad: num(r.bad) })),
        cost: cost.map((r): CostRow => ({ day: new Date(r.day as string | Date), model: String(r.model), requests: num(r.requests), usd: num(r.usd) })),
        latency: latency.map(
          (r): LatencyRow => ({
            model: String(r.model),
            requests: num(r.requests),
            avgFirstTokenMs: maybe(r.avg_first_token_ms),
            avgTotalMs: maybe(r.avg_total_ms),
          }),
        ),
        counts: {
          requests: num(total.requests),
          costUsd: num(total.cost_usd),
          edited: num(total.edited),
          liked: num(total.liked),
          memoryAsked: num(total.memory_asked),
          memoryHit: num(total.memory_hit),
          pasted: num(total.pasted),
          notesUsed: num(total.notes_used),
        } satisfies CountsRow,
      };
    },
  };
}
