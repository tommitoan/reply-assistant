export const REPLY_VARIANTS = ["short", "medium", "long", "alt"] as const;
export type ReplyVariant = (typeof REPLY_VARIANTS)[number];

export type ReplyMode = "vi_to_en" | "en_reply";
export type ReplyContext = "work" | "casual";
export type ReplySpeed = "auto" | "fast" | "smart";
export type ModelTier = "fast" | "smart";

export interface ReplyUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ReplyOptionDraft {
  variant: ReplyVariant;
  text: string;
}

export interface ReplyOptionView extends ReplyOptionDraft {
  id: string;
}

// Quick directions for developing a reply.
export const REFINE_PRESETS = ["longer", "ask_back", "personal_detail", "casual"] as const;
export type RefinePreset = (typeof REFINE_PRESETS)[number];

export type OptionRating = "good" | "bad";

export type MessageAuthor = "them" | "me" | "unknown";
export type MessageSource = "pasted" | "chosen_reply";

// What happened with memory on one request:
// off = not asked for; unavailable = no embedding key on the server;
// skipped = it failed or timed out and the request went ahead without it;
// none = it ran but found nothing close enough; used = examples were added.
export type MemoryStatus = "off" | "unavailable" | "skipped" | "none" | "used";

// What the writer's notes did on one request:
// off = the switch was off; empty = there are no notes that could apply;
// skipped = the notes had to be searched but the search could not run (the
// embedding service was unavailable or over its limit), so only pinned notes
// were used; ready = notes were offered, or suggested for a typed idea.
export type NotesStatus = "off" | "empty" | "skipped" | "ready";

// A note as shown on a reply: enough to recognise it, switch it off for one
// request, or open it. `text` is the English version when there is one.
export interface NoteRef {
  id: string;
  text: string;
  pinned: boolean;
}

export interface MemoryRef {
  id: string;
  input: string;
}

// What the user has done with one option: the signals the memory learns from.
export interface OptionFeedback {
  rating: OptionRating | null;
  // The user's own rewrite; null while the model's text is untouched.
  editedText: string | null;
  chosen: boolean;
}

export interface StoredOption extends ReplyOptionView, OptionFeedback {
  generationId: string;
}

// Two developed versions of one reply, made with one direction.
export interface DevelopedGroup {
  generationId: string;
  // The option they grew from.
  ofOptionId: string;
  instruction: string;
  createdAt: string;
  options: StoredOption[];
}

export interface RecentGeneration {
  id: string;
  createdAt: string;
  context: ReplyContext;
  inputText: string;
  model: string;
  options: StoredOption[];
  // Developed versions of this request's options, oldest first.
  developed: DevelopedGroup[];
}

export interface ConversationRecord {
  id: string;
  title: string;
  context: ReplyContext;
  summary: string | null;
  summaryUptoSeq: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListItem {
  id: string;
  title: string;
  context: ReplyContext;
  archived: boolean;
  updatedAt: string;
  messageCount: number;
}

export interface StoredMessage {
  id: string;
  seq: number;
  author: MessageAuthor;
  text: string;
  source: MessageSource;
  createdAt: string;
}

export interface ConversationDetail extends ConversationRecord {
  messages: StoredMessage[];
}

export interface StyleProfileRecord {
  id: string;
  // 1 for the first profile ever built, counting up.
  version: number;
  // One rule per line, each starting with "- ".
  rules: string;
  model: string;
  active: boolean;
  createdAt: string;
  // How many examples it was built from, and what building it cost.
  sourceCounts: {
    edited: number;
    liked: number;
    disliked: number;
    // Developed versions; absent on profiles built before they existed.
    refined?: number;
    costUsd?: number | null;
  };
}

// One JSON object per line on the /api/reply/generate response body.
export type ReplyStreamEvent =
  | {
      t: "meta";
      generationId: string;
      model: string;
      tier: ModelTier;
      memoryStatus: MemoryStatus;
      memories: MemoryRef[];
      // Present when the request ran inside a conversation thread.
      thread?: { added: number; skipped: number };
      // What the writer's notes did. `suggestions` are for a typed idea: notes
      // the writer may add with one click, never put into the replies unasked.
      notes?: { status: NotesStatus; offered: number; suggestions: NoteRef[] };
    }
  | { t: "delta"; text: string }
  // The Vietnamese translation and notes on the other person's message. It
  // arrives when it is ready, which may be before or after "done".
  | { t: "explain"; text: string }
  | {
      t: "done";
      options: ReplyOptionView[];
      usage: ReplyUsage;
      costUsd: number | null;
      firstTokenMs: number | null;
      totalMs: number;
      stopReason: string | null;
      // The notes the model reported using, for a pasted message.
      notesUsed?: NoteRef[];
    }
  | { t: "error"; message: string; retryable: boolean };

export const NOTE_KINDS = ["fact", "event"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_SCOPES = ["work", "casual", "both"] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];
export type NoteStatus = "active" | "suggested" | "archived" | "dismissed";
export type NoteSource = "manual" | "imported" | "suggested";

// A note as the page sees it. Embeddings never leave the server; `indexed`
// says whether the note can be found by meaning yet.
export interface NoteRecord {
  id: string;
  text: string;
  textEn: string | null;
  kind: NoteKind;
  // YYYY-MM-DD, for an event.
  happenedOn: string | null;
  scope: NoteScope;
  private: boolean;
  pinned: boolean;
  status: NoteStatus;
  source: NoteSource;
  indexed: boolean;
  createdAt: string;
  updatedAt: string;
}

// What a model proposes for a note, before the writer has looked at it.
export interface NoteSuggestion {
  // Null when the model gave no usable English version.
  textEn: string | null;
  kind: NoteKind;
  scope: NoteScope;
  happenedOn: string | null;
}

// One note proposed when a diary is split.
export interface NoteDraft extends NoteSuggestion {
  text: string;
}

export interface NoteCounts {
  active: number;
  archived: number;
  pinned: number;
  private: number;
  // Notes that cannot be found by meaning yet (saved while embedding was unavailable).
  unindexed: number;
}
