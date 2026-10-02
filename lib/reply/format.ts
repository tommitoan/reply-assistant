// "claude-haiku-4-5" -> "haiku"
export function shortModelName(model: string): string {
  return /^claude-([a-z]+)/.exec(model)?.[1] ?? model;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "chưa có giá";
  if (costUsd > 0 && costUsd < 0.001) return "<$0.001";
  return `$${costUsd.toFixed(3)}`;
}

export interface MetaLineInput {
  model: string;
  firstTokenMs: number | null;
  totalMs: number;
  costUsd: number | null;
}

// e.g. "haiku · chữ đầu 0.8s · tổng 2.9s · $0.003"; the cost is an estimate.
export function formatMetaLine({ model, firstTokenMs, totalMs, costUsd }: MetaLineInput): string {
  const parts = [shortModelName(model)];
  if (firstTokenMs !== null) parts.push(`chữ đầu ${formatSeconds(firstTokenMs)}`);
  parts.push(`tổng ${formatSeconds(totalMs)}`, formatCost(costUsd));
  return parts.join(" · ");
}
