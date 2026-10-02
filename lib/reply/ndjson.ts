// Splits a chunked text stream into complete lines. A network chunk can end in
// the middle of a JSON line, so the unfinished tail is held until the rest
// arrives.
export function createLineSplitter(): {
  push(chunk: string): string[];
  flush(): string[];
} {
  let tail = "";
  return {
    push(chunk) {
      const parts = (tail + chunk).split("\n");
      tail = parts.pop() ?? "";
      return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0);
    },
    flush() {
      const rest = tail.replace(/\r$/, "");
      tail = "";
      return rest.length > 0 ? [rest] : [];
    },
  };
}

export function encodeEvent(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}
