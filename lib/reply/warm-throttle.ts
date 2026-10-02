// The prompt cache lives 5 minutes. Warming a little before that keeps it
// fresh, but every warm call is a cache write (about 1.25x the input price),
// so warming more often than this costs more than it saves.
export const WARM_MIN_INTERVAL_MS = 4.5 * 60 * 1000;

export function shouldWarm(now: number, lastWarmAt: number | null): boolean {
  return lastWarmAt === null || now - lastWarmAt >= WARM_MIN_INTERVAL_MS;
}
