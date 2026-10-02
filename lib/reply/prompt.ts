import { PRESET_DIRECTIONS } from "./refine-directions";
import { STYLE_GUIDE } from "./style-guide";
import { REPLY_VARIANTS, type RefinePreset, type ReplyContext, type ReplyMode } from "./types";

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
}

export interface UserMessage {
  role: "user";
  content: string;
}

// Developing a reply: the reply to grow and the direction to grow it in.
export interface RefinePrompt {
  baseReply: string;
  instruction?: string | null;
  preset?: RefinePreset;
  // The Vietnamese idea the reply came from, for a typed request.
  originalIdea?: string | null;
  // A detail from one of the writer's saved notes, to add.
  noteDetail?: string | null;
}

// A note of the writer's as the prompt shows it. `label` is the number the
// model uses to say which notes it used; `when` is the month of an event.
export interface PromptNote {
  label: number;
  text: string;
  kind: "fact" | "event";
  when: string | null;
}

export interface ReplyPromptInput {
  mode: ReplyMode;
  context: ReplyContext;
  // Ignored when `refine` is set.
  input: string;
  refine?: RefinePrompt;
  thread?: { summary?: string | null; transcript: string };
  examples?: Array<{ input: string; reply: string }>;
  styleProfile?: { rules: string } | null;
  // Notes offered for this request (a pasted message only); the pinned ones are
  // in the cached prefix instead.
  aboutMe?: PromptNote[];
  // The writer's pinned notes for this request's scope: part of the cached prefix.
  pinnedNotes?: PromptNote[];
  // Today (YYYY-MM-DD), so a dated note can be described as "last month" or
  // "in September". Only sent when there are notes it could matter for.
  today?: string;
}

// For a pasted conversation the thread already holds the text; the input only
// says what to do with it.
export const THREAD_REPLY_HINT = "Write replies to the newest message in the thread.";

// The option markers, and the "@@used" line that reports which notes were used.
const MARKER_LINE = new RegExp(`^[ \\t]*@@(?:(?:${REPLY_VARIANTS.join("|")})[ \\t]*|used\\b.*)$`, "gim");
const PROMPT_TAGS = /<(\/?)(context|thread_summary|thread|memory_examples|example|example_input|example_reply|task|input|explain_these|base_reply|direction|original_idea|note|diary|today|about_me|writer_text)>/gi;

// Pasted or typed text is data. Marker lines would break option parsing, and
// our own tag names would let the text close a section and start a new one.
export function sanitizeUserText(text: string): string {
  return text.replace(MARKER_LINE, "").replace(PROMPT_TAGS, "[$1$2]").trim();
}

// One note on one line: "[2] (2026-09) I moved to a new apartment."
export function formatNoteLine(note: PromptNote): string {
  const text = sanitizeUserText(note.text).replace(/\s+/g, " ");
  return `[${note.label}] ${note.kind === "event" && note.when ? `(${note.when}) ` : ""}${text}`;
}

// The cached prefix. Everything here must be identical from request to
// request; a style profile changes only when the user rebuilds it, and the
// pinned notes only when they are edited. Pinned notes are per scope (work or
// casual), each with its own prefix.
export function buildSystemBlocks(styleProfile?: { rules: string } | null, pinnedNotes?: PromptNote[]): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { type: "text", text: STYLE_GUIDE, cache_control: { type: "ephemeral" } },
  ];
  if (styleProfile) {
    blocks.push({
      type: "text",
      text: `# Style profile\nThese rules were learned from the writer's own edits. Follow them.\n${styleProfile.rules}`,
      cache_control: { type: "ephemeral" },
    });
  }
  if (pinnedNotes && pinnedNotes.length > 0) {
    blocks.push({
      type: "text",
      text: `# Pinned notes\nThe writer keeps these notes pinned. They are true, and they follow the rules for notes above.\n${pinnedNotes.map(formatNoteLine).join("\n")}`,
      cache_control: { type: "ephemeral" },
    });
  }
  return blocks;
}

function formatExamples(examples: Array<{ input: string; reply: string }>): string {
  const items = examples.map(
    (example) =>
      `<example>\n<example_input>${sanitizeUserText(example.input)}</example_input>\n<example_reply>${sanitizeUserText(example.reply)}</example_reply>\n</example>`,
  );
  return `<memory_examples>\n${items.join("\n")}\n</memory_examples>`;
}

function formatDirection(refine: RefinePrompt): string {
  const lines: string[] = [];
  if (refine.preset) lines.push(PRESET_DIRECTIONS[refine.preset]);
  const typed = refine.instruction ? sanitizeUserText(refine.instruction) : "";
  if (typed) lines.push(`The writer says (in Vietnamese): ${typed}`);
  const detail = refine.noteDetail ? sanitizeUserText(refine.noteDetail).replace(/\s+/g, " ") : "";
  if (detail) lines.push(`The writer's saved note to add, which is true: ${detail}`);
  return `<direction>\n${lines.join("\n")}\n</direction>`;
}

// Per-request content goes after the cached prefix, in a stable order:
// slowest-changing first, so a later cache breakpoint can sit after <thread>.
export function buildReplyRequest(request: ReplyPromptInput): {
  system: SystemBlock[];
  messages: [UserMessage];
} {
  const parts: string[] = [`<context>${request.context}</context>`];
  const hasNotes = (request.aboutMe?.length ?? 0) > 0 || (request.pinnedNotes?.length ?? 0) > 0;
  if (request.today && hasNotes) parts.push(`<today>${request.today}</today>`);

  if (request.thread?.summary) {
    parts.push(`<thread_summary>${sanitizeUserText(request.thread.summary)}</thread_summary>`);
  }
  if (request.thread) {
    parts.push(`<thread>\n${sanitizeUserText(request.thread.transcript)}\n</thread>`);
  }
  if (request.aboutMe && request.aboutMe.length > 0) {
    parts.push(`<about_me>\n${request.aboutMe.map(formatNoteLine).join("\n")}\n</about_me>`);
  }
  if (request.refine) {
    const { refine } = request;
    if (refine.originalIdea) {
      parts.push(`<original_idea>\n${sanitizeUserText(refine.originalIdea)}\n</original_idea>`);
    }
    parts.push(`<base_reply>\n${sanitizeUserText(refine.baseReply)}\n</base_reply>`);
    parts.push("<task>develop</task>");
    parts.push(formatDirection(refine));
  } else {
    if (request.examples && request.examples.length > 0) {
      parts.push(formatExamples(request.examples));
    }
    parts.push(`<task>${request.mode}</task>`);
    parts.push(`<input>\n${sanitizeUserText(request.input)}\n</input>`);
  }

  return {
    system: buildSystemBlocks(request.styleProfile, request.pinnedNotes),
    messages: [{ role: "user", content: parts.join("\n") }],
  };
}
