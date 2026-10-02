import Link from "next/link";
import { shortModelName } from "@/lib/reply/format";
import { formatPercent, type Rate, type StatsView as Stats } from "@/lib/reply/stats";

const CARD = "rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800";
const TH = "py-1.5 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400";
const TD = "py-1.5 pr-4 text-sm text-stone-700 dark:text-stone-200";
const NOTE = "text-xs text-stone-400 dark:text-stone-500";

const usd = (value: number): string => `$${value.toFixed(value >= 1 ? 2 : 4)}`;
const seconds = (ms: number | null): string => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-stone-800 dark:text-stone-100">{title}</h2>
      {note && <p className={`mb-3 ${NOTE}`}>{note}</p>}
      {children}
    </section>
  );
}

function RateBar({ rate }: { rate: Rate }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700" aria-hidden="true">
        <div className="h-full bg-emerald-500" style={{ width: `${Math.round((rate.rate ?? 0) * 100)}%` }} />
      </div>
      <span>{formatPercent(rate.rate)}</span>
      <span className={NOTE}>
        {rate.good} 👍 · {rate.bad} 👎
      </span>
    </div>
  );
}

// What the numbers in the database say about the assistant: how often replies
// are liked, whether memory helps, what it costs, and how fast it is.
export default function StatsView({ stats }: { stats: Stats }) {
  const empty = stats.totals.requests === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Requests", String(stats.totals.requests)],
          ["Reply cost", usd(stats.totals.costUsd)],
          ["Edited by you", String(stats.goldExamples)],
          ["Liked", String(stats.likedExamples)],
        ].map(([label, value]) => (
          <div key={label} className={CARD}>
            <p className={NOTE}>{label}</p>
            <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">{value}</p>
          </div>
        ))}
      </div>

      <p className={NOTE}>
        Costs here cover the replies still stored. Summaries, explanations, memory and every other call are in{" "}
        <Link href="/usage" className="underline">
          Usage
        </Link>
        , by day, week, month and conversation.
      </p>

      {empty && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Nothing to show yet. Write some replies and rate or edit them, and the numbers will fill in.
        </p>
      )}

      <Section title="👍 rate by week" note="Of the replies you rated, the share you liked. Last 8 weeks.">
        {stats.weekly.length === 0 ? (
          <p className={NOTE}>No ratings yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Week of</th>
                <th className={TH}>Liked</th>
              </tr>
            </thead>
            <tbody>
              {stats.weekly.map((week) => (
                <tr key={week.weekStart}>
                  <td className={TD}>{week.weekStart}</td>
                  <td className={TD}>
                    <RateBar rate={week} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Does memory help?" note="The share of rated replies you liked, with Use memory on and off.">
        <table className="w-full">
          <tbody>
            <tr>
              <td className={TD}>Memory on</td>
              <td className={TD}>
                <RateBar rate={stats.memoryRates.on} />
              </td>
            </tr>
            <tr>
              <td className={TD}>Memory off</td>
              <td className={TD}>
                <RateBar rate={stats.memoryRates.off} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className={`mt-2 ${NOTE}`}>
          Memory found something close enough in {formatPercent(stats.memoryHitRate.rate)} of the {stats.memoryHitRate.asked}{" "}
          requests that asked for it.
        </p>
      </Section>

      <Section
        title="Do notes help?"
        note="Replies to a pasted message only: the share of rated replies you liked when the reply used one of your notes, and when it did not."
      >
        <table className="w-full">
          <tbody>
            <tr>
              <td className={TD}>Used a note</td>
              <td className={TD}>
                <RateBar rate={stats.notesRates.with} />
              </td>
            </tr>
            <tr>
              <td className={TD}>Used no note</td>
              <td className={TD}>
                <RateBar rate={stats.notesRates.without} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className={`mt-2 ${NOTE}`}>
          A note was used in {formatPercent(stats.notesUse.rate)} of the {stats.notesUse.pasted} replies to a pasted message. With few
          ratings, the two rows say little.
        </p>
      </Section>

      <Section title="Cost per day" note="Estimated from token counts and a hand-kept price table. Last 14 days.">
        {stats.costByDay.length === 0 ? (
          <p className={NOTE}>No requests in this period.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Day</th>
                <th className={TH}>Model</th>
                <th className={TH}>Requests</th>
                <th className={TH}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.costByDay.flatMap((day) =>
                day.models.map((model, index) => (
                  <tr key={`${day.day}-${model.model}`}>
                    <td className={TD}>{index === 0 ? day.day : ""}</td>
                    <td className={TD}>{shortModelName(model.model)}</td>
                    <td className={TD}>{model.requests}</td>
                    <td className={TD}>
                      {usd(model.usd)}
                      {index === 0 && day.models.length > 1 && <span className={`ml-2 ${NOTE}`}>day total {usd(day.totalUsd)}</span>}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Speed by model" note="Average over finished requests in the last 30 days.">
        {stats.latencyByModel.length === 0 ? (
          <p className={NOTE}>No finished requests in this period.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Model</th>
                <th className={TH}>Requests</th>
                <th className={TH}>To first word</th>
                <th className={TH}>Total</th>
              </tr>
            </thead>
            <tbody>
              {stats.latencyByModel.map((row) => (
                <tr key={row.model}>
                  <td className={TD}>{shortModelName(row.model)}</td>
                  <td className={TD}>{row.requests}</td>
                  <td className={TD}>{seconds(row.avgFirstTokenMs)}</td>
                  <td className={TD}>{seconds(row.avgTotalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
