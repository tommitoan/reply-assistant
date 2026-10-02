import { sql } from "drizzle-orm";
import type { ReplyDb } from "./db";
import { replyUsage } from "./schema";
import type { UsageEntry, UsageRecorder } from "./usage";
import {
  CONVERSATIONS_SHOWN,
  dayStart,
  monthStart,
  weekStart,
  windows,
  type ConversationRow,
  type KindRow,
  type PeriodTotals,
  type SeriesRow,
  type UsageRaw,
} from "./usage-report";

export interface UsageRepo extends UsageRecorder {
  load(now?: Date): Promise<UsageRaw>;
}

type Raw = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);

// Bound as ISO strings and cast in the query: a raw parameter has no column to
// take its type from, so a Date would not be serialised by the driver.
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

// Day, week and month keys are cut in UTC, whatever the session time zone is.
const utc = sql`created_at at time zone 'UTC'`;

export function createUsageRepo(db: ReplyDb): UsageRepo {
  async function rows(query: ReturnType<typeof sql>): Promise<Raw[]> {
    return (await db.execute(query)) as unknown as Raw[];
  }

  const series = (r: Raw): SeriesRow => ({ key: String(r.key), costUsd: num(r.cost), calls: num(r.calls) });

  return {
    async record(entry: UsageEntry) {
      await db.insert(replyUsage).values({
        kind: entry.kind,
        model: entry.model,
        conversationId: entry.conversationId ?? null,
        generationId: entry.generationId ?? null,
        inputTokens: entry.usage.input_tokens,
        outputTokens: entry.usage.output_tokens,
        cacheCreationTokens: entry.usage.cache_creation_input_tokens,
        cacheReadTokens: entry.usage.cache_read_input_tokens,
        costUsd: entry.costUsd === null ? null : entry.costUsd.toFixed(6),
      });
    },

    async load(now = new Date()) {
      const from = windows(now);
      const today = dayStart(now);
      const week = weekStart(now);
      const month = monthStart(now);

      const [totals, days, weeks, months, kinds, conversations] = await Promise.all([
        rows(sql`
          select
            coalesce(sum(cost_usd) filter (where created_at >= ${at(today)}), 0) as today,
            coalesce(sum(cost_usd) filter (where created_at >= ${at(week)}), 0) as week,
            coalesce(sum(cost_usd) filter (where created_at >= ${at(month)}), 0) as month,
            coalesce(sum(cost_usd), 0) as all_time,
            count(*) as calls,
            count(*) filter (where cost_usd is null) as unpriced
          from reply_usage`),
        rows(sql`
          select to_char(${utc}, 'YYYY-MM-DD') as key, coalesce(sum(cost_usd), 0) as cost, count(*) as calls
          from reply_usage where created_at >= ${at(from.day)} group by 1`),
        rows(sql`
          select to_char(date_trunc('week', ${utc}), 'YYYY-MM-DD') as key,
                 coalesce(sum(cost_usd), 0) as cost, count(*) as calls
          from reply_usage where created_at >= ${at(from.week)} group by 1`),
        rows(sql`
          select to_char(${utc}, 'YYYY-MM') as key, coalesce(sum(cost_usd), 0) as cost, count(*) as calls
          from reply_usage where created_at >= ${at(from.month)} group by 1`),
        rows(sql`
          select kind,
                 coalesce(sum(cost_usd) filter (where created_at >= ${at(month)}), 0) as month_usd,
                 count(*) filter (where created_at >= ${at(month)}) as month_calls,
                 coalesce(sum(cost_usd), 0) as all_usd,
                 count(*) as all_calls
          from reply_usage group by kind`),
        rows(sql`
          select u.conversation_id, c.title, coalesce(sum(u.cost_usd), 0) as cost,
                 count(*) as calls, max(u.created_at) as last_at
          from reply_usage u left join conversations c on c.id = u.conversation_id
          group by u.conversation_id, c.title
          order by coalesce(sum(u.cost_usd), 0) desc, max(u.created_at) desc
          limit ${CONVERSATIONS_SHOWN}`),
      ]);

      const total = totals[0] ?? {};
      return {
        totals: {
          today: num(total.today),
          week: num(total.week),
          month: num(total.month),
          allTime: num(total.all_time),
          calls: num(total.calls),
          unpriced: num(total.unpriced),
        } satisfies PeriodTotals,
        days: days.map(series),
        weeks: weeks.map(series),
        months: months.map(series),
        kinds: kinds.map(
          (r): KindRow => ({
            kind: String(r.kind),
            monthUsd: num(r.month_usd),
            monthCalls: num(r.month_calls),
            allTimeUsd: num(r.all_usd),
            allTimeCalls: num(r.all_calls),
          }),
        ),
        conversations: conversations.map(
          (r): ConversationRow => ({
            conversationId: r.conversation_id === null ? null : String(r.conversation_id),
            title: r.title === null ? null : String(r.title),
            costUsd: num(r.cost),
            calls: num(r.calls),
            lastAt: new Date(r.last_at as string | Date),
          }),
        ),
      };
    },
  };
}
