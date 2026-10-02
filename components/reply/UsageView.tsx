import Link from "next/link";
import { formatUsd, type UsageSeriesRow, type UsageView as Usage } from "@/lib/reply/usage-report";

const CARD = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-800";
const TH = "py-1.5 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400";
const TD = "py-1.5 pr-4 text-sm text-stone-700 dark:text-stone-200";
const NUM = "text-right tabular-nums";
const NOTE = "text-xs text-stone-400 dark:text-stone-500";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</h2>
      {note && <p className={`mb-3 ${NOTE}`}>{note}</p>}
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">{value}</p>
      {hint && <p className={`mt-0.5 ${NOTE}`}>{hint}</p>}
    </div>
  );
}

// One table per period. Periods with no calls stay in as zeros so a quiet week
// is visible instead of missing.
function PeriodTable({ rows, first }: { rows: UsageSeriesRow[]; first: string }) {
  const max = Math.max(...rows.map((row) => row.costUsd), 0);
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={TH}>{first}</th>
          <th className={`${TH} ${NUM}`}>Cost</th>
          <th className={`${TH} ${NUM}`}>Calls</th>
          <th className={TH} aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className={TD}>{row.label}</td>
            <td className={`${TD} ${NUM}`}>{row.calls === 0 ? "–" : formatUsd(row.costUsd)}</td>
            <td className={`${TD} ${NUM}`}>{row.calls === 0 ? "–" : row.calls}</td>
            <td className="w-24 py-1.5" aria-hidden="true">
              <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${max > 0 ? Math.round((row.costUsd / max) * 100) : 0}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// What the assistant costs: totals, then by day, week, month, kind of call and
// conversation. Every figure is an estimate from token counts and a price table.
export default function UsageView({ usage }: { usage: Usage }) {
  if (usage.empty) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
        Nothing has been spent yet. Costs appear here after the first request.
      </p>
    );
  }

  const { totals } = usage;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Total label="Today" value={formatUsd(totals.today)} hint="since 00:00 UTC" />
        <Total label="This week" value={formatUsd(totals.week)} hint="since Monday, UTC" />
        <Total label="This month" value={formatUsd(totals.month)} />
        <Total label="All time" value={formatUsd(totals.allTime)} hint={`${totals.calls} calls`} />
      </div>

      {totals.unpriced > 0 && (
        <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {totals.unpriced} {totals.unpriced === 1 ? "call used" : "calls used"} a model without a known price, so{" "}
          {totals.unpriced === 1 ? "its" : "their"} cost is missing from these totals.
        </p>
      )}

      <Section title="By kind of call" note="Where the money goes. This month and all time.">
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Kind</th>
              <th className={`${TH} ${NUM}`}>This month</th>
              <th className={`${TH} ${NUM}`}>Calls</th>
              <th className={`${TH} ${NUM}`}>All time</th>
              <th className={`${TH} ${NUM}`}>Calls</th>
            </tr>
          </thead>
          <tbody>
            {usage.kinds.map((kind) => (
              <tr key={kind.kind}>
                <td className={TD}>{kind.label}</td>
                <td className={`${TD} ${NUM}`}>{formatUsd(kind.monthUsd)}</td>
                <td className={`${TD} ${NUM}`}>{kind.monthCalls}</td>
                <td className={`${TD} ${NUM}`}>{formatUsd(kind.allTimeUsd)}</td>
                <td className={`${TD} ${NUM}`}>{kind.allTimeCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="By conversation" note="The 20 conversations that cost the most. Deleting a conversation keeps its cost in the totals.">
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Conversation</th>
              <th className={`${TH} ${NUM}`}>Cost</th>
              <th className={`${TH} ${NUM}`}>Calls</th>
              <th className={TH}>Last used</th>
            </tr>
          </thead>
          <tbody>
            {usage.conversations.map((row) => (
              <tr key={row.conversationId ?? "none"}>
                <td className={TD}>{row.label}</td>
                <td className={`${TD} ${NUM}`}>{formatUsd(row.costUsd)}</td>
                <td className={`${TD} ${NUM}`}>{row.calls}</td>
                <td className={`${TD} whitespace-nowrap`}>{row.lastAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="By day" note="The last 30 days (UTC).">
        <PeriodTable rows={usage.days} first="Day" />
      </Section>

      <Section title="By week" note="The last 12 weeks. A week starts on Monday (UTC).">
        <PeriodTable rows={usage.weeks} first="Week" />
      </Section>

      <Section title="By month" note="The last 12 months (UTC).">
        <PeriodTable rows={usage.months} first="Month" />
      </Section>

      <p className={NOTE}>
        Costs are estimates from token counts and a price list kept in the code, not invoices.{" "}
        <Link href="/reply/stats" className="underline">
          Reply stats
        </Link>
      </p>
    </div>
  );
}
