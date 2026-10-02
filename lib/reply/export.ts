import { excerpt } from "./memory";
import { formatMessage } from "./transcript";
import type { MessageAuthor } from "./types";

// The context a reply was written in, kept short enough to read in a data file.
export const EXPORT_THREAD_MESSAGES = 6;
export const EXPORT_MESSAGE_CHARS = 300;
export const EXPORT_INPUT_CHARS = 4000;
// A safety cap; a personal corpus stays far below it.
export const MAX_EXPORT_ROWS = 50_000;

export interface ExportRow {
  mode: string;
  context: string;
  inputText: string;
  text: string;
  editedText: string | null;
  createdAt: Date;
  conversationId: string | null;
  // The direction a developed reply was written with; null for an original one.
  refineInstruction: string | null;
}

export interface ThreadMessageRow {
  conversationId: string;
  author: MessageAuthor;
  text: string;
  createdAt: Date;
}

// One line of the exported file.
export interface ExportRecord {
  mode: string;
  context: string;
  input: string;
  thread_excerpt: string | null;
  reply: string;
  is_edited: boolean;
  created_at: string;
  // Only on developed replies: how the writer asked for it to be grown. Last,
  // and absent otherwise, so a reader of the older format is not affected.
  instruction?: string;
}

// The last few messages that existed in the thread when the request was made.
export function buildThreadExcerpt(messages: ThreadMessageRow[], before: Date): string | null {
  const earlier = messages
    .filter((message) => message.createdAt.getTime() <= before.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-EXPORT_THREAD_MESSAGES);
  if (earlier.length === 0) return null;
  return earlier.map((message) => formatMessage({ seq: 0, author: message.author, text: message.text }, EXPORT_MESSAGE_CHARS)).join("\n");
}

export function toExportRecords(rows: ExportRow[], messages: ThreadMessageRow[]): ExportRecord[] {
  const byThread = new Map<string, ThreadMessageRow[]>();
  for (const message of messages) {
    const list = byThread.get(message.conversationId) ?? [];
    list.push(message);
    byThread.set(message.conversationId, list);
  }

  return rows.map((row) => ({
    mode: row.mode,
    context: row.context,
    input: excerpt(row.inputText, EXPORT_INPUT_CHARS),
    thread_excerpt: row.conversationId ? buildThreadExcerpt(byThread.get(row.conversationId) ?? [], row.createdAt) : null,
    reply: row.editedText ?? row.text,
    is_edited: row.editedText !== null,
    created_at: row.createdAt.toISOString(),
    ...(row.refineInstruction ? { instruction: row.refineInstruction } : {}),
  }));
}

// JSON Lines: one object per line, newlines inside texts are escaped by JSON.
export function serializeJsonl(records: ExportRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

export function exportFilename(now: Date): string {
  return `reply-export-${now.toISOString().slice(0, 10).replaceAll("-", "")}.jsonl`;
}
