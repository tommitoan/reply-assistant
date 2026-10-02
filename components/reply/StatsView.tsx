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
          ["Yêu cầu", String(stats.totals.requests)],
          ["Chi phí bản nháp", usd(stats.totals.costUsd)],
          ["Bạn đã sửa", String(stats.goldExamples)],
          ["Đã thích", String(stats.likedExamples)],
        ].map(([label, value]) => (
          <div key={label} className={CARD}>
            <p className={NOTE}>{label}</p>
            <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">{value}</p>
          </div>
        ))}
      </div>

      <p className={NOTE}>
        Chi phí ở đây chỉ tính các bản nháp còn lưu. Tóm tắt, giải thích, trí nhớ và các lượt gọi khác nằm ở trang{" "}
        <Link href="/usage" className="underline">
          Chi phí
        </Link>
        , chia theo ngày, tuần, tháng và cuộc trò chuyện.
      </p>

      {empty && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Chưa có gì để hiển thị. Hãy viết vài bản nháp rồi đánh giá hoặc sửa, số liệu sẽ tự xuất hiện.
        </p>
      )}

      <Section title="Tỉ lệ 👍 theo tuần" note="Trong các bản nháp bạn đã đánh giá, bao nhiêu phần bạn thích. 8 tuần gần nhất.">
        {stats.weekly.length === 0 ? (
          <p className={NOTE}>Chưa có đánh giá nào.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Tuần từ</th>
                <th className={TH}>Đã thích</th>
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

      <Section title="Trí nhớ có giúp ích không?" note="Tỉ lệ bản nháp được bạn thích, khi bật và khi tắt “Dùng trí nhớ”.">
        <table className="w-full">
          <tbody>
            <tr>
              <td className={TD}>Bật trí nhớ</td>
              <td className={TD}>
                <RateBar rate={stats.memoryRates.on} />
              </td>
            </tr>
            <tr>
              <td className={TD}>Tắt trí nhớ</td>
              <td className={TD}>
                <RateBar rate={stats.memoryRates.off} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className={`mt-2 ${NOTE}`}>
          Trí nhớ tìm được nội dung đủ sát trong {formatPercent(stats.memoryHitRate.rate)} của {stats.memoryHitRate.asked}{" "}
          yêu cầu có bật trí nhớ.
        </p>
      </Section>

      <Section
        title="Ghi chú có giúp ích không?"
        note="Chỉ tính các bản nháp trả lời tin nhắn đã dán: tỉ lệ bạn thích khi bản nháp có dùng ghi chú của bạn và khi không dùng."
      >
        <table className="w-full">
          <tbody>
            <tr>
              <td className={TD}>Có dùng ghi chú</td>
              <td className={TD}>
                <RateBar rate={stats.notesRates.with} />
              </td>
            </tr>
            <tr>
              <td className={TD}>Không dùng ghi chú</td>
              <td className={TD}>
                <RateBar rate={stats.notesRates.without} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className={`mt-2 ${NOTE}`}>
          Ghi chú được dùng trong {formatPercent(stats.notesUse.rate)} của {stats.notesUse.pasted} bản nháp trả lời tin nhắn đã dán. Nếu
          mới có ít đánh giá, hai dòng này chưa nói lên nhiều.
        </p>
      </Section>

      <Section title="Chi phí theo ngày" note="Ước tính từ số token và bảng giá tự cập nhật. 14 ngày gần nhất.">
        {stats.costByDay.length === 0 ? (
          <p className={NOTE}>Không có yêu cầu nào trong giai đoạn này.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Ngày</th>
                <th className={TH}>Model</th>
                <th className={TH}>Yêu cầu</th>
                <th className={TH}>Chi phí</th>
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
                      {index === 0 && day.models.length > 1 && <span className={`ml-2 ${NOTE}`}>tổng ngày {usd(day.totalUsd)}</span>}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Tốc độ theo model" note="Trung bình của các yêu cầu đã xong trong 30 ngày gần nhất.">
        {stats.latencyByModel.length === 0 ? (
          <p className={NOTE}>Chưa có yêu cầu nào hoàn tất trong giai đoạn này.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Model</th>
                <th className={TH}>Yêu cầu</th>
                <th className={TH}>Đến chữ đầu tiên</th>
                <th className={TH}>Tổng</th>
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
