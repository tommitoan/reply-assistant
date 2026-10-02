import type { NoteCounts, NoteDraft, NoteKind, NoteRecord, NoteScope, NoteSuggestion } from "@/lib/reply/types";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Your session expired. Reload the page to sign in again.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; use the fallback.
  }
  return fallback;
}

// Each call resolves to the data, or throws an Error whose message is safe to show.
async function request<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Could not reach the server. Check the connection and try again.");
  }
  if (!res.ok) throw new Error(await errorMessage(res, fallback));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const send = (method: string, body: unknown): RequestInit => ({ method, headers: JSON_HEADERS, body: JSON.stringify(body) });

export interface NoteFilters {
  scope: NoteScope | "";
  kind: NoteKind | "";
  pinnedOnly: boolean;
  privateOnly: boolean;
  showArchived: boolean;
}

export const NO_FILTERS: NoteFilters = { scope: "", kind: "", pinnedOnly: false, privateOnly: false, showArchived: false };

export function filterQuery(filters: NoteFilters): string {
  const params = new URLSearchParams({ status: filters.showArchived ? "all" : "active" });
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.pinnedOnly) params.set("pinned", "true");
  if (filters.privateOnly) params.set("private", "true");
  return params.toString();
}

export async function listNotes(filters: NoteFilters): Promise<{ notes: NoteRecord[]; counts: NoteCounts }> {
  return request(`/api/reply/notes?${filterQuery(filters)}`, undefined, "Could not load the notes.");
}

// What the form sends for one note. `textEn` left out means "write it for me".
export interface NoteFields {
  text: string;
  textEn?: string | null;
  kind: NoteKind;
  happenedOn?: string | null;
  scope: NoteScope;
  private: boolean;
  pinned: boolean;
}

export async function suggestForNote(text: string): Promise<NoteSuggestion> {
  const body = await request<{ suggestion: NoteSuggestion }>(
    "/api/reply/notes/analyze",
    send("POST", { text }),
    "Could not suggest an English version.",
  );
  return body.suggestion;
}

export async function createNote(fields: NoteFields): Promise<NoteRecord> {
  const body = await request<{ note: NoteRecord }>("/api/reply/notes", send("POST", fields), "Could not save the note.");
  return body.note;
}

export async function previewDiary(text: string): Promise<NoteDraft[]> {
  const body = await request<{ drafts: NoteDraft[] }>(
    "/api/reply/notes/import-preview",
    send("POST", { text }),
    "Could not split the diary.",
  );
  return body.drafts;
}

export async function saveNotes(notes: NoteFields[]): Promise<NoteRecord[]> {
  const body = await request<{ notes: NoteRecord[] }>(
    "/api/reply/notes/batch",
    send("POST", { notes }),
    "Could not save the notes.",
  );
  return body.notes;
}

export interface NoteChanges {
  text?: string;
  textEn?: string | null;
  kind?: NoteKind;
  happenedOn?: string | null;
  scope?: NoteScope;
  private?: boolean;
  pinned?: boolean;
  status?: "active" | "archived";
}

export async function updateNote(id: string, changes: NoteChanges): Promise<NoteRecord> {
  const body = await request<{ note: NoteRecord }>(`/api/reply/notes/${id}`, send("PATCH", changes), "Could not save that.");
  return body.note;
}

export async function deleteNote(id: string): Promise<void> {
  await request<void>(`/api/reply/notes/${id}`, { method: "DELETE" }, "Could not delete that.");
}

export async function deleteAllNotes(): Promise<number> {
  const body = await request<{ deleted: number }>("/api/reply/notes?confirm=all", { method: "DELETE" }, "Could not delete the notes.");
  return body.deleted;
}

// Notes the app proposed from what the writer typed, waiting for a decision.
export async function listSuggestions(): Promise<NoteRecord[]> {
  const body = await request<{ notes: NoteRecord[] }>("/api/reply/notes/inbox", undefined, "Could not load the suggestions.");
  return body.notes;
}

// What the writer may change while approving a suggestion.
export interface ApprovalChanges {
  text?: string;
  textEn?: string | null;
  scope?: NoteScope;
  pinned?: boolean;
}

export async function approveSuggestion(id: string, changes: ApprovalChanges): Promise<NoteRecord> {
  const body = await request<{ note: NoteRecord }>(
    `/api/reply/notes/${id}/review`,
    send("POST", { decision: "approve", changes }),
    "Could not save that.",
  );
  return body.note;
}

export async function dismissSuggestion(id: string): Promise<void> {
  await request<{ note: NoteRecord }>(
    `/api/reply/notes/${id}/review`,
    send("POST", { decision: "dismiss" }),
    "Could not dismiss that.",
  );
}
