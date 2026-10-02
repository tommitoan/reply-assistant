import type { MessageAuthor } from "./thread-merge";

export interface TranscriptMessage {
  seq: number;
  author: MessageAuthor;
  text: string;
}

// The newest messages go to the model word for word; older ones are covered by
// the thread summary.
export const TRANSCRIPT_MAX_MESSAGES = 20;
export const TRANSCRIPT_MAX_CHARS = 6000;
// One very long message must not crowd out the rest of the thread.
export const TRANSCRIPT_MAX_MESSAGE_CHARS = 1500;

export interface Transcript {
  text: string;
  count: number;
  chars: number;
  // The oldest message that made it into the window; null for an empty thread.
  firstSeq: number | null;
}

const LABELS: Record<MessageAuthor, string> = { them: "Them", me: "Me", unknown: "Unknown" };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()} […]` : text;
}

// "Them: first line" with later lines indented, so where one message ends and
// the next begins stays clear.
export function formatMessage(message: TranscriptMessage, maxChars = TRANSCRIPT_MAX_MESSAGE_CHARS): string {
  const [first, ...rest] = clip(message.text, maxChars).split("\n");
  return [`${LABELS[message.author]}: ${first}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

export function buildTranscript(
  messages: TranscriptMessage[],
  {
    maxMessages = TRANSCRIPT_MAX_MESSAGES,
    maxChars = TRANSCRIPT_MAX_CHARS,
    maxMessageChars = TRANSCRIPT_MAX_MESSAGE_CHARS,
  } = {},
): Transcript {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const included: string[] = [];
  let chars = 0;
  let firstSeq: number | null = null;

  for (let i = ordered.length - 1; i >= 0 && included.length < maxMessages; i--) {
    const line = formatMessage(ordered[i], maxMessageChars);
    const added = line.length + (included.length > 0 ? 1 : 0);
    // The newest message is always sent, however long.
    if (included.length > 0 && chars + added > maxChars) break;
    included.unshift(line);
    chars += added;
    firstSeq = ordered[i].seq;
  }

  return { text: included.join("\n"), count: included.length, chars, firstSeq };
}

export interface SummaryPlan {
  // Messages that dropped out of the window and are not in the summary yet.
  messages: TranscriptMessage[];
  // The summary will cover the thread up to this message.
  uptoSeq: number;
}

// Decides whether the rolling summary has to be refreshed.
export function planSummary(
  messages: TranscriptMessage[],
  windowFirstSeq: number | null,
  summaryUptoSeq: number | null,
): SummaryPlan | null {
  if (windowFirstSeq === null) return null;
  const covered = summaryUptoSeq ?? 0;
  const fresh = messages
    .filter((message) => message.seq < windowFirstSeq && message.seq > covered)
    .sort((a, b) => a.seq - b.seq);
  if (fresh.length === 0) return null;
  return { messages: fresh, uptoSeq: fresh[fresh.length - 1].seq };
}
