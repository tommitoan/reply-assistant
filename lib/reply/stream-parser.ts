import { REPLY_VARIANTS, type ReplyOptionDraft, type ReplyVariant } from "./types";

const MARKER = new RegExp(`^\\s*@@(${REPLY_VARIANTS.join("|")})\\s*$`, "i");
// After the options, the model may say which of the writer's notes it used:
// "@@used 1,3", or "@@used none". It is not part of any option.
const USED_LINE = /^\s*@@used\b(.*)$/i;
const USED_PREFIX = "@@used";
// A trailing partial line that could still turn into a marker is held back so
// "@@sh" is never flashed as option text before "ort" arrives.
function couldBecomeMarker(partial: string): boolean {
  const text = partial.trim().toLowerCase();
  if (text.length === 0) return true;
  // Anything that starts like the "used" line stays hidden, numbers included.
  if (text.startsWith(USED_PREFIX) || USED_PREFIX.startsWith(text)) return true;
  return REPLY_VARIANTS.some((variant) => `@@${variant}`.startsWith(text));
}

// The numbers in "@@used 1, 3". "none" and a line with no number both mean none.
function parseUsedLine(rest: string): number[] {
  return [...new Set((rest.match(/\d+/g) ?? []).map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0);
}

export interface ParseResult {
  options: ReplyOptionDraft[];
  // True when the model ignored the marker format and the whole reply was
  // returned as a single option.
  usedFallback: boolean;
  // The numbers of the notes the model reported using; null when it gave no report.
  used: number[] | null;
}

export interface OptionParser {
  // Feeds a chunk and returns the options visible so far, including the one
  // still being written.
  push(chunk: string): ReplyOptionDraft[];
  // Call once after the last chunk.
  finish(): ParseResult;
}

interface Draft {
  variant: ReplyVariant;
  lines: string[];
}

export function createOptionParser(): OptionParser {
  let raw = "";
  let pending = "";
  const drafts: Draft[] = [];
  let used: number[] | null = null;

  function consumeLine(line: string) {
    // The report comes last; nothing after it is an option.
    if (used !== null) return;
    const report = USED_LINE.exec(line);
    if (report) {
      used = parseUsedLine(report[1]);
      return;
    }
    const marker = MARKER.exec(line);
    if (marker) {
      drafts.push({ variant: marker[1].toLowerCase() as ReplyVariant, lines: [] });
      return;
    }
    // Text before the first marker is a preamble and is dropped.
    drafts.at(-1)?.lines.push(line);
  }

  function snapshot(): ReplyOptionDraft[] {
    const visiblePartial = pending.length > 0 && !couldBecomeMarker(pending) ? pending : "";
    return drafts.map((draft, index) => {
      const lines = index === drafts.length - 1 && visiblePartial ? [...draft.lines, visiblePartial] : draft.lines;
      return { variant: draft.variant, text: lines.join("\n").trim() };
    });
  }

  return {
    push(chunk) {
      raw += chunk;
      const combined = pending + chunk;
      const lines = combined.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consumeLine(line.replace(/\r$/, ""));
      return snapshot().filter((option) => option.text.length > 0);
    },
    finish() {
      if (pending.length > 0) consumeLine(pending.replace(/\r$/, ""));
      pending = "";
      const options = snapshot().filter((option) => option.text.length > 0);
      if (options.length > 0) return { options, usedFallback: false, used };
      // The model ignored the option markers: the whole answer is one option,
      // without a "used" line it may have added.
      const whole = raw
        .split("\n")
        .filter((line) => !USED_LINE.test(line))
        .join("\n")
        .trim();
      if (whole.length === 0) return { options: [], usedFallback: false, used };
      return { options: [{ variant: "medium", text: whole }], usedFallback: true, used };
    },
  };
}

export function parseOptions(text: string): ParseResult {
  const parser = createOptionParser();
  parser.push(text);
  return parser.finish();
}
