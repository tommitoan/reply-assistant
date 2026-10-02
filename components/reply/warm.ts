import type { ReplyContext } from "@/lib/reply/types";
import { shouldWarm } from "@/lib/reply/warm-throttle";

// Module-level so the throttle survives the composer remounting.
let lastWarmAt: number | null = null;

// Asks the server to write the prompt cache ahead of a request. Skipped while
// the tab is hidden and when it ran recently.
export function warmReplyCache(context: ReplyContext = "work"): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  const now = Date.now();
  if (!shouldWarm(now, lastWarmAt)) return;
  lastWarmAt = now;
  // The pinned notes in the prefix depend on the context being written in.
  fetch(`/api/reply/warm?context=${context}`, { method: "POST" }).catch(() => {
    // Warming is an optimisation; a failure changes nothing for the user.
  });
}
