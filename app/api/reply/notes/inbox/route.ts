import { getDb } from "@/lib/reply/db";
import { createNotesRepo } from "@/lib/reply/notes-store";

export const dynamic = "force-dynamic";

// Waiting suggestions never exceed this (see MAX_WAITING_SUGGESTIONS).
const LIST_LIMIT = 50;

// The notes the app proposed from what the writer typed, newest first, for the
// inbox on the About me page and the count on the Reply page.
export async function GET(): Promise<Response> {
  try {
    const notes = await createNotesRepo(getDb()).list({ status: "suggested" }, LIST_LIMIT);
    return Response.json({ notes, count: notes.length });
  } catch (err) {
    console.error("[/api/reply/notes/inbox]", err);
    return Response.json({ error: "Không tải được ghi chú gợi ý." }, { status: 500 });
  }
}
